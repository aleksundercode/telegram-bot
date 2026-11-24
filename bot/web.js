const http = require('node:http');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function telegramUser(raw, token, now = Date.now()) {
    const fields = new URLSearchParams(raw);
    const hash = fields.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    if (new Set(fields.keys()).size !== [...fields].length) return null;
    fields.delete('hash');
    fields.sort();
    const data = [...fields].map(([key, value]) => `${key}=${value}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const expected = createHmac('sha256', secret).update(data).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
    const date = fields.get('auth_date');
    if (!/^\d{1,12}$/.test(date || '') || now - Number(date) * 1000 > 86400000 || Number(date) * 1000 - now > 60000) return null;
    try {
        const { id } = JSON.parse(fields.get('user'));
        return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
    } catch { return null; }
}

class RequestError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

async function readJSON(req) {
    const maxBytes = 65536;
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415, 'Ожидается JSON.');
    if (Number(req.headers['content-length']) > maxBytes) throw new RequestError(413, 'Слишком длинный запрос.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes) throw new RequestError(413, 'Слишком длинный запрос.');
        chunks.push(chunk);
    }
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString());
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
        return value;
    } catch { throw new RequestError(400, 'Некорректный запрос.'); }
}

function createWebServer(store, token, allowedChats) {
    const assets = new Map([
        ['/', ['index.html', 'text/html']],
        ['/app.css', ['app.css', 'text/css']],
        ['/app.js', ['app.js', 'text/javascript']],
    ].map(([path, [file, type]]) => [path, { content: readFileSync(join(__dirname, 'web', file)), type }]));

    return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
        const respond = (status, payload, type = 'application/json') => {
            const body = type === 'application/json' ? JSON.stringify(payload) : payload;
            res.writeHead(status, {
                'Content-Type': `${type}; charset=utf-8`,
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
            });
            res.end(body);
        };
        try {
            const url = new URL(req.url, 'http://localhost');
            const path = url.pathname;
            if (req.method === 'GET' && assets.has(path)) {
                const { type, content } = assets.get(path);
                return respond(200, content, type);
            }
            if (!path.startsWith('/api/')) throw new RequestError(404, 'Страница не найдена.');
            const chat = telegramUser(req.headers['x-telegram-init-data'] || '', token);
            if (!chat) throw new RequestError(401, 'Откройте приложение из чата с ботом в Telegram.');
            if (allowedChats.size && !allowedChats.has(chat)) throw new RequestError(403, 'У этого аккаунта нет доступа.');

            if (path === '/api/reminders') {
                if (req.method === 'GET') return respond(200, { enabled: await store.reminders(chat) });
                if (req.method === 'POST') {
                    const { enabled } = await readJSON(req);
                    if (typeof enabled !== 'boolean') throw new RequestError(400, 'Укажите состояние напоминаний.');
                    return respond(200, { enabled: await store.reminders(chat, enabled) });
                }
            }
            const match = /^\/api\/(products|tasks)(?:\/(\d{1,20})\/(close|restore|delete))?$/.exec(path);
            if (!match) throw new RequestError(404, 'Действие не найдено.');
            const [, kind, id, action] = match;
            if (req.method === 'GET' && !id) {
                const status = url.searchParams.get('status') ?? 'open';
                const page = url.searchParams.get('page') ?? '0';
                if (!['open', 'done'].includes(status) || !/^\d{1,7}$/.test(page)) throw new RequestError(400, 'Некорректный фильтр.');
                return respond(200, await store.list(chat, kind, status, Number(page), 20));
            }
            if (req.method === 'POST' && !id) {
                const { text } = await readJSON(req);
                const lines = typeof text === 'string' ? text.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
                if (!lines.length || lines.length > 20 || lines.some(line => line.length > 500)) {
                    throw new RequestError(400, 'Введите до 20 строк, не больше 500 символов в каждой.');
                }
                await store.addMany(chat, kind, lines);
                return respond(201, { added: lines.length });
            }
            if (req.method === 'POST' && id) {
                const changed = await store.move(chat, kind, id, action === 'close' ? 'open' : 'done', action);
                return respond(200, { changed: Boolean(changed) });
            }
            throw new RequestError(405, 'Метод не поддерживается.');
        } catch (error) {
            if (!error.status) console.error('Mini App request:', error.message);
            if (!res.destroyed) respond(error.status || 500, { error: error.status ? error.message : 'Не удалось выполнить действие. Повторите попытку.' });
        }
    });
}

function miniAppURL(value) {
    if (!value) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
        throw new Error('WEB_APP_URL must be an HTTPS origin, e.g. https://lists.example.com');
    }
    return url.href;
}

module.exports = { createWebServer, telegramUser, miniAppURL };
