CREATE TABLE IF NOT EXISTS cognito_login_states(
  digest TEXT PRIMARY KEY,browser TEXT NOT NULL,verifier TEXT NOT NULL,nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,expires BIGINT NOT NULL,created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS cognito_login_expiry ON cognito_login_states(expires);
CREATE INDEX IF NOT EXISTS cognito_login_browser ON cognito_login_states(browser,created);
CREATE TABLE IF NOT EXISTS hosted_sessions(
  digest TEXT PRIMARY KEY,actor TEXT NOT NULL REFERENCES team_users(id),identity JSONB,
  expires BIGINT NOT NULL,created BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS hosted_sessions_expiry ON hosted_sessions(expires);
CREATE INDEX IF NOT EXISTS hosted_sessions_actor ON hosted_sessions(actor,created);
