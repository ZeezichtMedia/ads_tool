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

export const getActionValue = (action_values = [], type) => {
    const val = action_values.find((a) => a.action_type === type);
    return val ? parseFloat(val.value) : 0;
};

export const parseMetrics = (adset, cogs = 0, overhead = null) => {
    const spend = parseFloat(adset.spend || 0);
    const cpc = parseFloat(adset.cpc || 0);        // now = cost per unique link click
    const cpm = parseFloat(adset.cpm || 0);
    const impressions = parseInt(adset.impressions || 0);
    const clicks = parseInt(adset.clicks || 0);     // now = unique link clicks
    const ctr = parseFloat(adset.ctr || 0);         // now = unique link click CTR from META
    const atc = getATC(adset.actions);
    const purchases = getPurchases(adset.actions);

    // Revenue from Meta conversions
    const revenue = getActionValue(adset.action_values, 'purchase');

    // Profit Calculation
    const totalCogs = purchases * cogs;

    let txFees = 0;
    let refundCosts = 0;

    if (overhead) {
        txFees = (purchases * (overhead.transaction_fee_fixed || 0)) +
            (revenue * ((overhead.transaction_fee_percent || 0) / 100));
        refundCosts = revenue * ((overhead.refund_rate_percent || 0) / 100);
    }

    const variableCosts = totalCogs + txFees + refundCosts;
    const net_profit = revenue - spend - variableCosts;
    const roas = spend > 0 ? (revenue / spend) : 0;

    return { spend, cpc, cpm, impressions, clicks, ctr, atc, purchases, revenue, net_profit, roas };
};

// ─── Main Check Function ─────────────────────────────────
// Returns array of triggered alerts for a given adset

export const checkThresholds = (adset, activeRules = [], cogs = 0, overhead = null) => {
    const metrics = parseMetrics(adset, cogs, overhead);
    const triggered = [];

    for (const rule of activeRules) {
        // A rule is triggered if ALL conditions are met
        let allMet = true;

        for (const cond of rule.conditions) {
            const actualVal = metrics[cond.metric];
            if (actualVal === undefined) {
                allMet = false;
                break;
            }

            const targetVal = parseFloat(cond.value);

            switch (cond.op) {
                case '>': if (!(actualVal > targetVal)) allMet = false; break;
                case '>=': if (!(actualVal >= targetVal)) allMet = false; break;
                case '<': if (!(actualVal < targetVal)) allMet = false; break;
                case '<=': if (!(actualVal <= targetVal)) allMet = false; break;
                case '=': if (!(actualVal === targetVal)) allMet = false; break;
                default: allMet = false; break;
            }

            if (!allMet) break; // short circuit
        }

        if (allMet && rule.conditions.length > 0) {
            // Replace variables in message
            let msg = rule.message_template || '';
            msg = msg.replace(/{spend}/g, metrics.spend.toFixed(2));
            msg = msg.replace(/{cpc}/g, metrics.cpc.toFixed(2));
            msg = msg.replace(/{ctr}/g, metrics.ctr.toFixed(2));
            msg = msg.replace(/{atc}/g, metrics.atc);
            msg = msg.replace(/{purchases}/g, metrics.purchases);
            msg = msg.replace(/{net_profit}/g, metrics.net_profit.toFixed(2));
            msg = msg.replace(/{roas}/g, metrics.roas.toFixed(2));
            msg = msg.replace(/{revenue}/g, metrics.revenue.toFixed(2));

            triggered.push({
                rule: rule.name,
                emoji: rule.emoji || '⚠️',
                severity: rule.severity || 'medium',
                message: msg,
                metrics
            });
        }
    }

    return triggered;
};
