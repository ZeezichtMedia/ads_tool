// ─── Backfill Script ────────────────────────────────────
// Fetches historical daily data from Meta API for all enabled accounts
// and upserts into daily_stats table to fill gaps and correct undercounts.
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN;

const DATE_START = '2026-02-24';
const DATE_END = '2026-03-04';

// ─── Helpers ────────────────────────────────────────────
async function supaQuery(table, params = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
    const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    return res.json();
}

async function supaUpsert(table, data) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=stat_date,account_id`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upsert failed (${res.status}): ${text}`);
    }
}

async function fetchMetaInsights(accountId) {
    const url = `https://graph.facebook.com/v21.0/${accountId}/insights?` + new URLSearchParams({
        access_token: META_TOKEN,
        fields: 'spend,actions',
        time_range: JSON.stringify({ since: DATE_START, until: DATE_END }),
        time_increment: 1,
        level: 'account',
        limit: 100,
    });

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
        console.error(`  ❌ API Error for ${accountId}: ${data.error.message}`);
        return [];
    }

    return data.data || [];
}

// ─── Main ───────────────────────────────────────────────
async function backfill() {
    console.log('═══════════════════════════════════════════════');
    console.log(`  BACKFILL: ${DATE_START} → ${DATE_END}`);
    console.log('═══════════════════════════════════════════════\n');

    // 1. Get accounts
    const accounts = await supaQuery('meta_accounts', 'is_enabled=eq.true&order=created_at.asc');
    console.log(`📋 ${accounts.length} enabled accounts\n`);

    let totalInserted = 0;

    for (const acc of accounts) {
        console.log(`\n📌 ${acc.name || acc.id} (${acc.id})`);
        console.log('─'.repeat(50));

        const insights = await fetchMetaInsights(acc.id);
        console.log(`  📊 Got ${insights.length} days from Meta API`);

        if (insights.length === 0) {
            console.log('  ⏭️  No data from Meta — skipping');
            continue;
        }

        for (const day of insights) {
            const date = day.date_start;
            const spend = parseFloat(day.spend) || 0;
            const actions = day.actions || [];
            const atc = parseInt(actions.find(a => a.action_type === 'add_to_cart')?.value || 0);
            const purchases = parseInt(actions.find(a => a.action_type === 'purchase')?.value || 0);

            // Get existing row to preserve Shopify data
            const existing = await supaQuery(
                'daily_stats',
                `stat_date=eq.${date}&account_id=eq.${acc.id}`
            );

            const row = {
                stat_date: date,
                account_id: acc.id,
                total_spend: spend,
                total_atc: atc,
                total_purchases: purchases,
                // Preserve existing Shopify data if present
                shopify_revenue: existing?.[0]?.shopify_revenue || 0,
                shopify_order_count: existing?.[0]?.shopify_order_count || 0,
            };

            await supaUpsert('daily_stats', row);

            const wasNew = !existing || existing.length === 0;
            const oldSpend = existing?.[0]?.total_spend ? parseFloat(existing[0].total_spend) : 0;
            const diff = spend - oldSpend;

            if (wasNew) {
                console.log(`  ✅ ${date}: INSERTED €${spend.toFixed(2)} (ATC: ${atc}, Purch: ${purchases})`);
            } else if (Math.abs(diff) > 0.01) {
                console.log(`  🔄 ${date}: UPDATED €${oldSpend.toFixed(2)} → €${spend.toFixed(2)} (${diff > 0 ? '+' : ''}€${diff.toFixed(2)})`);
            } else {
                console.log(`  ⏸️  ${date}: unchanged (€${spend.toFixed(2)})`);
            }
            totalInserted++;
        }
    }

    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`  ✅ Backfill complete — ${totalInserted} rows processed`);
    console.log('═══════════════════════════════════════════════\n');
}

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
