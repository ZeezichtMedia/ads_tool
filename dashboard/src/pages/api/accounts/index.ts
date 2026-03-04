import type { APIRoute } from 'astro';
import { getMetaAccounts, addMetaAccount, toggleMetaAccount, deleteMetaAccount } from '../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const accounts = await getMetaAccounts();
        return new Response(JSON.stringify(accounts), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { action, id, name, is_enabled } = body;

        if (action === 'add') {
            if (!id || !name) {
                return new Response(JSON.stringify({ error: 'id and name are required' }), { status: 400 });
            }
            const result = await addMetaAccount(id, name);
            return new Response(JSON.stringify(result), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (action === 'toggle') {
            if (!id || is_enabled === undefined) {
                return new Response(JSON.stringify({ error: 'id and is_enabled are required' }), { status: 400 });
            }
            await toggleMetaAccount(id, is_enabled);
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (action === 'delete') {
            if (!id) {
                return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
            }
            await deleteMetaAccount(id);
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
