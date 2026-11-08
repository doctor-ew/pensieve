CREATE TABLE IF NOT EXISTS connector_clients(id TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_pending(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_codes(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_tokens(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS connector_pending_expiry ON connector_pending(expires);
CREATE INDEX IF NOT EXISTS connector_codes_expiry ON connector_codes(expires);
CREATE INDEX IF NOT EXISTS connector_tokens_expiry ON connector_tokens(expires);
