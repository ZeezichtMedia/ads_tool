-- ============================================================
-- Multi Meta Ad Account Support
-- ============================================================

-- 1. Accounts table — stores which ad accounts to monitor
CREATE TABLE IF NOT EXISTS meta_accounts (
  id TEXT PRIMARY KEY,              -- e.g. 'act_1013018310892956'
  name TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with the 3 known accounts
INSERT INTO meta_accounts (id, name, is_enabled) VALUES
  ('act_1013018310892956', 'ESM4022 - Joanne Teresa London - 1', true),
  ('act_2629898674023677', '1832 - 70025 - ESM4022 - Joanne Teresa London - 3 - ESM', true),
  ('act_799061622743425', '2370 - 70025 - ESM4022 - Ivy & Iris London - 1 - ESM2', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Add account_id to adset_snapshots_v2
ALTER TABLE adset_snapshots_v2
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- 3. Add account_id to daily_stats
ALTER TABLE daily_stats
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- Drop the old unique constraint on stat_date so we can have one row per account per day
ALTER TABLE daily_stats DROP CONSTRAINT IF EXISTS daily_stats_stat_date_key;

-- New unique constraint: one row per account per day
ALTER TABLE daily_stats ADD CONSTRAINT daily_stats_account_date_unique UNIQUE (account_id, stat_date);

-- 4. Add account_id to alert_log
ALTER TABLE alert_log
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- 5. Indexes for account_id filtering
CREATE INDEX IF NOT EXISTS idx_snapshots_v2_account ON adset_snapshots_v2 (account_id);
CREATE INDEX IF NOT EXISTS idx_daily_stats_account ON daily_stats (account_id);
CREATE INDEX IF NOT EXISTS idx_alert_log_account ON alert_log (account_id);

-- 6. Backfill existing data with current account
UPDATE adset_snapshots_v2 SET account_id = 'act_1013018310892956' WHERE account_id IS NULL;
UPDATE daily_stats SET account_id = 'act_1013018310892956' WHERE account_id IS NULL;
UPDATE alert_log SET account_id = 'act_1013018310892956' WHERE account_id IS NULL;

-- 7. RLS: Allow anon access to meta_accounts (same pattern as other tables)
ALTER TABLE meta_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read meta_accounts" ON meta_accounts FOR SELECT USING (true);
CREATE POLICY "Allow anon insert meta_accounts" ON meta_accounts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update meta_accounts" ON meta_accounts FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete meta_accounts" ON meta_accounts FOR DELETE USING (true);
