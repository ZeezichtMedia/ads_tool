import 'dotenv/config';

async function run() {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots?select=campaign_name&limit=1`, {
        headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
        }
    });
    console.log(res.status);
    console.log(await res.text());
}

run().catch(console.error);
