const { createDatabase } = require('./db');
const { Store } = require('./models');
const { createBot } = require('./telegram');
const { startReminders } = require('./reminders');
const { createWebServer, miniAppURL } = require('./web');

async function main() {
    if (!process.env.TOKEN) throw new Error('Set TOKEN in .env');
    const webURL = miniAppURL(process.env.WEB_APP_URL);
    const allowed = new Set((process.env.ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
    const client = createDatabase();
    await client.connect();
    const store = new Store(client);
    if (process.env.LEGACY_CHAT_ID) console.log('Imported legacy products:', await store.migrateLegacy(process.env.LEGACY_CHAT_ID));
    const bot = createBot(process.env.TOKEN, store, process.env, webURL);
    const server = webURL ? createWebServer(store, process.env.TOKEN, allowed) : null;
    if (server) {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(8080, '0.0.0.0', resolve);
        });
        console.log('Mini App HTTP server ready on port 8080');
    }
    let stopReminders = () => {};
    let stopping = false;
    const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        stopReminders();
        server?.close();
        try { bot.stop(signal); } catch { /* Polling may not have started yet. */ }
        if (client.isOpen) await client.quit();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    const commands = [
        { command: 'products', description: 'Список покупок' },
        { command: 'tasks', description: 'Список дел' },
        { command: 'buy', description: 'Добавить покупку: /buy молоко' },
        { command: 'todo', description: 'Добавить дело: /todo оплатить интернет' },
        { command: 'done', description: 'Завершённые в текущем разделе' },
        { command: 'reminders', description: 'Напоминания: /reminders on или off' },
        { command: 'help', description: 'Как пользоваться' },
    ];
    await bot.telegram.setMyCommands(commands);
    await bot.telegram.setMyCommands(webURL ? [
        { command: 'start', description: 'Открыть списки' },
        { command: 'help', description: 'Как открыть списки' },
    ] : commands, { scope: { type: 'all_private_chats' } });
    await bot.telegram.callApi('setChatMenuButton', {
        menu_button: webURL ? { type: 'web_app', text: 'Мои списки', web_app: { url: webURL } } : { type: 'default' },
    });
    // Telegraf launch resolves when polling stops.
    await bot.launch({}, () => {
        if (!stopping) stopReminders = startReminders(store, bot.telegram.sendMessage.bind(bot.telegram), allowed, webURL);
        console.log('Bot started; reminders at 10:00 Europe/Moscow');
    });
    await shutdown('polling stopped');
}
if (require.main === module) main().catch(error => {
    console.error('Startup failed:', error.description || error.message);
    process.exit(1);
});
module.exports = { main };
