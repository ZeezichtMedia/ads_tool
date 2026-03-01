import 'dotenv/config';
import { fetchAdsetInsights } from './src/metaClient.js';

async function testFetch() {
    console.log("Fetching today's adset insights...");
    try {
        const data = await fetchAdsetInsights();
        console.log(`Fetched ${data.length} adsets.`);
        if (data.length > 0) {
            console.log(JSON.stringify(data[0], null, 2));
        } else {
            console.log("No adsets returned.");
        }
    } catch (err) {
        console.error("Error fetching data:", err);
    }
}

testFetch();
