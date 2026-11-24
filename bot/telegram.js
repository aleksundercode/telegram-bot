const { Telegraf, Markup } = require('telegraf');
const HELP = '🛒 Покупки и 📋 Дела\n\nВыберите раздел кнопкой, затем отправьте текст. Несколько строк — несколько записей (до 20 за раз).\n\n/buy молоко — добавить покупку\n/todo оплатить интернет — добавить дело\n/products — покупки\n/tasks — дела\n/done — завершённые в текущем разделе\n\nНажатие на запись закрывает её; в завершённых можно восстановить или удалить.\n\n⏰ Каждый день в 10:00 МСК напомню об открытых делах.\n/reminders off — выключить\n/reminders on — включить\n\nВ группе список общий для чата. Выбор раздела у каждого участника свой. Для обычного текста в группе отключите Privacy Mode через BotFather или используйте /buy и /todo.';
const menu = Markup.keyboard([['🛒 Покупки', '📋 Дела'], ['✅ Завершённые', 'ℹ️ Помощь']]).resize();
const short = text => text.length > 55 ? `${text.slice(0, 52).replace(/[\uD800-\uDBFF]$/, '')}…` : text;

async function showList(ctx, store, kind, status = 'open', page = 0, edit = false) {
    const result = await store.list(ctx.chat.id, kind, status, page);
    const title = kind === 'tasks' ? '📋 Дела' : '🛒 Покупки';
    const lines = result.items.map((item, i) => `${result.page * 6 + i + 1}. ${item.text}`);
    const text = `${title} · ${status === 'open' ? 'открытые' : 'завершённые'}: ${result.count}\n\n` +
        (lines.join('\n') || 'Список пуст.');
    const rows = result.items.map(item => {
        const prefix = `item:${kind}:${status}:${item.id}:${result.page}`;
        return status === 'open'
            ? [Markup.button.callback(`☑️ ${short(item.text)}`, `${prefix}:close`)]
            : [Markup.button.callback(`↩️ ${short(item.text)}`, `${prefix}:restore`), Markup.button.callback('🗑', `${prefix}:delete`)];
    });
    const nav = [];
    if (result.page > 0) nav.push(Markup.button.callback('←', `list:${kind}:${status}:${result.page - 1}`));
    if (result.page + 1 < result.pages) nav.push(Markup.button.callback('→', `list:${kind}:${status}:${result.page + 1}`));
    if (nav.length) rows.push(nav);
    rows.push([Markup.button.callback(status === 'open' ? '✅ Завершённые' : '📂 Открытые', `list:${kind}:${status === 'open' ? 'done' : 'open'}:0`)]);
    const options = Markup.inlineKeyboard(rows);
    if (edit) {
        try { return await ctx.editMessageText(text, options); }
        catch (error) {
            if (error.description?.includes('message is not modified')) return;
            if (!error.description?.includes("message can't be edited") && !error.description?.includes('message to edit not found')) throw error;
        }
    }
    return ctx.reply(text, options);
}
function createBot(token, store, env = {}) {
    const bot = new Telegraf(token);
    const allowed = new Set((env.ALLOWED_CHAT_IDS || '').split(',').map(id => id.trim()).filter(Boolean));
    bot.use(async (ctx, next) => {
        if (!ctx.chat || ctx.from?.is_bot) return;
        if (allowed.size && !allowed.has(String(ctx.chat.id))) {
            if (ctx.callbackQuery) await ctx.answerCbQuery('Нет доступа');
            return;
        }
        return next();
    });
    const setMode = async (ctx, kind) => {
        await store.mode(ctx.chat.id, ctx.from.id, kind);
        return showList(ctx, store, kind);
    };
    const add = async (ctx, kind, text) => {
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        if (!lines.length || lines.length > 20 || lines.some(line => line.length > 500)) return ctx.reply('Отправьте от 1 до 20 строк, до 500 символов в каждой.');
        await store.mode(ctx.chat.id, ctx.from.id, kind);
        for (const line of lines) await store.add(ctx.chat.id, kind, line);
        await ctx.reply(`Добавлено: ${lines.length}. ${kind === 'tasks' ? '📋 Дела' : '🛒 Покупки'}`, menu);
        return showList(ctx, store, kind);
    };
    bot.start(ctx => ctx.reply(HELP, menu));
    bot.help(ctx => ctx.reply(HELP, menu));
    bot.hears('ℹ️ Помощь', ctx => ctx.reply(HELP, menu));
    bot.command('products', ctx => setMode(ctx, 'products'));
    bot.command('tasks', ctx => setMode(ctx, 'tasks'));
    bot.hears('🛒 Покупки', ctx => setMode(ctx, 'products'));
    bot.hears('📋 Дела', ctx => setMode(ctx, 'tasks'));
    bot.command('buy', ctx => add(ctx, 'products', ctx.message.text.replace(/^\S+\s*/, '')));
    bot.command('todo', ctx => add(ctx, 'tasks', ctx.message.text.replace(/^\S+\s*/, '')));
    const done = async ctx => showList(ctx, store, await store.mode(ctx.chat.id, ctx.from.id), 'done');
    bot.command('done', done);
    bot.hears('✅ Завершённые', done);
    bot.command('reminders', async ctx => {
        const arg = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
        if (arg && !['on', 'off'].includes(arg)) return ctx.reply('Используйте /reminders on или /reminders off.');
        if (arg && ctx.chat.type !== 'private') {
            const member = await ctx.getChatMember(ctx.from.id);
            if (!['creator', 'administrator'].includes(member.status)) return ctx.reply('Настройки напоминаний меняет администратор группы.');
        }
        const enabled = await store.reminders(ctx.chat.id, arg ? arg === 'on' : undefined);
        return ctx.reply(`⏰ Напоминания ${enabled ? 'включены: ежедневно в 10:00 МСК, если есть открытые дела' : 'выключены'}.`);
    });
    bot.action(/^list:(products|tasks):(open|done):(\d{1,6})$/, async ctx => {
        await ctx.answerCbQuery();
        await store.mode(ctx.chat.id, ctx.from.id, ctx.match[1]);
        return showList(ctx, store, ctx.match[1], ctx.match[2], Number(ctx.match[3]), true);
    });
    bot.action(/^item:(products|tasks):(open|done):(\d+):(\d{1,6}):(close|restore|delete)$/, async ctx => {
        const [, kind, status, id, page, action] = ctx.match;
        if ((status === 'open' && action !== 'close') || (status === 'done' && action === 'close')) return ctx.answerCbQuery('Некорректное действие');
        const changed = await store.move(ctx.chat.id, kind, id, status, action);
        await ctx.answerCbQuery(changed ? ({ close: 'Готово ✅', restore: 'Восстановлено', delete: 'Удалено' })[action] : 'Запись уже изменена');
        return showList(ctx, store, kind, status, Number(page), true);
    });
    bot.on('callback_query', ctx => ctx.answerCbQuery('Откройте обновлённый список через /products или /tasks.'));
    bot.on('text', async ctx => {
        if (ctx.message.text.startsWith('/')) return ctx.reply('Неизвестная команда. /help — справка.');
        return add(ctx, await store.mode(ctx.chat.id, ctx.from.id), ctx.message.text);
    });
    bot.catch(async (error, ctx) => {
        console.error('Telegram update failed:', error.description || error.message);
        try { await ctx.reply('Не удалось выполнить действие. Попробуйте ещё раз.'); } catch { /* Chat may be unavailable. */ }
    });
    return bot;
}
module.exports = { createBot, showList };
