import 'dotenv/config';
import { fetchAdsetInsights } from './src/metaClient.js';
import { checkThresholds, parseMetrics } from './src/thresholds.js';
import { saveSnapshot, saveDailyStats, initDb } from './src/db.js';

async function testCycle() {
    console.log("Starting a backend check cycle...");
    try {
        await initDb();

        const adsets = await fetchAdsetInsights();
        console.log(`Fetched ${adsets.length} adsets from Meta.`);

        let totalSpend = 0;

        for (const adset of adsets) {
            const metrics = parseMetrics(adset);
            totalSpend += metrics.spend;

            console.log(`Saving snapshot for adset ${adset.adset_id}...`);
            await saveSnapshot(adset, metrics);
            console.log(`Saved snapshot for adset ${adset.adset_id}.`);
        }

        console.log(`Total Spend: €${totalSpend}`);

    } catch (err) {
        console.error("Cycle error:", err);
    }
}

testCycle();
