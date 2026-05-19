const { createClient } = require('redis');
const config = require('../config');

const redisClient = createClient({ url: config.redisUrl });

redisClient.on('error', (err) => console.error('Redis client error:', err.message));
redisClient.on('connect', () => console.log('Redis connected'));

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

module.exports = { redisClient, connectRedis };
