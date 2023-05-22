const redis = require('redis');
const { promisify } = require('util');

const client = redis.createClient({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT
});

client.on('error', err => {
    console.error('Redis error:', err);
});

const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const delAsync = promisify(client.del).bind(client);
const keysAsync = promisify(client.keys).bind(client);

module.exports = {
    getAsync,
    setAsync,
    delAsync,
    keysAsync
};