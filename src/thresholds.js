// ─── Threshold Rules Engine ──────────────────────────────
// Pure functions — no side effects, easily testable.
// Each rule returns an alert object if triggered, or null.

// ─── Helpers ─────────────────────────────────────────────

export const getATC = (actions = []) => {
    const atc = actions.find((a) => a.action_type === 'add_to_cart');
    return atc ? parseInt(atc.value) : 0;
};

export const getPurchases = (actions = []) => {
    const p = actions.find((a) => a.action_type === 'purchase');
    return p ? parseInt(p.value) : 0;
};

export const parseMetrics = (adset) => {
    const spend = parseFloat(adset.spend || 0);
    const cpc = parseFloat(adset.cpc || 0);        // now = cost per unique link click
    const cpm = parseFloat(adset.cpm || 0);
    const impressions = parseInt(adset.impressions || 0);
    const clicks = parseInt(adset.clicks || 0);     // now = unique link clicks
    const ctr = parseFloat(adset.ctr || 0);         // now = unique link click CTR from META
    const atc = getATC(adset.actions);
    const purchases = getPurchases(adset.actions);

    return { spend, cpc, cpm, impressions, clicks, ctr, atc, purchases };
};

// ─── Rule Definitions ────────────────────────────────────

const rules = [
    {
        name: 'spend_10_no_atc',
        check: (m) => m.spend >= 10 && m.atc === 0,
        emoji: '🔴',
        severity: 'high',
        message: (m) => `€${m.spend.toFixed(2)} spent — zero add to carts`,
    },
    {
        name: 'spend_30_no_atc',
        check: (m) => m.spend >= 30 && m.atc === 0,
        emoji: '🚨',
        severity: 'critical',
        message: (m) => `€${m.spend.toFixed(2)} spent — still zero add to carts. PAUSE?`,
    },
    {
        name: 'spend_50_no_purchase',
        check: (m) => m.spend >= 50 && m.purchases === 0,
        emoji: '🚨',
        severity: 'critical',
        message: (m) => `€${m.spend.toFixed(2)} spent — zero purchases`,
    },
    {
        name: 'high_cpc',
        check: (m) => m.cpc > 1.75 && m.spend >= 5,
        emoji: '⚠️',
        severity: 'medium',
        message: (m) => `CPC €${m.cpc.toFixed(2)} — above €1.75 threshold`,
    },
    {
        name: 'low_ctr',
        check: (m) => m.spend >= 10 && m.ctr < 1 && m.impressions > 500,
        emoji: '⚠️',
        severity: 'medium',
        message: (m) => `CTR ${m.ctr.toFixed(2)}% — bad creative signal`,
    },
];

// ─── Main Check Function ─────────────────────────────────
// Returns array of triggered alerts for a given adset

export const checkThresholds = (adset) => {
    const metrics = parseMetrics(adset);

    return rules
        .filter((rule) => rule.check(metrics))
        .map((rule) => ({
            rule: rule.name,
            emoji: rule.emoji,
            severity: rule.severity,
            message: rule.message(metrics),
            metrics,
        }));
};
