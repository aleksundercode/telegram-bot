const TelegramBot = require('node-telegram-bot-api');
const sequelize = require('./db');
const ProductsModel = require('./models');

const token = process.env.TOKEN

const bot = new TelegramBot(token, {polling: true});

const start = async () => {
    try {
        await sequelize.authenticate()
        await sequelize.sync()
    } catch (e) {
        console.log('Failed connecto to DB', e)
    }

    bot.setMyCommands( [
        {command: '/products', description: 'Показать список продуктов'}
    ])

    bot.on('message', async (msg) => {
        chatId = msg.chat.id;
        product = msg.text;
        id = msg.message_id;

        for (let i = 0; i < 10; i++) {
            bot.deleteMessage(chatId,id-i)
        }

        try {
            if ( product === '/start' ) {
               return await bot.sendMessage(chatId, "Привет")
            }
            if ( product === '/products') {
                 collectList = async () => {
                    const products = await collectProducts()

                    const replyOptions = {
                        reply_markup: {
                            resize_keyboard: true,
                            keyboard: [
                            ],
                        },
                    };

                    const productsOptions = await {
                         reply_markup: JSON.stringify({
                            //  one_time_keyboard: true,
                              inline_keyboard: products.map((x, xi) => ([{
                                text: x,
                                callback_data: String(x)
                            }])),
                        }),
                    };  

                    // { reply_markup: '{"inline_keyboard":[]}' }
                    // console.log(productsOptions.reply_markup);

                    if (productsOptions.reply_markup === '{"inline_keyboard":[]}') {
                        return bot.sendMessage(chatId, 'Список пустой')
                    } else {
                        return bot.sendMessage(chatId, 'Список продуктов:', productsOptions)
                    }
                }
                return collectList()
            }

            await ProductsModel.create({product})

            return bot.sendMessage(chatId, `Добавил ${product} в список покупок`);

        } catch (e) {
            console.log(e)
            return bot.sendMessage(chatId, 'ошибочка');
        }

    });

    bot.on('callback_query', async msg => {
        const data = msg.data;
        try {
        await ProductsModel.destroy({
            where: {
              product: data
            }
        });
        bot.deleteMessage(chatId, msg.message.message_id);
        } catch (e) {
            console.log(e)
            console.log('Failed destory', e)
        }
        return collectList()
    })
}

const collectProducts = async () => {
        const products = await ProductsModel.findAll({
            attributes: ['product']
        });
        return productList(products)
}

const productList = (product) => {
    try {
        listProducts = []

        product.forEach(id => {

            listProducts.push(id.product)

        });

    } catch (e) {
        console.log(e)
        console.log('Failed build list products', e)
    }
    return listProducts
}

start()