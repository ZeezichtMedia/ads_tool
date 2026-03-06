-- Create the shopify_products table to cache product images and metadata
CREATE TABLE IF NOT EXISTS shopify_products (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  image_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for searching by handle/title if needed later
CREATE INDEX IF NOT EXISTS idx_shopify_products_handle ON shopify_products (handle);
