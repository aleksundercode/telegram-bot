const { getAsync, setAsync, delAsync, keysAsync } = require('./db');

const addProduct = async (product) => {
    const id = await getAsync('nextProductId');
    if (id === null) {
        await setAsync('nextProductId', 1);
    } else {
        await setAsync('nextProductId', parseInt(id) + 1);
    }
    await setAsync(`product:${id}`, product);
    return id;
};

const getAllProducts = async () => {
    const keys = await keysAsync('product:*');
    const products = [];
    for (const key of keys) {
        const product = await getAsync(key);
        products.push({ id: key.split(':')[1], product });
    }
    return products;
};

const deleteProductById = async (id) => {
    await delAsync(`product:${id}`);
};

module.exports = {
    addProduct,
    getAllProducts,
    deleteProductById
};