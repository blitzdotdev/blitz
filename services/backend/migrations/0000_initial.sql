-- Blitz games platform schema. Blobs are shared and are never deleted by expiry.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "_ddb_internal_kv" (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expiry INTEGER NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT 0,
  password TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  role TEXT,
  meta JSON,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TRIGGER tgr_users_raise_on_created_update
BEFORE UPDATE OF created ON users
BEGIN
  SELECT RAISE(FAIL, 'Cannot update created column') WHERE OLD.created != NEW.created;
END;

CREATE TABLE games (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'creating' CHECK (state IN ('creating', 'open', 'cleaning')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  expires_at TEXT,
  anon_meta TEXT,
  claim_secret_hash TEXT,
  active_release TEXT,
  bytes_used INTEGER NOT NULL DEFAULT 0 CHECK (bytes_used >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_games_owner_id ON games(owner_id);
CREATE UNIQUE INDEX idx_games_slug ON games(slug);
CREATE INDEX idx_games_expires_at ON games(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_games_cleaning ON games(updated_at) WHERE state = 'cleaning';

CREATE TABLE game_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  token_prefix TEXT NOT NULL,
  last_used_at TEXT,
  revoked BOOLEAN NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_game_tokens_game_id ON game_tokens(game_id);

CREATE TABLE releases (
  id TEXT PRIMARY KEY NOT NULL,
  release_hash TEXT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  message TEXT
);

CREATE UNIQUE INDEX idx_releases_game_hash ON releases(game_id, release_hash);
CREATE INDEX idx_releases_game_created ON releases(game_id, created_at DESC);

-- Checked-in sentinel owner for anonymous games. Login is intentionally disabled.
INSERT OR IGNORE INTO users (
  id, username, email, email_verified, password, password_salt, name, role, status
) VALUES (
  '2f762445-2953-4021-b22e-60f564e6486c',
  'anon',
  'anon@blitz.internal',
  1,
  '!disabled-no-login',
  '!disabled-no-login',
  'Anonymous Blitz game',
  'anon',
  'active'
);
