const pool = require('../db/postgres');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Client sends this on reconnect to recover missed events
    socket.on('sync', async ({ lastSeenAt }) => {
      try {
        const ts = new Date(lastSeenAt);
        if (isNaN(ts.getTime())) {
          return socket.emit('error', { message: 'Invalid lastSeenAt timestamp' });
        }

        const { rows } = await pool.query(
          `SELECT * FROM feeds WHERE created_at > $1 ORDER BY created_at ASC`,
          [ts.toISOString()]
        );

        socket.emit('feed:catchup', { data: rows });
      } catch (err) {
        console.error('sync handler error:', err.message);
        socket.emit('error', { message: 'Failed to fetch missed events' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerSocketHandlers };
