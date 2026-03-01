import type { APIRoute } from "astro";
import { upsertCampaignSettings } from "../../lib/db";

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();

        if (!data.campaign_name) {
            return new Response(JSON.stringify({ success: false, error: "Missing campaign_name" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }

        const cogs = parseFloat(data.cogs) || 0;

        await upsertCampaignSettings(data.campaign_name, cogs);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        console.error("Failed to update campaign COGS:", error);
        return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
