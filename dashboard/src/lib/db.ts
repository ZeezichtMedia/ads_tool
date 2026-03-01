// Direct Supabase PostgREST API calls — no external deps needed
const SUPABASE_URL = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

async function query(table: string, params: string = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error (${res.status}): ${text}`);
  }

  return res.json();
}

// ─── Date Range Helpers ──────────────────────────────────

export type DateRange = {
  from: string; // ISO date YYYY-MM-DD
  to: string;   // ISO date YYYY-MM-DD
  label: string;
};

/** Convert a range key (today, yesterday, 7d, 30d) to actual dates */
export function resolveRange(rangeKey: string, customFrom?: string, customTo?: string): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Use local date parts — NOT toISOString() which converts to UTC and shifts dates
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  switch (rangeKey) {
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y), label: 'Yesterday' };
    }
    case '7d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: fmt(start), to: fmt(today), label: 'Last 7 Days' };
    }
    case '30d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { from: fmt(start), to: fmt(today), label: 'Last 30 Days' };
    }
    case 'custom': {
      if (customFrom && customTo) {
        return { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` };
      }
      return { from: fmt(today), to: fmt(today), label: 'Today' };
    }
    case 'today':
    default:
      return { from: fmt(today), to: fmt(today), label: 'Today' };
  }
}

// ─── Snapshot Queries ────────────────────────────────────

/**
 * Get the latest snapshot per adset for a given date range.
 * For "today", returns latest; for multi-day, aggregates per adset.
 */
export async function getSnapshotsForRange(range: DateRange) {
  const fromISO = `${range.from}T00:00:00.000Z`;
  const toISO = `${range.to}T23:59:59.999Z`;

  const data = await query(
    'adset_snapshots_v2',
    `captured_at=gte.${fromISO}&captured_at=lte.${toISO}&order=captured_at.desc&limit=500`
  );

  // Deduplicate: keep only the latest per adset_id
  const seen = new Set<string>();
  const latest = [];
  for (const row of data) {
    if (!seen.has(row.adset_id)) {
      seen.add(row.adset_id);
      latest.push(row);
    }
  }

  return latest;
}

/** Shortcut: today's latest snapshots */
export async function getLatestSnapshots() {
  const range = resolveRange('today');
  return getSnapshotsForRange(range);
}

// ─── Alert Queries ───────────────────────────────────────

export async function getAlertHistory(limit = 200) {
  return query('alert_log', `order=alerted_at.desc&limit=${limit}`);
}

export async function getAlertCountForRange(range: DateRange) {
  const fromISO = `${range.from}T00:00:00.000Z`;
  const toISO = `${range.to}T23:59:59.999Z`;
  const data = await query(
    'alert_log',
    `alerted_at=gte.${fromISO}&alerted_at=lte.${toISO}&select=id`
  );
  return data.length;
}

// ─── Daily Stats ─────────────────────────────────────────

export async function getDailyStatsForRange(range: DateRange) {
  return query(
    'daily_stats',
    `stat_date=gte.${range.from}&stat_date=lte.${range.to}&order=stat_date.desc`
  );
}

/**
 * Get aggregated stats for a date range.
 * Single day → uses daily_stats row directly.
 * Multi-day → sums across all daily_stats rows in range.
 */
export async function getStatsForRange(range: DateRange) {
  const rows = await getDailyStatsForRange(range);
  const alertCount = await getAlertCountForRange(range);

  if (rows.length === 0) {
    // Fallback: aggregate from snapshots
    const snapshots = await getSnapshotsForRange(range);
    let totalSpend = 0, totalAtc = 0, totalPurchases = 0;
    for (const s of snapshots) {
      totalSpend += parseFloat(s.spend) || 0;
      totalAtc += parseInt(s.add_to_carts) || 0;
      totalPurchases += parseInt(s.purchases) || 0;
    }
    return {
      alertsToday: alertCount,
      activeAdsets: snapshots.length,
      totalSpend,
      totalAtc,
      totalPurchases,
      shopifyRevenue: 0,
      shopifyOrderCount: 0,
      roas: 0,
      hasShopifyData: false,
    };
  }

  // Sum across all daily_stats rows
  let totalSpend = 0, totalClicks = 0, totalImpressions = 0;
  let totalAtc = 0, totalPurchases = 0;
  let shopifyRevenue = 0, shopifyOrderCount = 0;
  let maxActiveAdsets = 0;

  for (const r of rows) {
    totalSpend += parseFloat(r.total_spend) || 0;
    totalClicks += r.total_clicks || 0;
    totalImpressions += r.total_impressions || 0;
    totalAtc += r.total_atc || 0;
    totalPurchases += r.total_purchases || 0;
    shopifyRevenue += parseFloat(r.shopify_revenue) || 0;
    shopifyOrderCount += r.shopify_order_count || 0;
    maxActiveAdsets = Math.max(maxActiveAdsets, r.active_adsets || 0);
  }

  const roas = totalSpend > 0 && shopifyRevenue > 0
    ? parseFloat((shopifyRevenue / totalSpend).toFixed(2))
    : 0;

  return {
    alertsToday: alertCount,
    activeAdsets: maxActiveAdsets,
    totalSpend,
    totalAtc,
    totalPurchases,
    shopifyRevenue,
    shopifyOrderCount,
    roas,
    hasShopifyData: shopifyRevenue > 0,
  };
}

/** Legacy: today-only stats */
export async function getTodayStats() {
  return getStatsForRange(resolveRange('today'));
}

// ─── Financial Tracking (COGS & Overhead) ────────────────

export async function getBusinessOverhead() {
  const data = await query('business_overhead', 'id=eq.1');
  return data && data.length > 0 ? data[0] : null;
}

export async function upsertBusinessOverhead(data: any) {
  const url = `${SUPABASE_URL}/rest/v1/business_overhead?on_conflict=id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 1, ...data }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Upsert Error (${res.status}): ${text}`);
  }
}

export async function getCampaignSettings() {
  return query('product_campaign_settings');
}

export async function upsertCampaignSettings(campaignName: string, cogs: number) {
  const url = `${SUPABASE_URL}/rest/v1/product_campaign_settings?on_conflict=campaign_name`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify({ campaign_name: campaignName, cogs }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Upsert Error (${res.status}): ${text}`);
  }
}
