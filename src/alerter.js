// ─── Telegram Alert Sender ───────────────────────────────
// Sends HTML-formatted messages to a Telegram chat.
// Includes retry logic and startup/error notifications.

import { logger } from './logger.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Core Send Function ─────────────────────────────────
const sendMessage = async (text) => {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: process.env.TELEGRAM_CHAT_ID,
                    text,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                }),
            });

            const data = await res.json();

            if (!data.ok) {
                logger.error('Telegram API error', {
                    error: data.description,
                    errorCode: data.error_code,
                });
                if (attempt < MAX_RETRIES) {
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }
                return false;
            }

            return true;
        } catch (err) {
            logger.error(`Telegram send failed (attempt ${attempt}/${MAX_RETRIES})`, {
                error: err.message,
            });
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY_MS);
                continue;
            }
            return false;
        }
    }
    return false;
};

// ─── Alert Message ───────────────────────────────────────
export const sendTelegramAlert = async (message) => {
    const success = await sendMessage(message);
    if (success) {
        logger.debug('Telegram alert sent');
    } else {
        logger.error('Failed to send Telegram alert after retries');
    }
    return success;
};

// ─── Startup Notification ────────────────────────────────
export const sendStartupMessage = async () => {
    const message = `🟢 <b>META Alert Service Started</b>

⏰ Polling every 5 minutes
📊 Monitoring active adsets
🔔 Alerts will fire on threshold breaches

<i>${new Date().toISOString()}</i>`;

    return sendMessage(message);
};

// ─── Error Notification ──────────────────────────────────
export const sendErrorAlert = async (errorMessage) => {
    const message = `🔴 <b>META Alert Service Error</b>

${errorMessage}

<i>${new Date().toISOString()}</i>`;

    return sendMessage(message);
};

// ─── Daily Digest ────────────────────────────────────────
export const sendDailyDigest = async (stats) => {
    const {
        totalSpend = 0,
        shopifyRevenue = 0,
        roas = 0,
        totalAtc = 0,
        totalPurchases = 0,
        shopifyOrderCount = 0,
        alertCount = 0,
        netProfit = 0,
        topCampaign = null,
        worstCampaign = null,
    } = stats;

    const profitEmoji = netProfit > 0 ? '💰' : '📉';
    const roasEmoji = roas >= 2 ? '🟢' : roas >= 1 ? '🟡' : '🔴';

    let message = `📊 <b>Daily Summary — ${new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}</b>

💶 <b>Spend:</b> €${totalSpend.toFixed(2)}
🛒 <b>Revenue:</b> €${shopifyRevenue.toFixed(2)}
${roasEmoji} <b>ROAS:</b> ${roas.toFixed(2)}x
${profitEmoji} <b>Net Profit:</b> €${netProfit.toFixed(2)}

🛍️ <b>ATC:</b> ${totalAtc} | <b>Purchases:</b> ${totalPurchases} | <b>Orders:</b> ${shopifyOrderCount}
🔔 <b>Alerts fired:</b> ${alertCount}`;

    if (topCampaign) {
        message += `\n\n🏆 <b>Best:</b> ${topCampaign.name} (€${topCampaign.spend.toFixed(2)} spend, ${topCampaign.roas.toFixed(2)}x ROAS)`;
    }
    if (worstCampaign) {
        message += `\n⚠️ <b>Worst:</b> ${worstCampaign.name} (€${worstCampaign.spend.toFixed(2)} spend, ${worstCampaign.roas.toFixed(2)}x ROAS)`;
    }

    return sendMessage(message);
};
