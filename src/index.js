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
import { initDb, hasAlertedToday, logAlert, saveSnapshot, saveDailyStats, closeDb, getActiveAlertRules, getCampaignSettings, getBusinessOverhead, getEnabledAccounts, syncShopifyOrders, syncShopifyProducts } from './db.js';
import { fetchAdsetInsights, getMockAdsets } from './metaClient.js';
import { checkThresholds, getATC, getPurchases, parseMetrics } from './thresholds.js';
import { sendTelegramAlert, sendStartupMessage, sendErrorAlert, sendDailyDigest } from './alerter.js';
import { isConfigured as isShopifyConfigured, getTodayOrders, getProducts } from './shopifyClient.js';

// ─── Configuration ───────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '*/5 * * * *';
let cycleCount = 0;
let cronJob = null;
let digestJob = null;

// ─── Validate Environment ────────────────────────────────
const TELEGRAM_ENABLED = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
const SHOPIFY_ENABLED = isShopifyConfigured();

const validateEnv = () => {
    const required = [
        'META_ACCESS_TOKEN',
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
💵 Revenue: €${(m.revenue || 0).toFixed(2)}
📈 Net Profit: €${(m.net_profit || 0).toFixed(2)}
🎯 ROAS: ${(m.roas || 0).toFixed(2)}x

📝 ${alert.message}
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
        // 1. Get enabled accounts from DB (fallback to env var)
        let accounts = [];
        if (!DRY_RUN) {
            try {
                accounts = await getEnabledAccounts();
            } catch (err) {
                logger.warn('Could not fetch accounts from DB, falling back to env var', { error: err.message });
            }
        }

        // Fallback: use env var if no DB accounts
        if (accounts.length === 0 && process.env.META_AD_ACCOUNT_ID) {
            accounts = [{ id: process.env.META_AD_ACCOUNT_ID, name: 'Default (env)' }];
        }

        if (accounts.length === 0 && !DRY_RUN) {
            logger.warn('No Meta ad accounts configured — add accounts via the dashboard');
            return;
        }

        // For dry run, use a mock account
        if (DRY_RUN) {
            accounts = [{ id: 'mock_account', name: 'Mock Account' }];
        }

        logger.info(`Processing ${accounts.length} account(s): ${accounts.map(a => a.name).join(', ')}`);

        // 2. Fetch external dependencies (Shopify, Rules, Financials) — shared across accounts
        const [shopifyData, activeRulesData, campaignSettingsData, overheadData] = await Promise.all([
            fetchShopifyRevenue(),
            DRY_RUN ? Promise.resolve([]) : getActiveAlertRules(),
            DRY_RUN ? Promise.resolve([]) : getCampaignSettings(),
            DRY_RUN ? Promise.resolve(null) : getBusinessOverhead()
        ]);

        const activeRules = activeRulesData || [];
        const rawCampaignSettings = campaignSettingsData || [];
        const businessOverhead = overheadData || null;

        // Sync Shopify orders to DB for the Orders page
        if (shopifyData.orders && shopifyData.orders.length > 0) {
            try {
                await syncShopifyOrders(shopifyData.orders);
            } catch (err) {
                logger.error('Failed to sync Shopify orders', { error: err.message });
            }
        }

        // Sync Shopify products to DB for the Orders page lookup
        if (SHOPIFY_ENABLED && !DRY_RUN) {
            try {
                const products = await getProducts();
                await syncShopifyProducts(products);
            } catch (err) {
                logger.error('Failed to sync Shopify products', { error: err.message });
            }
        }

        // Build campaign COGS map for fast lookups
        const campaignCogsMap = {};
        for (const cs of rawCampaignSettings) {
            campaignCogsMap[cs.campaign_name] = parseFloat(cs.cogs || 0);
        }

        let grandTotalAlerts = 0;

        // 3. Loop through each enabled account
        for (const account of accounts) {
            const accountId = account.id;
            logger.info(`── Account: ${account.name} (${accountId})`);

            let adsets;
            try {
                adsets = DRY_RUN ? getMockAdsets() : await fetchAdsetInsights(accountId);
            } catch (metaErr) {
                const msg = metaErr.message || '';
                if (msg.includes('190') || msg.includes('OAuthException') || msg.includes('access token')) {
                    logger.error('🔴 META ACCESS TOKEN EXPIRED OR INVALID!', { error: msg, accountId });
                    if (TELEGRAM_ENABLED) {
                        await sendErrorAlert(
                            `🔴 <b>META Token Error</b>\n\nAccount: ${account.name}\nYour META access token is expired or invalid.\nPlease refresh it in the .env file.\n\n<code>${msg.slice(0, 200)}</code>`
                        );
                    }
                } else {
                    logger.error(`Failed to fetch data for account ${account.name}`, { error: msg, accountId });
                }
                continue; // Skip this account, try the next
            }

            if (adsets.length === 0) {
                logger.info(`No active adsets for ${account.name}`);
                continue;
            }

            logger.info(`Processing ${adsets.length} adset(s) for ${account.name}`);

            let alertsFired = 0;
            let totalSpend = 0;
            let totalClicks = 0;
            let totalImpressions = 0;
            let totalAtc = 0;
            let totalPurchases = 0;
            let totalRevenue = 0;
            let totalProfit = 0;

            for (const adset of adsets) {
                const cogs = campaignCogsMap[adset.campaign_name] || 0;
                const metrics = parseMetrics(adset, cogs, businessOverhead);

                totalSpend += metrics.spend;
                totalClicks += metrics.clicks;
                totalImpressions += metrics.impressions;
                totalAtc += metrics.atc;
                totalPurchases += metrics.purchases;
                totalRevenue += metrics.revenue || 0;
                totalProfit += metrics.net_profit || 0;

                if (!DRY_RUN) {
                    await saveSnapshot(adset, metrics, accountId);
                }

                // Check thresholds
                const currentRules = activeRules.length > 0 ? activeRules : (DRY_RUN ? [
                    { name: 'mock_rule', emoji: '⚙️', severity: 'low', message_template: 'Mock alert run {spend}', conditions: [] }
                ] : []);

                const alerts = checkThresholds(adset, currentRules, cogs, businessOverhead);

                for (const alert of alerts) {
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

                    const message = formatAlertMessage(adset, alert);

                    if (DRY_RUN) {
                        console.log('\n' + '─'.repeat(50));
                        console.log('📨 ALERT (dry run):');
                        console.log(message.replace(/<[^>]*>/g, ''));
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
                            alert.message,
                            accountId
                        );
                    }

                    alertsFired++;
                }
            }

            // Save daily stats per account
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
                    accountId,
                });
            }

            grandTotalAlerts += alertsFired;

            logger.info(`── Account ${account.name} done`, {
                adsets: adsets.length,
                alertsFired,
                spend: `€${totalSpend.toFixed(2)}`,
            });
        }

        const elapsed = Date.now() - startTime;
        logger.info(`Cycle #${cycleCount} complete`, {
            accounts: accounts.length,
            totalAlerts: grandTotalAlerts,
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

    // Schedule daily digest at 23:55
    if (TELEGRAM_ENABLED) {
        digestJob = cron.schedule('55 23 * * *', async () => {
            logger.info('Sending daily digest...');
            try {
                // Fetch today's stats from the database
                const { createClient } = await import('@supabase/supabase-js');
                const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
                const today = new Date().toISOString().split('T')[0];

                const { data: rows } = await supabase
                    .from('daily_stats')
                    .select('*')
                    .eq('stat_date', today);

                if (rows && rows.length > 0) {
                    // Aggregate across accounts
                    let totalSpend = 0, totalAtc = 0, totalPurchases = 0;
                    let shopifyRevenue = 0, shopifyOrderCount = 0;

                    for (const r of rows) {
                        totalSpend += parseFloat(r.total_spend) || 0;
                        totalAtc += r.total_atc || 0;
                        totalPurchases += r.total_purchases || 0;
                        shopifyRevenue = Math.max(shopifyRevenue, parseFloat(r.shopify_revenue) || 0);
                        shopifyOrderCount = Math.max(shopifyOrderCount, r.shopify_order_count || 0);
                    }

                    const roas = totalSpend > 0 ? shopifyRevenue / totalSpend : 0;

                    // Count alerts today
                    const { count: alertCount } = await supabase
                        .from('alert_log')
                        .select('*', { count: 'exact', head: true })
                        .gte('created_at', `${today}T00:00:00`);

                    await sendDailyDigest({
                        totalSpend,
                        shopifyRevenue,
                        roas,
                        totalAtc,
                        totalPurchases,
                        shopifyOrderCount,
                        alertCount: alertCount || 0,
                        netProfit: shopifyRevenue - totalSpend, // simplified
                    });
                }
            } catch (err) {
                logger.error('Daily digest failed', { error: err.message });
            }
        });
        logger.info('Daily digest scheduled at 23:55');
    }
};

start().catch((err) => {
    logger.error('Fatal startup error', { error: err.message, stack: err.stack });
    process.exit(1);
});
