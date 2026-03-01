-- ============================================================
-- META Alert Service — Alert Rules Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  conditions       JSONB NOT NULL,
  emoji            TEXT NOT NULL DEFAULT '⚠️',
  severity         TEXT NOT NULL DEFAULT 'medium',
  message_template TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note on conditions JSONB format:
-- [
--   { "metric": "spend", "op": ">=", "value": 10 },
--   { "metric": "cpc", "op": ">", "value": 1.75 }
-- ]
-- All conditions in the array must be true for the rule to fire (AND logic)
