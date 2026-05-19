const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/postgres');
const { redisClient } = require('../db/redis');
const { requireAdmin } = require('../middleware/auth');
const config = require('../config');

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function cacheKey(page, limit) {
  return `feed:list:${page}:${limit}`;
}

function clampLimit(raw) {
  return Math.min(
    parseInt(raw) || config.feed.defaultLimit,
    config.feed.maxLimit
  );
}

async function scanDeletePattern(pattern) {
  let cursor = 0;
  do {
    const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = reply.cursor;
    if (reply.keys.length) {
      await redisClient.del(reply.keys);
    }
  } while (cursor !== 0);
}

// ─── GET /api/feed ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = clampLimit(req.query.limit);
  const key   = cacheKey(page, limit);

  try {
    // cache check
    const cached = await redisClient.get(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      parsed.meta.source = 'cache';
      return res.json(parsed);
    }

    // db fetch
    const offset = (page - 1) * limit;
    const [{ rows: data }, { rows: countRows }] = await Promise.all([
      pool.query(
        `SELECT * FROM feeds ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM feeds`),
    ]);

    const payload = {
      data,
      meta: { page, limit, total: countRows[0].count, source: 'db' },
    };

    await redisClient.setEx(key, config.cache.ttlSeconds, JSON.stringify(payload));
    return res.json(payload);
  } catch (err) {
    console.error('GET /feed error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /api/feed ────────────────────────────────────────────────────────

const postValidators = [
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 200 }).withMessage('title max 200 chars'),
  body('content').trim().notEmpty().withMessage('content is required').isLength({ max: 5000 }).withMessage('content exceeds 5000 characters'),
  body('author').trim().notEmpty().withMessage('author is required').isLength({ max: 100 }).withMessage('author max 100 chars'),
];

router.post('/', requireAdmin, postValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation failed',
      details: errors.array().map((e) => e.msg),
    });
  }

  const { title, content, author } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO feeds (title, content, author)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), content.trim(), author.trim()]
    );

    const row = rows[0];

    // Invalidate cache so next read reflects the new post immediately
    await scanDeletePattern('feed:list:*');

    // broadcast via socket — io injected by server.js
    const io = req.app.get('io');
    if (io) {
      io.emit('feed:new', { eventId: uuidv4(), data: row });
    }

    return res.status(201).json({ data: row });
  } catch (err) {
    console.error('POST /feed error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /api/feed/:id ─────────────────────────────────────────────────────

const putValidators = [
  body('title').optional().trim().notEmpty().isLength({ max: 200 }),
  body('content').optional().trim().notEmpty().isLength({ max: 5000 }),
  body('author').optional().trim().notEmpty().isLength({ max: 100 }),
];

router.put('/:id', requireAdmin, putValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed', details: errors.array().map((e) => e.msg) });
  }

  const { id } = req.params;
  const { title, content, author } = req.body;

  if (!title && !content && !author) {
    return res.status(400).json({ error: 'Provide at least one field to update' });
  }

  try {
    const sets = [];
    const values = [];
    let idx = 1;
    if (title)   { sets.push(`title = $${idx++}`);   values.push(title.trim()); }
    if (content) { sets.push(`content = $${idx++}`); values.push(content.trim()); }
    if (author)  { sets.push(`author = $${idx++}`);  values.push(author.trim()); }
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE feeds SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Feed item not found' });

    // invalidate all pages for this limit (conservative: delete all feed:list:* keys)
    await scanDeletePattern('feed:list:*');

    return res.json({ data: rows[0] });
  } catch (err) {
    console.error('PUT /feed/:id error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /api/feed/:id ──────────────────────────────────────────────────

router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `DELETE FROM feeds WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Feed item not found' });

    await scanDeletePattern('feed:list:*');

    return res.status(200).json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('DELETE /feed/:id error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
