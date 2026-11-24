const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHmac } = require('node:crypto');
const { createWebServer, telegramUser } = require('../web');

const token = '123:test';
function signed(id, authDate = Math.floor(Date.now() / 1000)) {
    const data = new URLSearchParams({ user: JSON.stringify({ id }), auth_date: String(authDate), query_id: 'test' });
    data.sort();
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    data.set('hash', createHmac('sha256', secret).update([...data].map(pair => pair.join('=')).join('\n')).digest('hex'));
    return data.toString();
}

test('Telegram login rejects tampered, duplicate and expired fields', () => {
    const valid = signed(17);
    assert.equal(telegramUser(valid, token), '17');
    assert.equal(telegramUser(valid.replace('17%7D', '29%7D'), token), null);
    assert.equal(telegramUser(valid + '&user=%7B%22id%22%3A29%7D', token), null);
    assert.equal(telegramUser(signed(17, 1000), token), null);
    assert.equal(telegramUser(signed(17, Math.floor(Date.now() / 1000) + 300), token), null);
});

test('HTTP lists and mutations are scoped to signed private chat', async () => {
    const calls = [];
    const store = {
        async list(...args) { calls.push(['list', ...args]); return { items: [], count: 0, page: 0, pages: 0 }; },
        async addMany(...args) { calls.push(['addMany', ...args]); },
        async move(...args) { calls.push(['move', ...args]); return 1; },
        async reminders(...args) { calls.push(['reminders', ...args]); return args[1] ?? true; },
    };
    const server = createWebServer(store, token, new Set(['17']));
    const request = (method, url, initData, body) => new Promise(resolve => {
        const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
        Object.assign(req, { method, url, headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData } });
        let status;
        server.emit('request', req, {
            writeHead(code) { status = code; },
            end(payload) { resolve({ status, text: () => String(payload), json: () => JSON.parse(payload) }); },
        });
    });
    const get = (path, initData = signed(17)) => request('GET', path, initData);
    const post = (path, body) => request('POST', path, signed(17), body);
    assert.match(await (await get('/')).text(), /Мои списки/);
    assert.equal((await get('/app.js')).status, 200);
    assert.equal((await get('/api/tasks', '')).status, 401);
    assert.equal((await get('/api/tasks', signed(29))).status, 403);
    assert.equal((await get('/api/tasks?page=-1')).status, 400);
    assert.equal((await get('/api/tasks?status=done&page=2&chat=29')).status, 200);
    assert.equal((await post('/api/tasks', { text: '  Позвонить \n Купить билет', chat: 29 })).status, 201);
    assert.equal((await post('/api/tasks', { text: 'Валидно\n' + 'а'.repeat(501) })).status, 400);
    assert.equal((await post('/api/products/73/restore', {})).status, 200);
    assert.deepEqual(await (await post('/api/reminders', { enabled: false })).json(), { enabled: false });
    assert.deepEqual(calls, [
        ['list', '17', 'tasks', 'done', 2, 20],
        ['addMany', '17', 'tasks', ['Позвонить', 'Купить билет']],
        ['move', '17', 'products', '73', 'done', 'restore'],
        ['reminders', '17', false],
    ]);
});
