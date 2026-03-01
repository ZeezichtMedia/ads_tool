-- ============================================================
-- META Alert Service — Financial Tracking Schema
-- ============================================================

-- Table 1: product_campaign_settings
-- Links Cost of Goods Sold (Inkoop) to specific campaigns
CREATE TABLE IF NOT EXISTS product_campaign_settings (
  id             SERIAL PRIMARY KEY,
  campaign_name  TEXT UNIQUE NOT NULL,
  cogs           NUMERIC(10, 2) DEFAULT 0,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table 2: business_overhead
-- Stores general business settings and fixed costs
CREATE TABLE IF NOT EXISTS business_overhead (
  id                       SERIAL PRIMARY KEY,
  transaction_fee_fixed    NUMERIC(10, 2) DEFAULT 0.25, -- e.g. €0.25 per transaction
  transaction_fee_percent  NUMERIC(5, 2) DEFAULT 1.5,   -- e.g. 1.5% per transaction
  refund_rate_percent      NUMERIC(5, 2) DEFAULT 0,     -- Expected refund percentage
  monthly_personnel        NUMERIC(10, 2) DEFAULT 0,    -- Personeel
  monthly_contracts        NUMERIC(10, 2) DEFAULT 0,    -- Contracten
  monthly_other_overhead   NUMERIC(10, 2) DEFAULT 0,    -- Lasten / Top-Up
  updated_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert a default row for business overhead
INSERT INTO business_overhead (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
