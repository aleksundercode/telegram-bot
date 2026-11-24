const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../models');

test('real Redis: isolation, concurrent IDs, transitions, pagination, migration and persisted reminders', {
    skip: !process.env.TEST_REDIS_URL,
}, async () => {
    // Explicit opt-in to a dedicated nonzero database; never fall back to production settings.
    const url = new URL(process.env.TEST_REDIS_URL);
    assert.match(url.pathname, /^\/[1-9]\d*$/, 'Use a dedicated nonzero test database');
    const { createClient } = require('redis');
    const client = createClient({ url: url.toString() });
    client.on('error', () => {});
    await client.connect();
    try {
        await client.flushDb();
        const store = new Store(client);
        const ids = await Promise.all(Array.from({ length: 30 }, (_, i) => store.add(100, 'tasks', `Дело ${i}`)));
        assert.equal(new Set(ids).size, 30);
        await store.add(100, 'products', 'Молоко');
        await store.add(200, 'tasks', 'Другое дело');
        assert.equal((await store.list(100, 'tasks')).count, 30);
        assert.equal((await store.list(100, 'products')).count, 1);
        assert.equal((await store.list(200, 'tasks')).count, 1);
        assert.equal((await store.list(100, 'tasks', 'open', 1)).items.length, 6);
        assert.equal((await store.list(100, 'tasks', 'open', 999)).page, 4);
        assert.equal(await store.move(200, 'tasks', ids[0], 'open', 'close'), 0);
        const results = await Promise.all([store.move(100, 'tasks', ids[0], 'open', 'close'), store.move(100, 'tasks', ids[0], 'open', 'close')]);
        assert.equal(results.reduce((a, b) => a + b), 1);
        assert.equal((await store.list(100, 'tasks', 'done')).count, 1);
        await store.move(100, 'tasks', ids[0], 'done', 'restore');
        assert.equal((await store.list(100, 'tasks')).count, 30);
        await store.move(100, 'tasks', ids[0], 'open', 'close');
        await store.move(100, 'tasks', ids[0], 'done', 'delete');
        assert.equal((await store.list(100, 'tasks', 'done')).count, 0);
        assert.equal(await client.exists(`v2:chat:100:tasks:item:${ids[0]}`), 0);
        await store.mode(100, 1, 'tasks');
        assert.equal(await store.mode(100, 1), 'tasks');
        assert.equal(await store.mode(100, 2), 'products');
        await store.reminders(100, false);
        assert.equal(await new Store(client).reminders(100), false);
        const chats = [];
        for await (const chat of store.taskChats()) chats.push(chat);
        assert.deepEqual(chats.sort(), ['100', '200']);
        await client.set('product:null', 'Старый первый продукт');
        await client.set('product:1', 'Старый второй продукт');
        assert.equal(await store.migrateLegacy('100'), 2);
        assert.equal(await store.migrateLegacy('100'), 0);
        assert.equal((await store.list(100, 'products')).count, 3);
        await assert.rejects(store.migrateLegacy('200'), /another chat/);
        assert.equal(await client.get('product:null'), 'Старый первый продукт');
        const token = await store.claimReminder(100, '2026-11-24');
        assert.ok(token);
        assert.equal(await new Store(client).claimReminder(100, '2026-11-24'), null);
        await store.finishReminder(100, '2026-11-24', 'wrong-owner', false);
        assert.equal(await store.claimReminder(100, '2026-11-24'), null);
        await store.finishReminder(100, '2026-11-24', token, false);
        const retry = await store.claimReminder(100, '2026-11-24');
        assert.ok(retry);
        await store.finishReminder(100, '2026-11-24', retry, true);
        assert.equal(await new Store(client).claimReminder(100, '2026-11-24'), null);
        assert.ok(await store.claimReminder(100, '2026-11-25'));
    } finally {
        await client.flushDb();
        await client.quit();
    }
});
