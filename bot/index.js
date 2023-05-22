const TelegramBot = require('node-telegram-bot-api');
const { addProduct, getAllProducts, deleteProductById } = require('./models');

const token = process.env.TOKEN;

const bot = new TelegramBot(token, { polling: true });

bot.setMyCommands([
    { command: '/products', description: 'Показать список продуктов' }
]);

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const product = msg.text;
    const id = msg.message_id;

    for (let i = 0; i < 10; i++) {
        bot.deleteMessage(chatId, id - i);
    }

    if (product === '/start') {
        return bot.sendMessage(chatId, 'Привет');
    }
    if (product === '/products') {
        return collectList(chatId);
    } else {
        await addProduct(product);
        return bot.sendMessage(chatId, `Добавил ${product} в список покупок`);
    }
});

bot.on('callback_query', async (msg) => {
    const data = msg.data;
    const chatId = msg.message.chat.id; // обновлено для обработчика callback_query
    try {
        await deleteProductById(data);
        bot.deleteMessage(chatId, msg.message.message_id);
    } catch (e) {
        console.log(e);
        console.log('Failed destroy', e);
    }
    return collectList(chatId);
});

const collectList = async (chatId) => { // передаем chatId как параметр
    const products = await getAllProducts();
    const productList = products.map((product) => product.product);
    const productsOptions = {
        reply_markup: JSON.stringify({
            inline_keyboard: products.map((x) => ([{
                text: x.product,
                callback_data: String(x.id),
            }])),
        }),
    };

    if (productsOptions.reply_markup === '{"inline_keyboard":[]}') {
        return bot.sendMessage(chatId, 'Список пустой');
    } else {
        return bot.sendMessage(chatId, 'Список продуктов:', productsOptions);
    }
};