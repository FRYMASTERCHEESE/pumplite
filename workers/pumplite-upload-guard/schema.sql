CREATE TABLE IF NOT EXISTS grants (
  token_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  path TEXT NOT NULL,
  max_bytes INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  image_cid TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  completed_at INTEGER,
  cid TEXT
);

CREATE TABLE IF NOT EXISTS usage_daily (
  subject TEXT NOT NULL,
  day INTEGER NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, day)
);

CREATE TABLE IF NOT EXISTS global_usage (
  day INTEGER PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS owned_images (
  cid TEXT NOT NULL,
  subject TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (cid, subject)
);

CREATE TABLE IF NOT EXISTS issue_challenges (
  nonce_hash TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  subject TEXT NOT NULL,
  path TEXT NOT NULL,
  max_bytes INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  image_cid TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);