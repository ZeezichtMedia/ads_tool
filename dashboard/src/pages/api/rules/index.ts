import type { APIRoute } from "astro";
import { getAlertRules, upsertAlertRule } from "../../../lib/db";

export const GET: APIRoute = async () => {
    try {
        const rules = await getAlertRules();
        return new Response(JSON.stringify(rules), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const data = await request.json();

        // Validation basic structure
        if (!data.name || !data.conditions || !Array.isArray(data.conditions)) {
            return new Response(JSON.stringify({ error: "Invalid rule format" }), { status: 400 });
        }

        const result = await upsertAlertRule(data);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
