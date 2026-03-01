import 'dotenv/config';

async function run() {
    console.log("Using API Key:", process.env.SUPABASE_ANON_KEY.substring(0, 20) + "...");
    const reqBody = {
        adset_id: 'test_service_role',
        campaign_name: 'test campaign',
        adset_name: 'test adset',
        spend: 10,
        cpc: 1.5,
        cpm: 15,
        impressions: 1000,
        clicks: 10,
        ctr: 1.0,
        add_to_carts: 1,
        purchases: 0,
        cost_per_atc: 10,
        cost_per_purchase: null,
        effective_status: 'ACTIVE',
        shopify_revenue: 0,
        captured_at: new Date().toISOString()
    };

    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots_v2`, {
        method: 'POST',
        headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify(reqBody),
    });
    console.log(res.status);
    console.log(await res.text());
}
run();
