require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || 'change-me-in-production',
  feed: {
    defaultLimit: parseInt(process.env.FEED_DEFAULT_LIMIT) || 20,
    maxLimit: parseInt(process.env.FEED_MAX_LIMIT) || 100,
  },
  cache: {
    ttlSeconds: parseInt(process.env.CACHE_TTL_SECONDS) || 300,
  },
};
