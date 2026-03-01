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
