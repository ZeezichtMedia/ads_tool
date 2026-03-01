import 'dotenv/config';

async function run() {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots?select=captured_at`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY }
    });
    const data = await res.json();
    const dates = new Set(data.map(d => d.captured_at?.substring(0, 10)));
    console.log('Unique dates in adset_snapshots:', Array.from(dates));
}

run().catch(console.error);
