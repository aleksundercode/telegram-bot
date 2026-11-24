const { test } = require('node:test');
const assert = require('node:assert/strict');
const { moscowTime, runReminders } = require('../reminders');

function fixture(chats = ['1']) {
    const sent = new Map();
    const disabled = new Set();
    const completed = new Set();
    const messages = [];
    const store = {
        async *taskChats() { yield* chats; },
        async reminders(chat, enabled) {
            if (enabled === false) disabled.add(chat);
            return !disabled.has(chat);
        },
        async list(chat) {
            return completed.has(chat) ? { items: [], count: 0 } : { items: [{ text: 'Оплатить интернет', createdAt: '2026-11-24T06:00:00.000Z' }], count: 1 };
        },
        async claimReminder(chat, date) {
            const key = `${chat}:${date}`;
            if (sent.has(key)) return null;
            sent.set(key, 'token');
            return 'token';
        },
        async finishReminder(chat, date, token, success) {
            if (success) sent.set(`${chat}:${date}`, 'sent');
            else sent.delete(`${chat}:${date}`);
        },
    };
    return { store, sent, disabled, completed, messages, send: async (...args) => messages.push(args) };
}
test('Moscow 10:00 is UTC 07:00, with correct date around midnight', () => {
    assert.deepEqual(moscowTime(new Date('2026-11-24T07:00:00Z')), { date: '2026-11-24', hour: 10 });
    assert.deepEqual(moscowTime(new Date('2026-11-24T21:00:00Z')), { date: '2026-11-25', hour: 0 });
});
test('no reminder before 10; once at 10; next day sends again', async () => {
    const f = fixture();
    await runReminders(f.store, f.send, new Date('2026-11-24T06:59:59Z'));
    assert.equal(f.messages.length, 0);
    await runReminders(f.store, f.send, new Date('2026-11-24T07:00:00Z'));
    await runReminders(f.store, f.send, new Date('2026-11-24T07:00:30Z'));
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0][1], /Оплатить интернет/);
    await runReminders(f.store, f.send, new Date('2026-11-25T07:00:00Z'));
    assert.equal(f.messages.length, 2);
});
test('catch up after restart, but not in next day before 10', async () => {
    const f = fixture();
    await runReminders(f.store, f.send, new Date('2026-11-24T15:00:00Z'));
    await runReminders(f.store, f.send, new Date('2026-11-24T21:01:00Z'));
    assert.equal(f.messages.length, 1);
});
test('tasks created after 10 wait until the next scheduled morning', async () => {
    const f = fixture();
    f.store.list = async () => ({ items: [{ text: 'Новое дело', createdAt: '2026-11-24T08:00:00.000Z' }], count: 1 });
    await runReminders(f.store, f.send, new Date('2026-11-24T09:00:00Z'));
    assert.equal(f.messages.length, 0);
    await runReminders(f.store, f.send, new Date('2026-11-25T07:00:00Z'));
    assert.equal(f.messages.length, 1);
});
test('skip empty lists, disabled chats and disallowed chats', async () => {
    const f = fixture(['empty', 'disabled', 'forbidden', 'ok']);
    f.completed.add('empty');
    f.disabled.add('disabled');
    await runReminders(f.store, f.send, new Date('2026-11-24T07:00:00Z'), new Set(['empty', 'disabled', 'ok']));
    assert.deepEqual(f.messages.map(m => m[0]), ['ok']);
});
test('failed delivery retries and does not block another chat', async () => {
    const f = fixture(['1', '2']);
    await runReminders(f.store, async (chat, ...rest) => {
        if (chat === '1') throw new Error('Temporary delivery failure');
        return f.send(chat, ...rest);
    }, new Date('2026-11-24T07:00:00Z'));
    await runReminders(f.store, f.send, new Date('2026-11-24T07:01:00Z'));
    assert.deepEqual(f.messages.map(m => m[0]), ['2', '1']);
});
test('blocked bot disables reminders; rate limit stops the current pass', async () => {
    const f = fixture(['1', '2']);
    await runReminders(f.store, async () => { throw { response: { error_code: 403 } }; }, new Date('2026-11-24T07:00:00Z'));
    assert.deepEqual([...f.disabled], ['1', '2']);
    const g = fixture(['1', '2']);
    let attempts = 0;
    await runReminders(g.store, async () => { attempts++; throw { response: { error_code: 429 } }; }, new Date('2026-11-24T07:00:00Z'));
    assert.equal(attempts, 1);
});
test('parallel scheduler passes do not duplicate messages', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 5 }, () => runReminders(f.store, f.send, new Date('2026-11-24T07:00:00Z'))));
    assert.equal(f.messages.length, 1);
});
