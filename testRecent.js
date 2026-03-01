import 'dotenv/config';

async function run() {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots?order=captured_at.desc&limit=5`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY }
    });
    const data = await res.json();
    data.forEach(d => console.log(d.captured_at, d.campaign_name));
}

run().catch(console.error);
