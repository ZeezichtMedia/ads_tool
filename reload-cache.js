import 'dotenv/config';
import postgres from 'postgres';

async function main() {
    console.log("Connecting to:", process.env.DATABASE_URL?.substring(0, 30) + '...');
    const sql = postgres(process.env.DATABASE_URL);
    try {
        await sql`NOTIFY pgrst, 'reload schema'`;
        console.log('Schema cache reloaded successfully!');
    } catch (e) {
        console.error('Failed to reload schema:', e);
    } finally {
        process.exit(0);
    }
}

main();
