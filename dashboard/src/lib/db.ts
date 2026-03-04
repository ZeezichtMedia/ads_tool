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

  // Group rows by date to avoid double-counting Shopify data
  // (Shopify revenue is global and stored on every account row for the same date)
  // Meta metrics (spend, atc, purchases) are per-account and should be summed.
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const dt = r.stat_date;
    if (!byDate.has(dt)) byDate.set(dt, []);
    byDate.get(dt)!.push(r);
  }

  let totalSpend = 0, totalClicks = 0, totalImpressions = 0;
  let totalAtc = 0, totalPurchases = 0;
  let shopifyRevenue = 0, shopifyOrderCount = 0;
  let maxActiveAdsets = 0;

  for (const [, dateRows] of byDate) {
    for (const r of dateRows) {
      totalSpend += parseFloat(r.total_spend) || 0;
      totalClicks += r.total_clicks || 0;
      totalImpressions += r.total_impressions || 0;
      totalAtc += r.total_atc || 0;
      totalPurchases += r.total_purchases || 0;
      maxActiveAdsets += r.active_adsets || 0;
    }
    // Shopify data is the same on all account rows for a given date — take max, not sum
    const maxShopifyRev = Math.max(...dateRows.map((r: any) => parseFloat(r.shopify_revenue) || 0));
    const maxShopifyOrders = Math.max(...dateRows.map((r: any) => r.shopify_order_count || 0));
    shopifyRevenue += maxShopifyRev;
    shopifyOrderCount += maxShopifyOrders;
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

/**
 * Get the previous period range (same duration, shifted back).
 * today → yesterday, yesterday → day before, 7d → previous 7d, etc.
 */
export function getPreviousPeriodRange(range: DateRange): DateRange {
  const from = new Date(range.from + 'T00:00:00');
  const to = new Date(range.to + 'T00:00:00');
  const durationMs = to.getTime() - from.getTime() + 86400000; // inclusive day
  const prevTo = new Date(from.getTime() - 86400000); // day before current from
  const prevFrom = new Date(prevTo.getTime() - durationMs + 86400000);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(prevFrom), to: fmt(prevTo), label: 'Previous Period' };
}

/**
 * Get per-account spend breakdown for a date range.
 * Returns array of { account_id, name, spend, atc, purchases }.
 */
export async function getPerAccountBreakdown(range: DateRange) {
  const rows = await getDailyStatsForRange(range);
  const accounts = await getMetaAccounts();
  const nameMap = new Map<string, string>();
  for (const a of accounts) {
    nameMap.set(a.id, a.name || a.id);
  }

  // Group by account_id and sum
  const byAccount = new Map<string, { spend: number; atc: number; purchases: number }>();
  for (const r of rows) {
    const id = r.account_id || 'unknown';
    if (!byAccount.has(id)) byAccount.set(id, { spend: 0, atc: 0, purchases: 0 });
    const acc = byAccount.get(id)!;
    acc.spend += parseFloat(r.total_spend) || 0;
    acc.atc += r.total_atc || 0;
    acc.purchases += r.total_purchases || 0;
  }

  return [...byAccount.entries()].map(([id, data]) => ({
    account_id: id,
    name: nameMap.get(id) || id,
    ...data,
  })).sort((a, b) => b.spend - a.spend);
}

/** Legacy: today-only stats */
export async function getTodayStats() {
  return getStatsForRange(resolveRange('today'));
}

// ─── Financial Tracking (COGS & Overhead) ────────────────

/**
 * Get last N days of spend per campaign (from daily_stats).
 * Returns Map<date, { spend, atc, purchases }> for the range.
 */
export async function getDailySpendHistory(days: number = 7) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const rows = await query(
    'daily_stats',
    `stat_date=gte.${fmt(start)}&stat_date=lte.${fmt(today)}&order=stat_date.asc`
  );

  // Group by date, sum spend across accounts
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const dt = r.stat_date;
    byDate.set(dt, (byDate.get(dt) || 0) + (parseFloat(r.total_spend) || 0));
  }

  // Fill gaps with 0
  const result: { date: string; spend: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = fmt(d);
    result.push({ date: key, spend: byDate.get(key) || 0 });
  }

  return result;
}

/**
 * Get comprehensive daily trends data for charting.
 * Returns array of { date, spend, revenue, roas, atc, purchases, orders }.
 */
export async function getDailyTrendsData(days: number = 30) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const rows = await query(
    'daily_stats',
    `stat_date=gte.${fmt(start)}&stat_date=lte.${fmt(today)}&order=stat_date.asc`
  );

  // Group by date
  const byDate = new Map<string, { spend: number; atc: number; purchases: number; revenue: number; orders: number }>();
  for (const r of rows) {
    const dt = r.stat_date;
    if (!byDate.has(dt)) byDate.set(dt, { spend: 0, atc: 0, purchases: 0, revenue: 0, orders: 0 });
    const bucket = byDate.get(dt)!;
    bucket.spend += parseFloat(r.total_spend) || 0;
    bucket.atc += r.total_atc || 0;
    bucket.purchases += r.total_purchases || 0;
    // Use MAX for shopify data (same on all account rows for a date)
    bucket.revenue = Math.max(bucket.revenue, parseFloat(r.shopify_revenue) || 0);
    bucket.orders = Math.max(bucket.orders, r.shopify_order_count || 0);
  }

  // Fill gaps with 0s
  const result: { date: string; spend: number; revenue: number; roas: number; atc: number; purchases: number; orders: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = fmt(d);
    const data = byDate.get(key) || { spend: 0, atc: 0, purchases: 0, revenue: 0, orders: 0 };
    result.push({
      date: key,
      spend: data.spend,
      revenue: data.revenue,
      roas: data.spend > 0 ? data.revenue / data.spend : 0,
      atc: data.atc,
      purchases: data.purchases,
      orders: data.orders,
    });
  }

  return result;
}

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

// ─── Alert Rules ─────────────────────────────────────────

export async function getAlertRules() {
  return query('alert_rules', 'order=id.asc');
}

export async function upsertAlertRule(rule: any) {
  // If id is provided, it updates. Otherwise inserts.
  const url = `${SUPABASE_URL}/rest/v1/alert_rules?on_conflict=id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify(rule),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Upsert Rule Error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function deleteAlertRule(id: number) {
  const url = `${SUPABASE_URL}/rest/v1/alert_rules?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Delete Rule Error (${res.status}): ${text}`);
  }
}

// ─── Meta Accounts ───────────────────────────────────────

export async function getMetaAccounts() {
  return query('meta_accounts', 'order=created_at.asc');
}

export async function addMetaAccount(id: string, name: string) {
  const url = `${SUPABASE_URL}/rest/v1/meta_accounts?on_conflict=id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify({ id, name, is_enabled: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Add Account Error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function toggleMetaAccount(id: string, isEnabled: boolean) {
  const url = `${SUPABASE_URL}/rest/v1/meta_accounts?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ is_enabled: isEnabled }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Toggle Account Error (${res.status}): ${text}`);
  }
}

export async function deleteMetaAccount(id: string) {
  const url = `${SUPABASE_URL}/rest/v1/meta_accounts?id=eq.${id}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase Delete Account Error (${res.status}): ${text}`);
  }
}
