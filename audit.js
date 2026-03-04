// ─── Data Audit Script ──────────────────────────────────
// Compare database daily_stats vs live Meta API for Feb 24 – Mar 4
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN;

// ─── Supabase query helper ──────────────────────────────
async function supaQuery(table, params = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
    });
    return res.json();
}

// ─── 1. Get enabled accounts ────────────────────────────
async function getAccounts() {
    return supaQuery('meta_accounts', 'order=created_at.asc');
}

// ─── 2. Get DB daily_stats ──────────────────────────────
async function getDbStats() {
    return supaQuery('daily_stats', 'stat_date=gte.2026-02-24&stat_date=lte.2026-03-04&order=stat_date.asc,account_id.asc');
}

// ─── 3. Fetch Meta API insights ─────────────────────────
async function fetchMetaInsights(accountId, dateStart, dateEnd) {
    // Remove 'act_' prefix for the API call — actually Meta expects the full act_ ID
    const url = `https://graph.facebook.com/v21.0/${accountId}/insights?` + new URLSearchParams({
        access_token: META_TOKEN,
        fields: 'spend,actions',
        time_range: JSON.stringify({ since: dateStart, until: dateEnd }),
        time_increment: 1,  // daily breakdown
        level: 'account',
        limit: 100,
    });

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
        console.error(`META API Error for ${accountId}:`, data.error.message);
        return [];
    }

    return data.data || [];
}

// ─── 4. Fetch Shopify orders ────────────────────────────
async function fetchShopifyOrders(dateStart, dateEnd) {
    const domain = process.env.SHOPIFY_STORE_DOMAIN;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!domain || !clientSecret) {
        console.log('⚠️  Shopify not configured, skipping');
        return null;
    }

    const token = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // Fetch orders for each day
    const results = {};
    const start = new Date(dateStart);
    const end = new Date(dateEnd);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayStr = d.toISOString().split('T')[0];
        const dayStartISO = `${dayStr}T00:00:00+01:00`;
        const dayEndISO = `${dayStr}T23:59:59+01:00`;

        try {
            const url = `https://${domain}/admin/api/2024-01/orders.json?` + new URLSearchParams({
                status: 'any',
                created_at_min: dayStartISO,
                created_at_max: dayEndISO,
                limit: '250',
            });

            const res = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': clientSecret,
                },
            });

            if (res.ok) {
                const data = await res.json();
                const orders = data.orders || [];
                const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
                results[dayStr] = { orders: orders.length, revenue: totalRevenue };
            } else {
                results[dayStr] = { orders: 0, revenue: 0, error: `HTTP ${res.status}` };
            }
        } catch (err) {
            results[dayStr] = { orders: 0, revenue: 0, error: err.message };
        }
    }

    return results;
}

// ─── Main Audit ─────────────────────────────────────────
async function runAudit() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  DATA ACCURACY AUDIT: Feb 24 – Mar 4, 2026');
    console.log('═══════════════════════════════════════════════════\n');

    // 1. Get accounts
    const accounts = await getAccounts();
    console.log(`📋 Active accounts: ${accounts.length}`);
    accounts.forEach(a => console.log(`   - ${a.id} (${a.name || 'unnamed'}) [${a.is_enabled ? '✅ enabled' : '❌ disabled'}]`));
    console.log('');

    // 2. Get DB stats
    const dbRows = await getDbStats();
    console.log(`📊 DB daily_stats rows: ${dbRows.length}\n`);

    // Group DB data by date + account
    const dbByDateAccount = {};
    for (const row of dbRows) {
        const key = `${row.stat_date}|${row.account_id}`;
        dbByDateAccount[key] = {
            spend: parseFloat(row.total_spend) || 0,
            atc: row.total_atc || 0,
            purchases: row.total_purchases || 0,
            shopify_revenue: parseFloat(row.shopify_revenue) || 0,
            shopify_orders: row.shopify_order_count || 0,
        };
    }

    // Aggregate DB data by date (sum across accounts)
    const dbByDate = {};
    for (const row of dbRows) {
        if (!dbByDate[row.stat_date]) {
            dbByDate[row.stat_date] = { spend: 0, atc: 0, purchases: 0, shopify_revenue: 0, shopify_orders: 0 };
        }
        dbByDate[row.stat_date].spend += parseFloat(row.total_spend) || 0;
        dbByDate[row.stat_date].atc += row.total_atc || 0;
        dbByDate[row.stat_date].purchases += row.total_purchases || 0;
        // Shopify is global, use MAX
        dbByDate[row.stat_date].shopify_revenue = Math.max(dbByDate[row.stat_date].shopify_revenue, parseFloat(row.shopify_revenue) || 0);
        dbByDate[row.stat_date].shopify_orders = Math.max(dbByDate[row.stat_date].shopify_orders, row.shopify_order_count || 0);
    }

    // 3. Fetch Meta API data per account
    console.log('🔄 Fetching Meta API data...\n');
    const metaByDateAccount = {};
    const metaByDate = {};

    for (const acc of accounts) {
        if (!acc.is_enabled) continue;
        const insights = await fetchMetaInsights(acc.id, '2026-02-24', '2026-03-04');
        console.log(`   ${acc.id}: ${insights.length} days of data from Meta`);

        for (const day of insights) {
            const date = day.date_start;
            const spend = parseFloat(day.spend) || 0;
            const actions = day.actions || [];
            const atc = actions.find(a => a.action_type === 'add_to_cart')?.value || 0;
            const purchases = actions.find(a => a.action_type === 'purchase')?.value || 0;

            const key = `${date}|${acc.id}`;
            metaByDateAccount[key] = { spend, atc: parseInt(atc), purchases: parseInt(purchases) };

            if (!metaByDate[date]) metaByDate[date] = { spend: 0, atc: 0, purchases: 0 };
            metaByDate[date].spend += spend;
            metaByDate[date].atc += parseInt(atc);
            metaByDate[date].purchases += parseInt(purchases);
        }
    }

    // 4. Comparison table — per date (aggregated)
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  AGGREGATED DAILY COMPARISON (DB vs Meta API)');
    console.log('═══════════════════════════════════════════════════');
    console.log('Date       | DB Spend    | Meta Spend  | Diff      | DB ATC | Meta ATC | DB Purch | Meta Purch');
    console.log('─'.repeat(100));

    const allDates = [...new Set([...Object.keys(dbByDate), ...Object.keys(metaByDate)])].sort();
    let totalDbSpend = 0, totalMetaSpend = 0;
    let totalDbAtc = 0, totalMetaAtc = 0;
    let totalDbPurch = 0, totalMetaPurch = 0;

    for (const date of allDates) {
        const db = dbByDate[date] || { spend: 0, atc: 0, purchases: 0 };
        const meta = metaByDate[date] || { spend: 0, atc: 0, purchases: 0 };
        const diff = db.spend - meta.spend;
        const flag = Math.abs(diff) > 1 ? ' ⚠️' : ' ✅';

        console.log(
            `${date} | €${db.spend.toFixed(2).padStart(9)} | €${meta.spend.toFixed(2).padStart(9)} | €${diff.toFixed(2).padStart(8)}${flag} | ${String(db.atc).padStart(6)} | ${String(meta.atc).padStart(8)} | ${String(db.purchases).padStart(8)} | ${String(meta.purchases).padStart(10)}`
        );

        totalDbSpend += db.spend;
        totalMetaSpend += meta.spend;
        totalDbAtc += db.atc;
        totalMetaAtc += meta.atc;
        totalDbPurch += db.purchases;
        totalMetaPurch += meta.purchases;
    }

    console.log('─'.repeat(100));
    const totalDiff = totalDbSpend - totalMetaSpend;
    console.log(
        `TOTALS     | €${totalDbSpend.toFixed(2).padStart(9)} | €${totalMetaSpend.toFixed(2).padStart(9)} | €${totalDiff.toFixed(2).padStart(8)}${Math.abs(totalDiff) > 1 ? ' ⚠️' : ' ✅'} | ${String(totalDbAtc).padStart(6)} | ${String(totalMetaAtc).padStart(8)} | ${String(totalDbPurch).padStart(8)} | ${String(totalMetaPurch).padStart(10)}`
    );

    // 5. Per-account breakdown
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  PER-ACCOUNT BREAKDOWN');
    console.log('═══════════════════════════════════════════════════');

    for (const acc of accounts) {
        if (!acc.is_enabled) continue;
        console.log(`\n📌 ${acc.name || acc.id} (${acc.id})`);
        console.log('Date       | DB Spend    | Meta Spend  | Diff');
        console.log('─'.repeat(60));

        let accDbTotal = 0, accMetaTotal = 0;
        for (const date of allDates) {
            const key = `${date}|${acc.id}`;
            const db = dbByDateAccount[key] || { spend: 0 };
            const meta = metaByDateAccount[key] || { spend: 0 };
            const diff = db.spend - meta.spend;
            const flag = Math.abs(diff) > 1 ? ' ⚠️' : ' ✅';
            console.log(`${date} | €${db.spend.toFixed(2).padStart(9)} | €${meta.spend.toFixed(2).padStart(9)} | €${diff.toFixed(2).padStart(8)}${flag}`);
            accDbTotal += db.spend;
            accMetaTotal += meta.spend;
        }
        const accDiff = accDbTotal - accMetaTotal;
        console.log('─'.repeat(60));
        console.log(`TOTAL      | €${accDbTotal.toFixed(2).padStart(9)} | €${accMetaTotal.toFixed(2).padStart(9)} | €${accDiff.toFixed(2).padStart(8)}${Math.abs(accDiff) > 1 ? ' ⚠️' : ' ✅'}`);
    }

    // 6. Shopify comparison
    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  SHOPIFY REVENUE COMPARISON');
    console.log('═══════════════════════════════════════════════════');

    const shopifyData = await fetchShopifyOrders('2026-02-24', '2026-03-04');
    if (shopifyData) {
        console.log('Date       | DB Revenue  | Shopify Rev | Diff      | DB Orders | Shop Orders');
        console.log('─'.repeat(90));

        let totalDbRev = 0, totalShopRev = 0;
        for (const date of allDates) {
            const db = dbByDate[date] || { shopify_revenue: 0, shopify_orders: 0 };
            const shop = shopifyData[date] || { revenue: 0, orders: 0 };
            const diff = db.shopify_revenue - shop.revenue;
            const flag = Math.abs(diff) > 1 ? ' ⚠️' : ' ✅';

            console.log(
                `${date} | €${db.shopify_revenue.toFixed(2).padStart(9)} | €${shop.revenue.toFixed(2).padStart(9)} | €${diff.toFixed(2).padStart(8)}${flag} | ${String(db.shopify_orders).padStart(9)} | ${String(shop.orders).padStart(11)}`
            );
            totalDbRev += db.shopify_revenue;
            totalShopRev += shop.revenue;
        }
        console.log('─'.repeat(90));
        console.log(`TOTALS     | €${totalDbRev.toFixed(2).padStart(9)} | €${totalShopRev.toFixed(2).padStart(9)} | €${(totalDbRev - totalShopRev).toFixed(2).padStart(8)}`);
    } else {
        console.log('⚠️  Shopify data not available');
    }

    console.log('\n✅ Audit complete.');
}

runAudit().catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
});
