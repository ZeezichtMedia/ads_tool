import 'dotenv/config';

async function run() {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_ANON_KEY}`);
    const data = await res.json();
    const hasCampaignName = Object.keys(data.definitions.adset_snapshots.properties).includes('campaign_name');
    console.log("Schema cache has campaign_name?", hasCampaignName);
}
run();
