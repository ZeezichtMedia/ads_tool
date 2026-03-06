// ─── META Marketing API Client ───────────────────────────
// Single call to fetch all adset insights for today.
// Uses level=adset on the ad account — never loops individual adsets.
// Includes ALL statuses (active, paused, etc.) so we see everything.

import { logger } from './logger.js';

const META_API_VERSION = 'v25.0';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ─── Helper: Sleep for retry backoff ─────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Helper: Extract action value by type ──────────────────
const getActionValue = (actions = [], type) => {
    const action = actions.find((a) => a.action_type === type);
    return action ? parseFloat(action.value) : 0;
};

const getCostPerActionValue = (costPerActions = [], type) => {
    const entry = costPerActions.find((a) => a.action_type === type);
    return entry ? parseFloat(entry.value) : 0;
};

// ─── Fetch Adset Delivery Statuses ───────────────────────
// Separate call to the adsets endpoint to get effective_status
const fetchAdsetStatuses = async (accountId) => {
    const statusMap = new Map();
    try {
        const params = new URLSearchParams({
            fields: 'id,effective_status',
            limit: '500',
            access_token: process.env.META_ACCESS_TOKEN,
        });
        const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/adsets?${params}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.data) {
            for (const adset of data.data) {
                statusMap.set(adset.id, adset.effective_status);
            }
        }
        logger.debug(`Fetched statuses for ${statusMap.size} adsets`);
    } catch (err) {
        logger.warn('Could not fetch adset statuses', { error: err.message });
    }
    return statusMap;
};

// ─── Fetch All Adset Insights (all statuses) ─────────────
export const fetchAdsetInsights = async (accountId) => {
    // Request unique link click metrics via actions + cost_per_action_type
    // Also request inline_link_clicks and unique_inline_link_clicks directly
    const fields = [
        'adset_id',
        'adset_name',
        'campaign_name',
        'campaign_id',
        'spend',
        'impressions',
        'clicks',                        // all clicks (for reference)
        'cpc',                           // cost per all clicks (for reference)
        'cpm',
        'inline_link_clicks',            // link clicks (not unique)
        'unique_inline_link_clicks',     // unique link clicks ← META dashboard uses this
        'cost_per_unique_inline_link_click', // CPC as shown in META dashboard
        'inline_link_click_ctr',         // CTR for link clicks
        'unique_link_clicks_ctr',        // unique link click CTR
        'actions',                       // includes add_to_cart, purchase
        'action_values',                 // conversion values (revenue) for purchases
        'cost_per_action_type',          // includes cost_per_purchase, etc.
    ].join(',');

    // Include ALL statuses — not just ACTIVE
    // This captures ads that were active today but got turned off
    const filtering = JSON.stringify([
        {
            field: 'adset.effective_status',
            operator: 'IN',
            value: [
                'ACTIVE',
                'PAUSED',
                'CAMPAIGN_PAUSED',
                'ADSET_PAUSED',
                'IN_PROCESS',
                'WITH_ISSUES'
            ]
        }
    ]);

    const params = new URLSearchParams({
        level: 'adset',
        date_preset: 'today',
        fields,
        filtering,
        action_attribution_windows: JSON.stringify(['1d_click']),
        access_token: process.env.META_ACCESS_TOKEN,
    });

    const url = `https://graph.facebook.com/${META_API_VERSION}/${accountId}/insights?${params}`;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url);
            const data = await res.json();

            // Handle META API errors
            if (data.error) {
                const errorCode = data.error.code;
                const errorMsg = data.error.message;

                // Token expired — surface clearly
                if (errorCode === 190) {
                    logger.error('META access token expired — generate a new one', {
                        errorCode,
                        errorMsg,
                    });
                    throw new Error(`META token expired: ${errorMsg}`);
                }

                // Rate limited — retry
                if (errorCode === 17 || errorCode === 32) {
                    logger.warn(`META rate limited (attempt ${attempt}/${MAX_RETRIES})`, {
                        errorCode,
                        errorMsg,
                    });
                    if (attempt < MAX_RETRIES) {
                        await sleep(RETRY_DELAY_MS * attempt);
                        continue;
                    }
                }

                throw new Error(`META API error ${errorCode}: ${errorMsg}`);
            }

            const adsets = data.data || [];

            // Fetch delivery statuses for all adsets
            const statusMap = await fetchAdsetStatuses(accountId);

            // Normalize: extract unique link click metrics into flat fields
            const normalized = adsets.map((a) => {
                const uniqueLinkClicks = parseInt(a.unique_inline_link_clicks || 0);
                const costPerUniqueLinkClick = parseFloat(a.cost_per_unique_inline_link_click || 0);
                const linkClickCtr = parseFloat(a.unique_link_clicks_ctr || a.inline_link_click_ctr || 0);

                return {
                    adset_id: a.adset_id,
                    adset_name: a.adset_name,
                    campaign_name: a.campaign_name,
                    campaign_id: a.campaign_id || null,
                    effective_status: statusMap.get(a.adset_id) || 'UNKNOWN',
                    spend: a.spend,
                    impressions: a.impressions,
                    clicks: String(uniqueLinkClicks),
                    cpc: String(costPerUniqueLinkClick),
                    cpm: a.cpm,
                    ctr: String(linkClickCtr),
                    all_clicks: a.clicks,
                    all_cpc: a.cpc,
                    actions: a.actions || [],
                    action_values: a.action_values || [],
                    cost_per_action_type: a.cost_per_action_type || [],
                };
            });

            logger.info(`Fetched ${normalized.length} adset(s) from META (all statuses)`);
            return normalized;

        } catch (err) {
            // Network errors — retry
            if (err.name === 'TypeError' && attempt < MAX_RETRIES) {
                logger.warn(`Network error (attempt ${attempt}/${MAX_RETRIES})`, {
                    error: err.message,
                });
                await sleep(RETRY_DELAY_MS * attempt);
                continue;
            }
            throw err;
        }
    }

    throw new Error('META API: all retry attempts exhausted');
};

// ─── Mock Data for Dry Run ───────────────────────────────
export const getMockAdsets = () => [
    {
        adset_id: 'mock_001',
        adset_name: 'Test Adset — High Spend No ATC',
        campaign_name: 'Test Campaign Alpha',
        spend: '15.50', cpc: '0.85', cpm: '12.30',
        impressions: '1200', clicks: '18', ctr: '1.5',
        actions: [], cost_per_action_type: [],
    },
    {
        adset_id: 'mock_002',
        adset_name: 'Test Adset — Expensive CPC',
        campaign_name: 'Test Campaign Beta',
        spend: '8.00', cpc: '2.10', cpm: '18.50',
        impressions: '800', clicks: '4', ctr: '0.5',
        actions: [{ action_type: 'add_to_cart', value: '2' }],
        cost_per_action_type: [],
    },
    {
        adset_id: 'mock_003',
        adset_name: 'Test Adset — Performing Well',
        campaign_name: 'Test Campaign Delta',
        spend: '25.00', cpc: '0.50', cpm: '6.00',
        impressions: '5000', clicks: '50', ctr: '3.2',
        actions: [
            { action_type: 'add_to_cart', value: '8' },
            { action_type: 'purchase', value: '2' },
        ],
        cost_per_action_type: [],
    },
];
