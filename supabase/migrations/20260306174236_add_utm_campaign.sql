-- Add a new column to store the exact UTM campaign ID (adcampaign_id) parsed from the Shopify landing_site URL
ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

-- Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_shopify_orders_utm ON shopify_orders (utm_campaign);
