-- Migration: Persist sessions and OAuth state in Postgres (deploy/scale safe)
-- Created: 2025-12-11
-- Description:
--   - user_sessions: replaces in-memory Map session store (survives redeploys / multiple instances)
--   - oauth_state_store: stores short-lived OAuth state + PKCE verifier (survives redeploys / multiple instances)

-- ---------------------------------------------------------------------------
-- User sessions (Bearer token sessions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  session_token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guest')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

COMMENT ON TABLE user_sessions IS 'Server-side session store (token hashed). Replaces in-memory Map for production safety.';

-- ---------------------------------------------------------------------------
-- OAuth state + PKCE verifier store (short-lived)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_state_store (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  state VARCHAR(255) NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, state)
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_store_provider_state ON oauth_state_store(provider, state);
CREATE INDEX IF NOT EXISTS idx_oauth_state_store_expires_at ON oauth_state_store(expires_at);

COMMENT ON TABLE oauth_state_store IS 'Short-lived OAuth state store (ClickUp, RMS PKCE verifier, etc).';


