const { test } = require('node:test');
const assert = require('node:assert/strict');
let available = false;
try { require.resolve('telegraf'); available = true; } catch { /* Install dependencies first. */ }

test('Telegram handlers with real Telegraf and mocked outbound API', { skip: !available }, async t => {
    const { createBot, showList } = require('../telegram');
    function fixture(env = {}) {
        const calls = [];
        const modes = new Map();
        const store = {
            async mode(chat, user, kind) {
                const key = `${chat}:${user}`;
                if (kind) modes.set(key, kind);
                return modes.get(key) || 'products';
            },
            async add(...args) { calls.push(['add', ...args]); },
            async list() { return { items: [], count: 0, page: 0, pages: 0 }; },
            async move(...args) { calls.push(['move', ...args]); return 1; },
            async reminders(...args) { calls.push(['reminders', ...args]); return true; },
        };
        const bot = createBot('123:test', store, env);
        bot.botInfo = { id: 123, is_bot: true, first_name: 'Test', username: 'test_bot' };
        bot.context.reply = async (...args) => calls.push(['reply', ...args]);
        bot.context.editMessageText = async (...args) => calls.push(['edit', ...args]);
        bot.context.answerCbQuery = async (...args) => calls.push(['answer', ...args]);
        bot.context.getChatMember = async () => ({ status: 'member' });
        let sequence = 0;
        const message = async (text, chat = 1, user = 10, type = 'private') => bot.handleUpdate({
            update_id: ++sequence,
            message: {
                message_id: sequence, date: 0, chat: { id: chat, type }, from: { id: user, is_bot: false, first_name: 'User' }, text,
                entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(/\s/)[0].length }] : [],
            },
        });
        const callback = async data => bot.handleUpdate({
            update_id: ++sequence,
            callback_query: { id: String(sequence), from: { id: 10, is_bot: false }, chat_instance: '1', data,
                message: { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } },
        });
        return { bot, store, calls, message, callback, showList };
    }
    await t.test('explicit commands, multiline input, per-user mode and unknown commands', async () => {
        const f = fixture();
        await f.message('/todo@ай_бот не наш');
        await f.message('/todo@test_bot Оплатить интернет\nПомыть машину');
        await f.message('Позвонить');
        await f.message('Молоко', 1, 20);
        await f.message('/unknown');
        assert.deepEqual(f.calls.filter(c => c[0] === 'add').map(c => c.slice(1)), [
            [1, 'tasks', 'Оплатить интернет'], [1, 'tasks', 'Помыть машину'], [1, 'tasks', 'Позвонить'], [1, 'products', 'Молоко'],
        ]);
    });
    await t.test('validate entire batch before writing', async () => {
        const f = fixture();
        await f.message(`/todo valid\n${'x'.repeat(501)}`);
        await f.message('/buy');
        await f.message(Array(21).fill('item').join('\n'));
        assert.equal(f.calls.filter(c => c[0] === 'add').length, 0);
    });
    await t.test('allowed chats, group administrator check and legacy callbacks', async () => {
        const f = fixture({ ALLOWED_CHAT_IDS: '1' });
        await f.message('/todo denied', 2);
        await f.message('/reminders off', 1, 10, 'group');
        assert.equal(f.calls.filter(c => c[0] === 'add' || c[0] === 'reminders').length, 0);
        await f.callback('product:null');
        assert.equal(f.calls.at(-1)[0], 'answer');
    });
    await t.test('callback closes entry only in its message chat and refreshes list', async () => {
        const f = fixture();
        await f.callback('item:tasks:open:42:0:close');
        assert.deepEqual(f.calls.find(c => c[0] === 'move'), ['move', 1, 'tasks', '42', 'open', 'close']);
        assert.equal(f.calls.at(-1)[0], 'edit');
    });
    await t.test('maximum length entries fit Telegram limits without truncating content', async () => {
        const f = fixture();
        const long = '🛒'.repeat(250);
        f.store.list = async () => ({ items: Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), text: long })), count: 6, page: 0, pages: 1 });
        await showList({ chat: { id: 1 }, reply: async (...args) => f.calls.push(['reply', ...args]) }, f.store, 'products');
        const reply = f.calls.at(-1);
        assert.ok(reply[1].length < 4096);
        assert.ok(reply[1].includes(long));
        for (const row of reply[2].reply_markup.inline_keyboard) {
            for (const button of row) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
        }
    });
});
