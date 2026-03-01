-- ============================================================
-- META Alert Service — Database Schema
-- Run once on first deploy (or auto-runs via initDb())
-- ============================================================

-- Alert deduplication log
-- UNIQUE constraint ensures one alert per adset per rule per day
CREATE TABLE IF NOT EXISTS alert_log (
  id            SERIAL PRIMARY KEY,
  adset_id      TEXT NOT NULL,
  rule_name     TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'medium',
  spend_at_alert NUMERIC(10, 2),
  message       TEXT,
  alerted_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Prevent duplicate alerts: same adset + same rule + same day
  UNIQUE(adset_id, rule_name, (alerted_at::date))
);

-- Index for fast lookups during dedup check
CREATE INDEX IF NOT EXISTS idx_alert_log_dedup
  ON alert_log (adset_id, rule_name, alerted_at);

-- Index for dashboard queries (recent alerts)
CREATE INDEX IF NOT EXISTS idx_alert_log_recent
  ON alert_log (alerted_at DESC);

-- ──────────────────────────────────────────────────────────

-- Adset snapshots — raw metrics captured every poll cycle
-- Feeds the dashboard with historical data
CREATE TABLE IF NOT EXISTS adset_snapshots (
  id              SERIAL PRIMARY KEY,
  adset_id        TEXT NOT NULL,
  adset_name      TEXT,
  campaign_name   TEXT,
  spend           NUMERIC(10, 2) DEFAULT 0,
  cpc             NUMERIC(10, 4) DEFAULT 0,
  cpm             NUMERIC(10, 4) DEFAULT 0,
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  ctr             NUMERIC(6, 4) DEFAULT 0,
  add_to_carts    INTEGER DEFAULT 0,
  purchases       INTEGER DEFAULT 0,
  cost_per_atc    NUMERIC(10, 2),
  cost_per_purchase NUMERIC(10, 2),
  captured_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for dashboard: latest snapshot per adset
CREATE INDEX IF NOT EXISTS idx_snapshots_latest
  ON adset_snapshots (adset_id, captured_at DESC);

-- Index for dashboard: time-range queries
CREATE INDEX IF NOT EXISTS idx_snapshots_time
  ON adset_snapshots (captured_at DESC);
