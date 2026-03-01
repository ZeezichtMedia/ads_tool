// ─── Database Layer (Supabase REST API) ──────────────────
// Uses Supabase PostgREST — no direct Postgres password needed.
// Reads AND writes via the anon key + RLS policies.

import { logger } from './logger.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
};

// ─── Generic helpers ──────────────────────────────────────

async function supabaseGet(table, queryString = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${queryString}`, {
        headers,
    });
    if (!res.ok) throw new Error(`Supabase GET ${table} failed: ${await res.text()}`);
    return res.json();
}

async function supabasePost(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify(data),
    });
    if (!res.ok && res.status !== 409) {
        throw new Error(`Supabase POST ${table} failed: ${await res.text()}`);
    }
}

async function supabaseUpsert(table, data, onConflict = '') {
    const query = onConflict ? `?on_conflict=${onConflict}` : '';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: 'POST',
        headers: {
            ...headers,
            'Prefer': 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        throw new Error(`Supabase UPSERT ${table} failed: ${await res.text()}`);
    }
}

// ─── Init (no-op for Supabase — tables created via migration) ─
export const initDb = async () => {
    logger.info('Using Supabase REST API — tables managed via dashboard');
};

// ─── Alert Deduplication ─────────────────────────────────
export const hasAlertedToday = async (adsetId, ruleName) => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const data = await supabaseGet(
        'alert_log',
        `adset_id=eq.${adsetId}&rule_name=eq.${ruleName}&alert_date=eq.${today}&limit=1`
    );
    return data.length > 0;
};

// ─── Log Alert ───────────────────────────────────────────
export const logAlert = async (adsetId, ruleName, severity, spend, message) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        await supabasePost('alert_log', {
            adset_id: adsetId,
            rule_name: ruleName,
            severity,
            spend_at_alert: spend,
            message,
            alert_date: today,
        });
        logger.debug('Alert logged', { adsetId, ruleName, spend });
    } catch (err) {
        logger.error('Failed to log alert', { error: err.message, adsetId, ruleName });
    }
};

// ─── Save Adset Snapshot ─────────────────────────────────
export const saveSnapshot = async (adset, metrics) => {
    try {
        await supabasePost('adset_snapshots_v2', {
            adset_id: adset.adset_id,
            adset_name: adset.adset_name,
            campaign_name: adset.campaign_name,
            effective_status: adset.effective_status || 'UNKNOWN',
            spend: metrics.spend,
            cpc: metrics.cpc,
            cpm: parseFloat(adset.cpm || 0),
            impressions: metrics.impressions,
            clicks: metrics.clicks,
            ctr: metrics.ctr,
            add_to_carts: metrics.atc,
            purchases: metrics.purchases,
            cost_per_atc: metrics.atc > 0 ? (metrics.spend / metrics.atc).toFixed(2) : null,
            cost_per_purchase: metrics.purchases > 0 ? (metrics.spend / metrics.purchases).toFixed(2) : null,
            shopify_revenue: 0, // will be enriched separately
            captured_at: new Date().toISOString(),
        });
    } catch (err) {
        logger.error('Failed to save snapshot', { error: err.message, adsetId: adset.adset_id });
    }
};

// ─── Save Daily Stats ────────────────────────────────────
// Upserts a single row per day with aggregated totals.
export const saveDailyStats = async ({
    totalSpend,
    totalClicks,
    totalImpressions,
    totalAtc,
    totalPurchases,
    shopifyRevenue,
    shopifyOrderCount,
    activeAdsets,
    alertsFired,
}) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const roas = totalSpend > 0 && shopifyRevenue > 0
            ? parseFloat((shopifyRevenue / totalSpend).toFixed(2))
            : 0;

        await supabaseUpsert('daily_stats', {
            stat_date: today,
            total_spend: totalSpend,
            total_clicks: totalClicks,
            total_impressions: totalImpressions,
            total_atc: totalAtc,
            total_purchases: totalPurchases,
            shopify_revenue: shopifyRevenue,
            shopify_order_count: shopifyOrderCount,
            roas,
            active_adsets: activeAdsets,
            alerts_fired: alertsFired,
        }, 'stat_date');

        logger.info('Daily stats saved', {
            date: today,
            spend: totalSpend,
            revenue: shopifyRevenue,
            roas,
            orders: shopifyOrderCount,
        });
    } catch (err) {
        logger.error('Failed to save daily stats', { error: err.message });
    }
};

// ─── Dashboard Queries ───────────────────────────────────

export const getLatestSnapshots = async () => {
    const data = await supabaseGet(
        'adset_snapshots_v2',
        'order=captured_at.desc&limit=100'
    );
    // Deduplicate: latest per adset
    const seen = new Set();
    return data.filter(row => {
        if (seen.has(row.adset_id)) return false;
        seen.add(row.adset_id);
        return true;
    });
};

export const getAlertHistory = async (limit = 50) => {
    return supabaseGet('alert_log', `order=alerted_at.desc&limit=${limit}`);
};

export const getTodayAlertCount = async () => {
    const today = new Date().toISOString().split('T')[0];
    const data = await supabaseGet(
        'alert_log',
        `alert_date=eq.${today}&select=id`
    );
    return data.length;
};

// ─── Get Daily Stats (for dashboard trends) ──────────────
export const getDailyStats = async (days = 7) => {
    return supabaseGet(
        'daily_stats',
        `order=stat_date.desc&limit=${days}`
    );
};

// ─── Financial Tracking (COGS & Overhead) ────────────────
export const getCampaignSettings = async () => {
    return supabaseGet('product_campaign_settings');
};

export const upsertCampaignSettings = async (campaignName, cogs) => {
    try {
        await supabaseUpsert('product_campaign_settings', {
            campaign_name: campaignName,
            cogs,
        }, 'campaign_name');
    } catch (err) {
        logger.error('Failed to upsert campaign settings', { error: err.message, campaignName });
    }
};

export const getBusinessOverhead = async () => {
    const data = await supabaseGet('business_overhead', 'id=eq.1');
    return data && data.length > 0 ? data[0] : null;
};

export const upsertBusinessOverhead = async (overheadData) => {
    try {
        await supabaseUpsert('business_overhead', {
            id: 1, // Store as single row
            ...overheadData
        }, 'id');
    } catch (err) {
        logger.error('Failed to upsert business overhead', { error: err.message });
    }
};

// ─── Alert Rules ──────────────────────────────────────
export const getActiveAlertRules = async () => {
    return supabaseGet('alert_rules', 'is_active=eq.true&order=created_at.desc');
};

// ─── Graceful Shutdown (no-op for REST) ──────────────────
export const closeDb = async () => {
    logger.info('Supabase REST client — no pool to close');
};
