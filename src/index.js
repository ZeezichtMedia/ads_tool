// ─── META Alert Service — Entry Point ────────────────────
// Polls META Marketing API every 5 min, checks thresholds,
// fetches Shopify revenue, fires deduplicated Telegram alerts,
// logs to Postgres.
//
// Usage:
//   npm start          → production mode
//   npm run dry-run    → mock data, console output, no APIs
//   npm run dev        → watch mode with auto-restart

import 'dotenv/config';
import cron from 'node-cron';
import { logger } from './logger.js';
import { initDb, hasAlertedToday, logAlert, saveSnapshot, saveDailyStats, closeDb } from './db.js';
import { fetchAdsetInsights, getMockAdsets } from './metaClient.js';
import { checkThresholds, getATC, getPurchases, parseMetrics } from './thresholds.js';
import { sendTelegramAlert, sendStartupMessage, sendErrorAlert } from './alerter.js';
import { isConfigured as isShopifyConfigured, getTodayOrders } from './shopifyClient.js';

// ─── Configuration ───────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *';
let cycleCount = 0;
let cronJob = null;

// ─── Validate Environment ────────────────────────────────
const TELEGRAM_ENABLED = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const SHOPIFY_ENABLED = isShopifyConfigured();

const validateEnv = () => {
    const required = [
        'META_ACCESS_TOKEN',
        'META_AD_ACCOUNT_ID',
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
    ];

    if (DRY_RUN) {
        logger.info('🧪 DRY RUN mode — skipping env validation');
        return;
    }

    const missing = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        logger.error('Missing required environment variables', { missing });
        process.exit(1);
    }

    if (!TELEGRAM_ENABLED) {
        logger.warn('⚠️  Telegram not configured — alerts will only be logged to console and DB');
    }

    if (!SHOPIFY_ENABLED) {
        logger.warn('⚠️  Shopify not configured — revenue will be estimated (purchases × €35)');
    } else {
        logger.info('✅ Shopify API connected — will fetch real revenue');
    }
};

// ─── Format Alert Message ────────────────────────────────
const formatAlertMessage = (adset, alert) => {
    const m = alert.metrics;
    return `
${alert.emoji} <b>${alert.rule.toUpperCase().replace(/_/g, ' ')}</b>

📁 Campaign: ${adset.campaign_name}
📂 Adset: ${adset.adset_name}
💶 Spend: €${m.spend.toFixed(2)}
🖱 CPC: €${m.cpc.toFixed(2)}
📊 CTR: ${m.ctr.toFixed(2)}%
🛒 Add to Carts: ${m.atc}
💰 Purchases: ${m.purchases}

${alert.message}
  `.trim();
};

// ─── Fetch Shopify Revenue ───────────────────────────────
const fetchShopifyRevenue = async () => {
    if (!SHOPIFY_ENABLED || DRY_RUN) {
        return { totalRevenue: 0, orderCount: 0, orders: [], productRevenue: {} };
    }

    try {
        const data = await getTodayOrders();
        logger.info('Shopify revenue fetched', {
            revenue: `€${data.totalRevenue.toFixed(2)}`,
            orders: data.orderCount,
        });
        return data;
    } catch (err) {
        logger.error('Shopify API error — falling back to estimated revenue', {
            error: err.message,
        });
        return { totalRevenue: 0, orderCount: 0, orders: [], productRevenue: {} };
    }
};

// ─── Single Check Cycle ──────────────────────────────────
const runCycle = async () => {
    cycleCount++;
    const startTime = Date.now();
    logger.info(`Cycle #${cycleCount} starting...`);

    try {
        // 1. Fetch adset data from META
        let adsets;
        try {
            adsets = DRY_RUN ? getMockAdsets() : await fetchAdsetInsights();
        } catch (metaErr) {
            // Detect META token expiry
            const msg = metaErr.message || '';
            if (msg.includes('190') || msg.includes('OAuthException') || msg.includes('access token')) {
                logger.error('🔴 META ACCESS TOKEN EXPIRED OR INVALID!', { error: msg });
                if (TELEGRAM_ENABLED) {
                    await sendErrorAlert(
                        `🔴 <b>META Token Error</b>\n\nYour META access token is expired or invalid.\nPlease refresh it in the .env file.\n\n<code>${msg.slice(0, 200)}</code>`
                    );
                }
            }
            throw metaErr;
        }

        if (adsets.length === 0) {
            logger.info('No active adsets found');
            return;
        }

        logger.info(`Processing ${adsets.length} adset(s)`);

        // 2. Fetch Shopify revenue (in parallel-ish timing)
        const shopifyData = await fetchShopifyRevenue();

        let alertsFired = 0;
        let totalSpend = 0;
        let totalClicks = 0;
        let totalImpressions = 0;
        let totalAtc = 0;
        let totalPurchases = 0;

        for (const adset of adsets) {
            // 3. Parse metrics and save snapshot
            const metrics = parseMetrics(adset);

            totalSpend += metrics.spend;
            totalClicks += metrics.clicks;
            totalImpressions += metrics.impressions;
            totalAtc += metrics.atc;
            totalPurchases += metrics.purchases;

            if (!DRY_RUN) {
                await saveSnapshot(adset, metrics);
            }

            // 4. Check thresholds
            const alerts = checkThresholds(adset);

            for (const alert of alerts) {
                // 5. Deduplicate
                if (!DRY_RUN) {
                    const alreadySent = await hasAlertedToday(adset.adset_id, alert.rule);
                    if (alreadySent) {
                        logger.debug('Alert already sent today, skipping', {
                            adsetId: adset.adset_id,
                            rule: alert.rule,
                        });
                        continue;
                    }
                }

                // 6. Build and send alert
                const message = formatAlertMessage(adset, alert);

                if (DRY_RUN) {
                    console.log('\n' + '─'.repeat(50));
                    console.log('📨 ALERT (dry run):');
                    console.log(message.replace(/<[^>]*>/g, '')); // strip HTML for console
                    console.log('─'.repeat(50));
                } else {
                    if (TELEGRAM_ENABLED) {
                        await sendTelegramAlert(message);
                    } else {
                        console.log('\n📨 ALERT (no Telegram):', message.replace(/<[^>]*>/g, ''));
                    }
                    await logAlert(
                        adset.adset_id,
                        alert.rule,
                        alert.severity,
                        metrics.spend,
                        alert.message
                    );
                }

                alertsFired++;
            }
        }

        // 7. Save daily stats with real Shopify revenue
        if (!DRY_RUN) {
            await saveDailyStats({
                totalSpend,
                totalClicks,
                totalImpressions,
                totalAtc,
                totalPurchases,
                shopifyRevenue: shopifyData.totalRevenue,
                shopifyOrderCount: shopifyData.orderCount,
                activeAdsets: adsets.filter(a => a.effective_status === 'ACTIVE').length,
                alertsFired,
            });
        }

        const elapsed = Date.now() - startTime;
        const roas = totalSpend > 0 && shopifyData.totalRevenue > 0
            ? (shopifyData.totalRevenue / totalSpend).toFixed(2) + 'x'
            : '—';

        logger.info(`Cycle #${cycleCount} complete`, {
            adsets: adsets.length,
            alertsFired,
            spend: `€${totalSpend.toFixed(2)}`,
            shopifyRevenue: `€${shopifyData.totalRevenue.toFixed(2)}`,
            shopifyOrders: shopifyData.orderCount,
            roas,
            durationMs: elapsed,
        });

    } catch (err) {
        logger.error('Cycle failed', { error: err.message, stack: err.stack });

        // Notify via Telegram that the service had an error
        if (!DRY_RUN && TELEGRAM_ENABLED) {
            await sendErrorAlert(`Check cycle #${cycleCount} failed:\n<code>${err.message}</code>`);
        }
    }
};

// ─── Graceful Shutdown ───────────────────────────────────
const shutdown = async (signal) => {
    logger.info(`Received ${signal} — shutting down gracefully...`);
    if (cronJob) cronJob.stop();
    if (!DRY_RUN) await closeDb();
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Start ───────────────────────────────────────────────
const start = async () => {
    logger.info('META Alert Service starting...', { dryRun: DRY_RUN });

    validateEnv();

    if (DRY_RUN) {
        logger.info('Running single dry-run cycle with mock data...\n');
        await runCycle();
        logger.info('\n✅ Dry run complete. No data was sent to APIs or saved to DB.');
        return;
    }

    // Initialize database
    await initDb();

    // Send startup notification
    if (TELEGRAM_ENABLED) await sendStartupMessage();

    // Run immediately once on startup
    await runCycle();

    // Schedule recurring checks
    cronJob = cron.schedule(CRON_SCHEDULE, runCycle);
    logger.info(`Cron scheduled: ${CRON_SCHEDULE}`);
};

start().catch((err) => {
    logger.error('Fatal startup error', { error: err.message, stack: err.stack });
    process.exit(1);
});
