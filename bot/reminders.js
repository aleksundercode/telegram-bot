const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function moscowTime(now) {
    const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
async function runReminders(store, send, now = new Date(), allowedChats = new Set(), webURL = null) {
    const { date, hour } = moscowTime(now);
    if (hour < 10) return;
    for await (const chat of store.taskChats()) {
        if (allowedChats.size && !allowedChats.has(String(chat))) continue;
        let token;
        try {
            if (!await store.reminders(chat)) continue;
            const { items, count } = await store.list(chat, 'tasks', 'open', 0, 8);
            if (!count) continue;
            // A new task added after today's scheduled time should wait until tomorrow.
            const scheduledAt = `${date}T07:00:00.000Z`;
            if (!items.some(item => item.createdAt <= scheduledAt)) continue;
            token = await store.claimReminder(chat, date);
            if (!token) continue;
            const preview = items.map((item, i) => `${i + 1}. ${item.text.slice(0, 200)}`).join('\n');
            const button = webURL && Number(chat) > 0
                ? { text: '📋 Открыть дела', web_app: { url: new URL('?tab=tasks', webURL).href } }
                : { text: '📋 Открыть дела', callback_data: 'list:tasks:open:0' };
            await send(chat, `⏰ Незакрытых дел: ${count}\n\n${preview}${count > items.length ? '\n…' : ''}`, {
                reply_markup: { inline_keyboard: [[button]] },
            });
            await store.finishReminder(chat, date, token, true);
        } catch (error) {
            const code = error.response?.error_code;
            if (code === 403) await store.reminders(chat, false);
            if (token) await store.finishReminder(chat, date, token, false);
            console.error(`Reminder failed for chat ${chat}:`, error.description || error.message);
            if (code === 429) return Math.max(30, Number(error.response.parameters?.retry_after) || 30) * 1000;
        }
    }
}
function startReminders(store, send, allowedChats = new Set(), webURL = null) {
    let running = false;
    let nextAttempt = 0;
    const tick = async () => {
        if (running || Date.now() < nextAttempt) return;
        running = true;
        try {
            const retryDelay = await runReminders(store, send, new Date(), allowedChats, webURL);
            nextAttempt = retryDelay ? Date.now() + retryDelay : 0;
        }
        catch (error) { console.error('Reminder scheduler:', error.message); }
        finally { running = false; }
    };
    const timer = setInterval(tick, 30000);
    void tick();
    return () => clearInterval(timer);
}
module.exports = { moscowTime, runReminders, startReminders };
