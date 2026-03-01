// ─── Performance Classification ────────────────────────
// Shared between index.astro and CampaignTable.astro

export interface ClassifiedAdset {
    performance: string;
    spend: number;
    cpc: number;
    ctr: number;
    atc: number;
    purchases: number;
    impressions: number;
    clicks: number;
    revenue: number;
    profit: number;
    poas: number;
}

export const ESTIMATED_AOV = 35; // Average order value for ROAS/POAS calculation if real Shopify data per campaign isn't available.

interface OverheadSettings {
    transaction_fee_fixed: number;
    transaction_fee_percent: number;
    refund_rate_percent: number;
    daily_overhead: number;
}

export function classifyPerformance(
    adset: {
        spend: any; cpc: any; ctr: any;
        add_to_carts: any; purchases: any;
        impressions: any; clicks: any;
    },
    cogs: number = 0,
    overhead: OverheadSettings = { // Default overhead if none provided
        transaction_fee_fixed: 0.25,
        transaction_fee_percent: 1.5,
        refund_rate_percent: 0,
        daily_overhead: 0
    }
): string {
    const spend = parseFloat(String(adset.spend)) || 0;
    const atc = parseInt(String(adset.add_to_carts)) || 0;
    const purchases = parseInt(String(adset.purchases)) || 0;

    // Revenue Calculation
    const grossRevenue = purchases * ESTIMATED_AOV;

    // Cost Calculations
    const totalCogs = purchases * cogs;
    const transactionFees = (grossRevenue * (overhead.transaction_fee_percent / 100)) + (purchases * overhead.transaction_fee_fixed);
    const estimatedRefunds = grossRevenue * (overhead.refund_rate_percent / 100);
    // Note: Daily overhead is tough to allocate per adset. Typically we evaluate at the campaign or account level.
    // For single adset/campaign rows, we will omit daily_overhead from the *unit* profit to avoid penalizing single campaigns arbitrarily, 
    // OR we apply a fraction. Let's not include fixed daily overhead in the per-campaign marginal profit status, 
    // since that breaks if you have 1 vs 10 campaigns. The Total Dashboard Winst will include it.

    const netProfit = grossRevenue - spend - totalCogs - transactionFees - estimatedRefunds;

    if (spend < 5) return "Collecting ⏳";

    if (purchases > 0) {
        if (netProfit > 5) return "Profitable 📈";
        if (netProfit >= -5 && netProfit <= 5) return "Break-even ⚖️";
        return "Loss-making 📉";
    }

    // No purchases yet
    if (spend >= 30 && atc === 0) return "Needs Attention ⚠️";
    if (spend >= 50 && purchases === 0) return "Needs Attention ⚠️";
    if (atc >= 2) return "Promising 🚀";
    if (spend >= 15 && atc === 0) return "Needs Attention ⚠️";

    return "Collecting ⏳";
}

export function getPerformanceClass(perf: string): string {
    const map: Record<string, string> = {
        "Profitable 📈": "perf-scale", // Reusing the green CSS
        "Break-even ⚖️": "perf-promising", // Reusing purple
        "Loss-making 📉": "perf-kill", // Reusing red
        "Promising 🚀": "perf-profitable", // Reusing blue
        "Needs Attention ⚠️": "perf-wall", // Reusing orange
        "Collecting ⏳": "perf-collecting", // Reusing gray
    };
    return map[perf] || "perf-collecting";
}

export function getDeliveryLabel(status: string): string {
    const map: Record<string, string> = {
        ACTIVE: "Active",
        PAUSED: "Paused",
        CAMPAIGN_PAUSED: "Campaign Paused",
        ADSET_PAUSED: "Paused",
        IN_PROCESS: "In Review",
        WITH_ISSUES: "Issues",
        DELETED: "Deleted",
        ARCHIVED: "Archived",
        UNKNOWN: "Unknown",
    };
    return map[status] || status;
}

export function getDeliveryClass(status: string): string {
    if (status === "ACTIVE") return "delivery-active";
    if (status.includes("PAUSED")) return "delivery-paused";
    if (status === "WITH_ISSUES") return "delivery-issues";
    return "delivery-inactive";
}

// ─── Formatting Helpers ─────────────────────────────────
export function fmtCurrency(val: number | null | undefined): string {
    if (val === null || val === undefined) return "—";
    const n = parseFloat(String(val));
    return isNaN(n) ? "—" : `€${n.toFixed(2)}`;
}

export function fmtNumber(val: number | null | undefined): string {
    if (val === null || val === undefined) return "—";
    const n = parseInt(String(val));
    return isNaN(n) ? "—" : n.toLocaleString();
}

// ─── Status Colors for Filter Pills ─────────────────────
export const STATUS_ORDER = [
    "Profitable 📈", "Break-even ⚖️", "Promising 🚀", "Loss-making 📉", "Needs Attention ⚠️", "Collecting ⏳",
] as const;

export const STATUS_COLORS: Record<string, { color: string; bgColor: string }> = {
    "Profitable 📈": { color: "#22c55e", bgColor: "rgba(34,197,94,0.12)" },
    "Break-even ⚖️": { color: "#a855f7", bgColor: "rgba(168,85,247,0.12)" },
    "Loss-making 📉": { color: "#ef4444", bgColor: "rgba(239,68,68,0.12)" },
    "Promising 🚀": { color: "#3b82f6", bgColor: "rgba(59,130,246,0.12)" },
    "Needs Attention ⚠️": { color: "#f97316", bgColor: "rgba(249,115,22,0.12)" },
    "Collecting ⏳": { color: "#6b7280", bgColor: "rgba(107,114,128,0.10)" },
};
