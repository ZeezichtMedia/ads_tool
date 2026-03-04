/**
 * backfill-orders.js — Fetch ALL historical orders from Shopify and sync to Supabase.
 * Paginates through the Shopify Orders API (250 per page) until all orders are loaded.
 *
 * Usage: node backfill-orders.js
 */
import 'dotenv/config';
import { syncShopifyOrders } from './src/db.js';

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let cachedToken = null;

async function getToken() {
    if (cachedToken) return cachedToken;
    const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
        }),
    });
    const data = await res.json();
    cachedToken = data.access_token;
    return cachedToken;
}

async function shopifyFetch(endpoint) {
    const token = await getToken();
    const res = await fetch(`https://${STORE_DOMAIN}/admin/api/2026-01/${endpoint}`, {
        headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) throw new Error(`Shopify API error (${res.status}): ${await res.text()}`);

    // Parse Link header for pagination
    const linkHeader = res.headers.get('link');
    let nextUrl = null;
    if (linkHeader) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) nextUrl = match[1];
    }

    const data = await res.json();
    return { data, nextUrl };
}

async function fetchAllOrders() {
    let allOrders = [];
    let endpoint = 'orders.json?status=any&limit=250&fields=id,name,total_price,current_total_price_set,created_at,line_items,customer,financial_status,fulfillment_status';
    let page = 1;

    while (endpoint) {
        console.log(`📦 Fetching page ${page}...`);
        const { data, nextUrl } = await shopifyFetch(endpoint);
        const orders = data.orders || [];
        allOrders = allOrders.concat(orders);
        console.log(`   Got ${orders.length} orders (total: ${allOrders.length})`);

        if (nextUrl) {
            // Extract the relative path from full URL
            const url = new URL(nextUrl);
            endpoint = url.pathname.replace(/\/admin\/api\/[^/]+\//, '') + url.search;
        } else {
            endpoint = null;
        }
        page++;
    }

    return allOrders;
}

async function main() {
    console.log('🚀 Backfilling ALL Shopify orders to Supabase...\n');

    const orders = await fetchAllOrders();
    console.log(`\n📊 Total orders fetched from Shopify: ${orders.length}`);

    if (orders.length === 0) {
        console.log('No orders found.');
        process.exit(0);
    }

    // Sync in batches of 50 to avoid overwhelming Supabase
    const BATCH = 50;
    let totalNew = 0;
    for (let i = 0; i < orders.length; i += BATCH) {
        const batch = orders.slice(i, i + BATCH);
        const newOrders = await syncShopifyOrders(batch);
        totalNew += newOrders.length;
        console.log(`   Synced batch ${Math.floor(i / BATCH) + 1}: ${newOrders.length} new`);
    }

    console.log(`\n✅ Done! ${totalNew} new orders synced, ${orders.length - totalNew} already existed.`);
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
});
