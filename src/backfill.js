import 'dotenv/config';
import { logger } from './logger.js';
import { getAccessToken } from './shopifyClient.js';

const META_API_VERSION = 'v25.0';
const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shopifyFetch(endpoint) {
    const token = await getAccessToken();
    const res = await fetch(`https://${STORE_DOMAIN}/admin/api/2026-01/${endpoint}`, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Shopify API error: ${await res.text()}`);
    return res.json();
}

async function metaFetch(dateStr) {
    const fields = [
        'adset_id', 'adset_name', 'campaign_name', 'spend', 'impressions',
        'clicks', 'cpc', 'cpm', 'inline_link_clicks', 'unique_inline_link_clicks',
        'cost_per_unique_inline_link_click', 'inline_link_click_ctr', 'unique_link_clicks_ctr',
        'actions', 'cost_per_action_type'
    ].join(',');

    const filtering = JSON.stringify([{
        field: 'adset.effective_status',
        operator: 'IN',
        value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES']
    }]);

    const params = new URLSearchParams({
        level: 'adset',
        time_range: JSON.stringify({ since: dateStr, until: dateStr }),
        fields,
        filtering,
        action_attribution_windows: JSON.stringify(['1d_click']),
        access_token: process.env.META_ACCESS_TOKEN,
    });

    const url = `https://graph.facebook.com/${META_API_VERSION}/${process.env.META_AD_ACCOUNT_ID}/insights?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`META API error: ${await res.text()}`);
    const data = await res.json();

    // Fetch statuses
    const statusMap = new Map();
    try {
        const statusParams = new URLSearchParams({
            fields: 'id,effective_status',
            limit: '500',
            access_token: process.env.META_ACCESS_TOKEN,
        });
        const statusRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${process.env.META_AD_ACCOUNT_ID}/adsets?${statusParams}`);
        const statusData = await statusRes.json();
        for (const adset of statusData.data || []) {
            statusMap.set(adset.id, adset.effective_status);
        }
    } catch (e) { }

    const getActionValue = (actions = [], type) => {
        const action = actions.find((a) => a.action_type === type);
        return action ? parseFloat(action.value) : 0;
    };

    return (data.data || []).map(a => ({
        adset_id: a.adset_id,
        adset_name: a.adset_name,
        campaign_name: a.campaign_name,
        spend: parseFloat(a.spend || 0),
        impressions: parseInt(a.impressions || 0),
        clicks: parseInt(a.clicks || 0),
        cpc: parseFloat(a.cpc || 0),
        add_to_carts: parseInt(getActionValue(a.actions, 'add_to_cart') || getActionValue(a.actions, 'onsite_web_add_to_cart') || 0),
        purchases: parseInt(getActionValue(a.actions, 'purchase') || getActionValue(a.actions, 'onsite_web_purchase') || 0),
        effective_status: statusMap.get(a.adset_id) || 'UNKNOWN',
    }));
}

async function getShopifyOrders(dateStr) {
    const min = `${dateStr}T00:00:00Z`;
    const max = `${dateStr}T23:59:59Z`;
    const data = await shopifyFetch(`orders.json?status=any&created_at_min=${min}&created_at_max=${max}&fields=id,total_price,current_total_price_set&limit=250`);
    const orders = data.orders || [];
    let rev = 0;
    for (const o of orders) {
        let eurAmount = 0;
        if (o.current_total_price_set?.presentment_money?.currency_code === 'EUR') {
            eurAmount = parseFloat(o.current_total_price_set.presentment_money.amount);
        } else if (o.current_total_price_set?.shop_money) {
            const shopAmount = parseFloat(o.current_total_price_set.shop_money.amount);
            const shopCurrency = o.current_total_price_set.shop_money.currency_code;
            if (shopCurrency === 'GBP') eurAmount = shopAmount * 1.15;
            else if (shopCurrency === 'EUR') eurAmount = shopAmount;
            else eurAmount = parseFloat(o.total_price);
        } else {
            eurAmount = parseFloat(o.total_price);
        }
        rev += eurAmount;
    }
    return { count: orders.length, revenue: rev };
}

async function saveToSupabase(dateStr, adsets, shopifyData) {
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
    };

    let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalAtc = 0, totalPurchases = 0;
    let activeAdsets = 0;

    // 1. Save Snapshots
    for (const a of adsets) {
        totalSpend += a.spend;
        totalClicks += a.clicks;
        totalImpressions += a.impressions;
        totalAtc += a.add_to_carts;
        totalPurchases += a.purchases;
        if (a.effective_status === 'ACTIVE') activeAdsets++;

        const snapshot = {
            adset_id: a.adset_id,
            campaign_name: a.campaign_name,
            adset_name: a.adset_name,
            spend: a.spend,
            cpc: a.cpc,
            impressions: a.impressions,
            clicks: a.clicks,
            add_to_carts: a.add_to_carts,
            purchases: a.purchases,
            effective_status: a.effective_status,
            captured_at: `${dateStr}T23:59:59Z` // End of that day
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/adset_snapshots_v2`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
            body: JSON.stringify(snapshot),
        });
        if (!res.ok) {
            console.error(`Failed to insert snapshot for ${a.adset_id}:`, await res.text());
        }
    }

    // 2. Save Daily Stats
    const roas = totalSpend > 0 && shopifyData.revenue > 0 ? (shopifyData.revenue / totalSpend).toFixed(2) : 0;
    const dailyStat = {
        stat_date: dateStr,
        total_spend: totalSpend.toFixed(2),
        total_clicks: totalClicks,
        total_impressions: totalImpressions,
        total_atc: totalAtc,
        total_purchases: totalPurchases,
        shopify_revenue: shopifyData.revenue.toFixed(2),
        shopify_order_count: shopifyData.count,
        roas,
        active_adsets: activeAdsets,
        alerts_fired: 0
    };

    await fetch(`${SUPABASE_URL}/rest/v1/daily_stats`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
        body: JSON.stringify(dailyStat),
    });

    return { totalSpend, shopifyRevenue: shopifyData.revenue };
}

async function backfill() {
    logger.info('Starting Backfill...');
    const today = new Date();

    // Last 7 days including today
    for (let i = 7; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);

        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${day}`;

        logger.info(`Backfilling ${dateStr}...`);

        try {
            const adsets = await metaFetch(dateStr);
            const shopifyData = await getShopifyOrders(dateStr);
            const { totalSpend, shopifyRevenue } = await saveToSupabase(dateStr, adsets, shopifyData);
            logger.info(`✅ ${dateStr}: Spend €${totalSpend.toFixed(2)}, Rev €${shopifyRevenue.toFixed(2)}, Adsets: ${adsets.length}`);
            await sleep(1000);
        } catch (e) {
            logger.error(`❌ Failed for ${dateStr}: ${e.message}`);
        }
    }
    logger.info('Backfill Complete!');
}

backfill();
