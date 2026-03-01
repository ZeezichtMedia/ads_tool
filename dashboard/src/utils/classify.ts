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
}

export function classifyPerformance(adset: {
    spend: any; cpc: any; ctr: any;
    add_to_carts: any; purchases: any;
    impressions: any; clicks: any;
}): string {
    const spend = parseFloat(String(adset.spend));
    const atc = parseInt(String(adset.add_to_carts));
    const purchases = parseInt(String(adset.purchases));
    const cpc = parseFloat(String(adset.cpc));
    const ctr = adset.ctr ? parseFloat(String(adset.ctr)) : 0;
    const impressions = parseInt(String(adset.impressions));

    if (spend < 3) return "Collecting";
    if (spend >= 30 && atc === 0) return "Kill";
    if (spend >= 50 && purchases === 0) return "Kill";
    if (cpc > 1.75 && spend >= 5) return "Wall";
    if (spend >= 10 && ctr < 1 && impressions > 500) return "Wall";
    if (spend >= 20 && atc > 0 && purchases === 0) return "Re-evaluate";
    if (purchases >= 2) return "Scale";
    if (purchases >= 1) return "Profitable";
    if (atc >= 2) return "Promising";
    if (spend >= 10 && atc === 0) return "Re-evaluate";
    return "Collecting";
}

export function getPerformanceClass(perf: string): string {
    const map: Record<string, string> = {
        Scale: "perf-scale",
        Profitable: "perf-profitable",
        Promising: "perf-promising",
        "Re-evaluate": "perf-reevaluate",
        Kill: "perf-kill",
        Wall: "perf-wall",
        Collecting: "perf-collecting",
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
    "Scale", "Profitable", "Promising", "Re-evaluate", "Kill", "Wall", "Collecting",
] as const;

export const STATUS_COLORS: Record<string, { color: string; bgColor: string }> = {
    Scale: { color: "#22c55e", bgColor: "rgba(34,197,94,0.12)" },
    Profitable: { color: "#3b82f6", bgColor: "rgba(59,130,246,0.12)" },
    Promising: { color: "#a855f7", bgColor: "rgba(168,85,247,0.12)" },
    "Re-evaluate": { color: "#eab308", bgColor: "rgba(234,179,8,0.12)" },
    Kill: { color: "#ef4444", bgColor: "rgba(239,68,68,0.12)" },
    Wall: { color: "#f97316", bgColor: "rgba(249,115,22,0.12)" },
    Collecting: { color: "#6b7280", bgColor: "rgba(107,114,128,0.10)" },
};

export const ESTIMATED_AOV = 35; // Average order value for ROAS calculation
