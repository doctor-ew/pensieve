CREATE TABLE IF NOT EXISTS connector_families(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_refresh(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_revocations(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS connector_families_expiry ON connector_families(expires);
CREATE INDEX IF NOT EXISTS connector_refresh_expiry ON connector_refresh(expires);
CREATE INDEX IF NOT EXISTS connector_revocations_expiry ON connector_revocations(expires);
