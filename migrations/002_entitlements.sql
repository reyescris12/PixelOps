-- Migration 002: Cloudflare D1 Entitlement Skeleton (Operative | Pro | Station Chief)
-- Adds tier entitlements, managed sweep credits, Stripe customer linkage, and fast lookup indexes.

ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'operative';
ALTER TABLE users ADD COLUMN sweeps_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_data_user_id ON user_data(user_id);
