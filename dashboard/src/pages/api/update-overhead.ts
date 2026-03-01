import type { APIRoute } from "astro";
import { upsertBusinessOverhead } from "../../lib/db";

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();

        // Validate inputs
        const overhead = {
            transaction_fee_fixed: parseFloat(data.transaction_fee_fixed) || 0,
            transaction_fee_percent: parseFloat(data.transaction_fee_percent) || 0,
            refund_rate_percent: parseFloat(data.refund_rate_percent) || 0,
            monthly_personnel: parseFloat(data.monthly_personnel) || 0,
            monthly_contracts: parseFloat(data.monthly_contracts) || 0,
            monthly_other_overhead: parseFloat(data.monthly_other_overhead) || 0,
        };

        await upsertBusinessOverhead(overhead);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        console.error("Failed to update overhead:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
