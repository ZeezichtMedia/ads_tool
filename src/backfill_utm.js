/**
 * Backfill UTM campaign data for existing orders from the last 7 days.
 * 
 * This script:
 * 1. Fetches all orders from Shopify for the past 7 days (READ-ONLY from Shopify)
 * 2. Extracts utm_campaign from each order's landing_site URL
 * 3. Updates the utm_campaign column in our local Supabase shopify_orders table
 * 
 * Safe to run: only reads from Shopify, only writes to our own Supabase DB.
 */

import 'dotenv/config';
import { getAccessToken } from './shopifyClient.js';
import { logger } from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;

function extractUtmCampaign(landingSite) {
    if (!landingSite) return null;
    try {
        const url = new URL(landingSite, 'https://placeholder.invalid');
        return url.searchParams.get('utm_campaign')
            || url.searchParams.get('adcampaign_id')
            || url.searchParams.get('utm_content')
            || null;
    } catch {
        return null;
    }
}

async function backfill() {
    const token = await getAccessToken();

    // Fetch orders from last 7 days
    const since = new Date();
    since.setDate(since.getDate() - 7);

    let allOrders = [];
    let url = `https://${STORE_DOMAIN}/admin/api/2026-01/orders.json?status=any&created_at_min=${since.toISOString()}&fields=id,name,landing_site&limit=250`;

    // Paginate through all orders
    while (url) {
        const res = await fetch(url, {
            headers: { 'X-Shopify-Access-Token': token }
        });
        if (!res.ok) {
            console.error('Shopify API error:', res.status, await res.text());
            break;
        }
        const data = await res.json();
        allOrders = allOrders.concat(data.orders || []);

        // Check for pagination via Link header
        const linkHeader = res.headers.get('link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
            const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            url = match ? match[1] : null;
        } else {
            url = null;
        }
    }

    console.log(`Fetched ${allOrders.length} orders from the last 7 days`);

    let updated = 0;
    let skipped = 0;

    for (const order of allOrders) {
        const utmCampaign = extractUtmCampaign(order.landing_site);

        if (!utmCampaign) {
            skipped++;
            continue;
        }

        // Update our Supabase shopify_orders table
        const res = await fetch(`${SUPABASE_URL}/rest/v1/shopify_orders?id=eq.${order.id}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ utm_campaign: utmCampaign }),
        });

        if (res.ok) {
            updated++;
            console.log(`✓ ${order.name}: utm_campaign = ${utmCampaign}`);
        } else {
            console.error(`✗ ${order.name}: failed to update -`, await res.text());
        }
    }

    console.log(`\nDone! Updated: ${updated}, Skipped (no UTM): ${skipped}, Total: ${allOrders.length}`);
}

backfill().catch(console.error);
