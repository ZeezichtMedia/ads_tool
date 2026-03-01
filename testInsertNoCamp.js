import 'dotenv/config';

async function run() {
    const snapshot = {
        adset_id: 'test_1234',
        adset_name: 'test adset',
        spend: 10,
        cpc: 1.5,
        impressions: 1000,
        clicks: 10,
        add_to_carts: 1,
        purchases: 0,
        roas: 0,
        effective_status: 'ACTIVE',
        shopify_revenue: 0,
        captured_at: '2026-02-27T23:59:59Z'
    };
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots`, {
        method: 'POST',
        headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(snapshot),
    });
    console.log(res.status, await res.text());
}

run().catch(console.error);
