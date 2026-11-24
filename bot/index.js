const { createDatabase } = require('./db');
const { Store } = require('./models');
const { createBot } = require('./telegram');
const { startReminders } = require('./reminders');

async function main() {
    if (!process.env.TOKEN) throw new Error('Set TOKEN in .env');
    const client = createDatabase();
    await client.connect();
    const store = new Store(client);
    if (process.env.LEGACY_CHAT_ID) console.log('Imported legacy products:', await store.migrateLegacy(process.env.LEGACY_CHAT_ID));
    const bot = createBot(process.env.TOKEN, store, process.env);
    let stopReminders = () => {};
    let stopping = false;
    const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        stopReminders();
        try { bot.stop(signal); } catch { /* Polling may not have started yet. */ }
        if (client.isOpen) await client.quit();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    await bot.telegram.setMyCommands([
        { command: 'products', description: 'Список покупок' },
        { command: 'tasks', description: 'Список дел' },
        { command: 'buy', description: 'Добавить покупку: /buy молоко' },
        { command: 'todo', description: 'Добавить дело: /todo оплатить интернет' },
        { command: 'done', description: 'Завершённые в текущем разделе' },
        { command: 'reminders', description: 'Напоминания: /reminders on или off' },
        { command: 'help', description: 'Как пользоваться' },
    ]);
    // Telegraf launch resolves when polling stops.
    await bot.launch({}, () => {
        const allowed = new Set((process.env.ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
        if (!stopping) stopReminders = startReminders(store, bot.telegram.sendMessage.bind(bot.telegram), allowed);
        console.log('Bot started; reminders at 10:00 Europe/Moscow');
    });
    await shutdown('polling stopped');
}
if (require.main === module) main().catch(error => {
    console.error('Startup failed:', error.description || error.message);
    process.exit(1);
});
module.exports = { main };
