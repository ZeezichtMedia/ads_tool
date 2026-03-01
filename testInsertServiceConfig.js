import 'dotenv/config';

async function run() {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots`, {
        method: 'POST',
        headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
            adset_id: 'test_service_role',
            campaign_name: 'test campaign',
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
            captured_at: new Date().toISOString()
        }),
    });
    console.log(res.status);
    console.log(await res.text());
}
run();
