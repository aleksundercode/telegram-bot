const { createClient } = require('redis');

function createDatabase(env = process.env) {
    const client = createClient({
        url: env.REDIS_URL || `redis://${env.DB_HOST || 'localhost'}:${env.DB_PORT || 6379}`,
        disableOfflineQueue: true,
        socket: { connectTimeout: 10000 },
    });
    client.on('error', error => console.error('Redis:', error.message));
    return client;
}

module.exports = { createDatabase };
