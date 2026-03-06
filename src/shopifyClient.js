import { logger } from './logger.js';

/**
 * Shopify Client — handles auto-refreshing OAuth tokens + order fetching.
 *
 * Uses client_credentials grant to get a short-lived token (24h).
 * Automatically refreshes when token is about to expire.
 */

let cachedToken = null;
let tokenExpiresAt = 0;

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const BUFFER_MS = 60 * 60 * 1000; // refresh 1 hour before expiry

/**
 * Get a valid access token, refreshing if needed.
 */
export async function getAccessToken() {
    const now = Date.now();

    if (cachedToken && now < tokenExpiresAt - BUFFER_MS) {
        return cachedToken;
    }

    logger.info('Refreshing Shopify access token...');

    const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify token refresh failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in * 1000);

    logger.info('Shopify token refreshed', {
        expiresIn: `${Math.round(data.expires_in / 3600)}h`,
        scopes: data.scope,
    });

    return cachedToken;
}

/**
 * Make an authenticated request to Shopify Admin API.
 */
async function shopifyFetch(endpoint, options = {}) {
    const token = await getAccessToken();

    const res = await fetch(`https://${STORE_DOMAIN}/admin/api/2026-01/${endpoint}`, {
        ...options,
        headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!res.ok) {
        const text = await res.text();

        // If token expired mid-cycle, force refresh and retry once
        if (res.status === 401) {
            logger.warn('Token expired mid-request, forcing refresh...');
            cachedToken = null;
            tokenExpiresAt = 0;
            const retryToken = await getAccessToken();

            const retry = await fetch(`https://${STORE_DOMAIN}/admin/api/2026-01/${endpoint}`, {
                ...options,
                headers: {
                    'X-Shopify-Access-Token': retryToken,
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            if (!retry.ok) {
                throw new Error(`Shopify API retry failed (${retry.status})`);
            }

            return retry.json();
        }

        throw new Error(`Shopify API error (${res.status}): ${text}`);
    }

    return res.json();
}

/**
 * Fetch today's orders with revenue data.
 * Returns: { totalRevenue, orderCount, ordersByProduct }
 */
export async function getTodayOrders() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const data = await shopifyFetch(
        `orders.json?status=any&created_at_min=${todayStart.toISOString()}&fields=id,name,total_price,current_total_price_set,created_at,line_items,customer,financial_status,fulfillment_status,landing_site&limit=250`
    );

    const orders = data.orders || [];

    let totalRevenue = 0;
    const productRevenue = new Map();

    for (const order of orders) {
        // Try to get EUR from presentment_money, fallback to converting GBP
        let eurAmount = 0;
        if (order.current_total_price_set?.presentment_money?.currency_code === 'EUR') {
            eurAmount = parseFloat(order.current_total_price_set.presentment_money.amount);
        } else if (order.current_total_price_set?.shop_money) {
            // Assume shop currency is GBP and we convert to EUR roughly (1.18x) if needed
            const shopAmount = parseFloat(order.current_total_price_set.shop_money.amount);
            const shopCurrency = order.current_total_price_set.shop_money.currency_code;
            if (shopCurrency === 'GBP') {
                eurAmount = shopAmount * 1.15; // Rough GBP to EUR fallback
            } else if (shopCurrency === 'EUR') {
                eurAmount = shopAmount;
            } else {
                eurAmount = parseFloat(order.total_price); // Ultimate fallback
            }
        } else {
            eurAmount = parseFloat(order.total_price);
        }

        totalRevenue += eurAmount;

        // Track revenue per product/variant for matching with META campaigns
        for (const item of order.line_items || []) {
            const key = item.product_id?.toString() || item.title;
            const existing = productRevenue.get(key) || { title: item.title, revenue: 0, units: 0 };

            // Apportion line item price by order's total GBP/EUR ratio if needed, or just convert roughly
            const ratio = parseFloat(order.total_price) > 0 ? eurAmount / parseFloat(order.total_price) : 1;
            const itemEurPrice = parseFloat(item.price) * ratio;

            existing.revenue += itemEurPrice * item.quantity;
            existing.units += item.quantity;
            productRevenue.set(key, existing);
        }
    }

    logger.info('Shopify orders fetched', {
        orderCount: orders.length,
        totalRevenue: totalRevenue.toFixed(2),
        products: productRevenue.size,
    });

    return {
        totalRevenue,
        orderCount: orders.length,
        orders,
        productRevenue: Object.fromEntries(productRevenue),
    };
}

/**
 * Fetch products for matching with META campaigns.
 */
export async function getProducts() {
    const data = await shopifyFetch(
        'products.json?fields=id,title,handle,variants,status,image&limit=250'
    );
    return data.products || [];
}

/**
 * Check if Shopify credentials are configured.
 */
export function isConfigured() {
    return !!(STORE_DOMAIN && CLIENT_ID && CLIENT_SECRET);
}
