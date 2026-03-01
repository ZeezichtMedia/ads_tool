import 'dotenv/config';
import { getAccessToken } from './src/shopifyClient.js';

async function run() {
    const token = await getAccessToken();
    const res = await fetch(`https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/2026-01/orders.json?status=any&limit=1`, {
        headers: { 'X-Shopify-Access-Token': token }
    });
    const data = await res.json();
    if (data.orders && data.orders.length > 0) {
        console.log("Found order!");
        const order = data.orders[0];
        console.log("total_price:", order.total_price);
        console.log("currency:", order.currency);
        console.log("current_total_price:", order.current_total_price);

        // Check nested price sets
        if (order.current_total_price_set) {
            console.log("current_total_price_set presentment_money:", JSON.stringify(order.current_total_price_set.presentment_money));
            console.log("current_total_price_set shop_money:", JSON.stringify(order.current_total_price_set.shop_money));
        }
        if (order.total_price_set) {
            console.log("total_price_set presentment_money:", JSON.stringify(order.total_price_set.presentment_money));
            console.log("total_price_set shop_money:", JSON.stringify(order.total_price_set.shop_money));
        }
    } else {
        console.log("No orders found.");
    }
}

run().catch(console.error);
