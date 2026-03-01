import type { APIRoute } from "astro";
import { deleteAlertRule } from "../../../lib/db";

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const { id } = params;
        if (!id) {
            return new Response(JSON.stringify({ error: "No ID provided" }), { status: 400 });
        }

        await deleteAlertRule(parseInt(id, 10));

        return new Response(JSON.stringify({ success: true }), {
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
