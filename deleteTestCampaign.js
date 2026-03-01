import 'dotenv/config';

async function run() {
    console.log('Deleting test campaign data...');
    const headers = {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`
    };

    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/adset_snapshots_v2?campaign_name=ilike.*test*`, {
        method: 'DELETE',
        headers
    });

    if (res.ok) {
        console.log('Successfully deleted test snapshots');
    } else {
        console.error('Error deleting test snapshots:', await res.text());
    }
}

run();
