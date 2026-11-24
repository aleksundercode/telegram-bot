const { randomUUID } = require('node:crypto');

const ADD = `
local ids = {}
for i = 5, #ARGV do
    redis.call('INCR', KEYS[1])
    local id = redis.call('GET', KEYS[1])
    redis.call('HSET', ARGV[1] .. id, 'id', id, 'text', ARGV[i], 'createdAt', ARGV[2])
    redis.call('ZADD', KEYS[2], id, id)
    ids[#ids + 1] = id
end
if ARGV[3] == 'tasks' then redis.call('SADD', KEYS[3], ARGV[4]) end
return ids`;
const MOVE = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 0 then return 0 end
if ARGV[2] == 'delete' then redis.call('DEL', KEYS[3])
else redis.call('ZADD', KEYS[2], tonumber(ARGV[1]), ARGV[1]) end
return 1`;
const IMPORT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
local text = redis.call('GET', KEYS[2])
if not text then return 0 end
local id = redis.call('INCR', KEYS[3])
redis.call('HSET', ARGV[1] .. id, 'id', id, 'text', text, 'createdAt', ARGV[2])
redis.call('ZADD', KEYS[4], id, id)
redis.call('SET', KEYS[1], '1')
return 1`;

class Store {
    constructor(client) { this.client = client; }
    base(chat, kind) {
        if (!['products', 'tasks'].includes(kind)) throw new Error('Invalid list');
        return `v2:chat:${chat}:${kind}`;
    }
    async add(chat, kind, text) {
        const [id] = await this.addMany(chat, kind, [text]);
        return id;
    }
    async addMany(chat, kind, texts) {
        if (!Array.isArray(texts) || !texts.length || texts.length > 20) throw new Error('Допускается от 1 до 20 записей.');
        const lines = texts.map(text => text.trim());
        if (lines.some(text => !text || text.length > 500)) throw new Error('Текст должен содержать от 1 до 500 символов.');
        const base = this.base(chat, kind);
        return this.client.eval(ADD, {
            keys: ['v2:nextId', `${base}:open`, 'v2:taskChats'],
            arguments: [`${base}:item:`, new Date().toISOString(), kind, String(chat), ...lines],
        });
    }
    async list(chat, kind, status = 'open', page = 0, size = 6) {
        const base = this.base(chat, kind);
        if (!['open', 'done'].includes(status)) throw new Error('Invalid status');
        const key = `${base}:${status}`;
        const count = await this.client.zCard(key);
        page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(count / size) - 1)));
        const ids = await this.client.zRange(key, page * size, page * size + size - 1);
        const items = await Promise.all(ids.map(id => this.client.hGetAll(`${base}:item:${id}`)));
        return { items: items.filter(item => item.id), count, page, pages: Math.ceil(count / size) };
    }
    async move(chat, kind, id, from, action) {
        const base = this.base(chat, kind);
        if (!/^\d+$/.test(id) || !['open', 'done'].includes(from) ||
            !((from === 'open' && action === 'close') || (from === 'done' && ['restore', 'delete'].includes(action)))) throw new Error('Invalid action');
        return this.client.eval(MOVE, {
            keys: [`${base}:${from}`, `${base}:${from === 'open' ? 'done' : 'open'}`, `${base}:item:${id}`],
            arguments: [id, action],
        });
    }
    async mode(chat, user, value) {
        const key = `v2:mode:${chat}:${user}`;
        if (value) {
            this.base(chat, value);
            await this.client.set(key, value, { EX: 2592000 });
        }
        return (await this.client.get(key)) || 'products';
    }
    async reminders(chat, enabled) {
        const key = `v2:chat:${chat}:reminders`;
        if (enabled !== undefined) await this.client.set(key, enabled ? 'on' : 'off');
        return (await this.client.get(key)) !== 'off';
    }
    async *taskChats() {
        for await (const batch of this.client.sScanIterator('v2:taskChats', { COUNT: 100 })) {
            for (const chat of batch) yield chat;
        }
    }
    async claimReminder(chat, date) {
        const token = randomUUID();
        return await this.client.set(`v2:reminder:${chat}:${date}`, token, { NX: true, EX: 300 }) ? token : null;
    }
    async finishReminder(chat, date, token, success) {
        await this.client.eval(`
            if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
            if ARGV[2] == 'yes' then redis.call('SET', KEYS[1], 'sent', 'EX', 172800)
            else redis.call('DEL', KEYS[1]) end
            return 1`, {
            keys: [`v2:reminder:${chat}:${date}`], arguments: [token, success ? 'yes' : 'no'],
        });
    }
    async migrateLegacy(chat) {
        if (!/^-?\d+$/.test(chat)) throw new Error('LEGACY_CHAT_ID must be a numeric Telegram chat ID');
        await this.client.set('v2:legacyOwner', chat, { NX: true });
        if (await this.client.get('v2:legacyOwner') !== chat) throw new Error('Legacy list already assigned to another chat');
        let imported = 0;
        for await (const keys of this.client.scanIterator({ MATCH: 'product:*', COUNT: 100 })) {
            for (const key of keys) {
                imported += Number(await this.client.eval(IMPORT, {
                    keys: [`v2:imported:${key}`, key, 'v2:nextId', `${this.base(chat, 'products')}:open`],
                    arguments: [`${this.base(chat, 'products')}:item:`, new Date().toISOString()],
                }));
            }
        }
        return imported;
    }
}

module.exports = { Store };
