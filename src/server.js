require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config');
const { connectRedis } = require('./db/redis');
const feedRouter = require('./routes/feed');
const { registerSocketHandlers } = require('./socket');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ─── middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// make io accessible inside route handlers
app.set('io', io);

// ─── routes ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/feed', feedRouter);

// ─── token generation helper (dev only) ───────────────────────────────────────
// Hit GET /dev/token to get a signed admin JWT for testing
if (process.env.NODE_ENV !== 'production') {
  const jwt = require('jsonwebtoken');
  app.get('/dev/token', (_req, res) => {
    const token = jwt.sign({ role: 'admin', sub: 'dev-admin' }, config.adminJwtSecret, { expiresIn: '7d' });
    res.json({ token });
  });
}

// 404 catch-all — must be last
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── socket handlers ──────────────────────────────────────────────────────────
registerSocketHandlers(io);

// ─── start ────────────────────────────────────────────────────────────────────
async function start() {
  await connectRedis();
  httpServer.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    console.log(`WebSocket ready on ws://localhost:${config.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
