require('dotenv').config();
const pool = require('./postgres');

const schema = `
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE IF NOT EXISTS feeds (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(200)  NOT NULL,
    content     TEXT          NOT NULL CHECK (char_length(content) <= 5000),
    author      VARCHAR(100)  NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_feeds_created_at ON feeds (created_at DESC);

  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS feeds_updated_at ON feeds;

  CREATE TRIGGER feeds_updated_at
    BEFORE UPDATE ON feeds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('Migration complete — feeds table ready');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
