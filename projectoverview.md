# META Ads + Shopify Real-Time Alerting System

## Project Overview

A monitoring system that polls META Marketing API every 5 minutes, checks adset spend/performance against threshold rules, fires deduplicated Telegram alerts, and logs everything to Postgres. A dashboard (Astro + Tailwind) reads from the same DB to provide a live overview.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Railway (Node.js)                         │
│                                                             │
│  ┌──────────┐    ┌────────────┐    ┌──────────────────┐    │
│  │ Cron Job │───▶│ META API   │───▶│ Threshold Engine │    │
│  │ (5 min)  │    │ (insights) │    │ (5 rules)        │    │
│  └──────────┘    └────────────┘    └────────┬─────────┘    │
│                                              │              │
│                    ┌─────────────────────────┤              │
│                    ▼                         ▼              │
│          ┌─────────────────┐     ┌──────────────────┐      │
│          │ Telegram Bot    │     │ Postgres          │      │
│          │ (alerts)        │     │ (logs+snapshots)  │      │
│          └─────────────────┘     └────────┬─────────┘      │
│                                           │                 │
└───────────────────────────────────────────┤─────────────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ Astro Dashboard  │
                                  │ (Vercel)         │
                                  └──────────────────┘
```

---

## Tech Stack

| Layer             | Tool                | Why                                      |
|-------------------|---------------------|------------------------------------------|
| Polling Service   | Node.js on Railway  | Cron job, runs 24/7, cheap (~$5/mo)      |
| Database          | Postgres on Railway | Log alerts, prevent spam, store history   |
| Alerts            | Telegram Bot        | Free, instant, mobile, team-friendly      |
| Dashboard         | Astro + Tailwind v4 | SSR, reads from Postgres, Vercel free tier|
| META Data         | META Marketing API  | Insights endpoint, ad account level       |

---

## Monthly Costs

| Service                          | Cost        |
|----------------------------------|-------------|
| Railway (Node service + Postgres)| ~$5–10/mo   |
| Telegram Bot                     | Free        |
| META API                         | Free        |
| Vercel (dashboard)               | Free tier   |
| **Total**                        | **~$5–10/mo** |

---

## Alert Threshold Rules

| # | Rule                | Condition                                      | Severity | Emoji |
|---|---------------------|------------------------------------------------|----------|-------|
| 1 | `spend_10_no_atc`   | €10+ spend, 0 add to carts                    | high     | 🔴    |
| 2 | `spend_30_no_atc`   | €30+ spend, 0 add to carts                    | critical | 🚨    |
| 3 | `spend_50_no_purchase` | €50+ spend, 0 purchases                    | critical | 🚨    |
| 4 | `high_cpc`          | CPC > €1.75, spend >= €5                      | medium   | ⚠️    |
| 5 | `low_ctr`           | CTR < 1%, spend >= €10, impressions > 500      | medium   | ⚠️    |

Alerts are **deduplicated** — each rule fires at most once per adset per day.

---

## File Structure

```
/meta-alert-service
├── projectoverview.md          ← this file
├── package.json
├── .env.example
├── .gitignore
├── migrations/
│   └── 001_create_tables.sql   ← Postgres schema
├── src/
│   ├── index.js                ← entry point + cron
│   ├── metaClient.js           ← META API calls
│   ├── thresholds.js           ← alert rules engine
│   ├── alerter.js              ← Telegram sender
│   ├── db.js                   ← Postgres pool + queries
│   └── logger.js               ← structured logging
├── tests/
│   └── thresholds.test.js      ← unit tests
└── dashboard/                  ← Astro + Tailwind v4
    ├── package.json
    ├── astro.config.mjs
    └── src/
        ├── layouts/Layout.astro
        ├── pages/
        │   ├── index.astro     ← live adset overview
        │   ├── alerts.astro    ← alert history
        │   └── api/health.ts   ← health check
        ├── components/
        │   ├── AdsetTable.astro
        │   ├── AlertBadge.astro
        │   ├── StatsCard.astro
        │   └── Navbar.astro
        └── lib/db.ts           ← dashboard DB queries
```

---

## Environment Variables

```env
META_ACCESS_TOKEN=        # from developers.facebook.com (60-day token)
META_AD_ACCOUNT_ID=       # format: act_XXXXXXXXX
TELEGRAM_BOT_TOKEN=       # from @BotFather
TELEGRAM_CHAT_ID=         # your alert group chat
DATABASE_URL=             # Railway Postgres connection string
```

---

## Key Features

- **Single API call** per 5-min cycle — never loops individual adsets
- **Deduplication** — UNIQUE constraint in DB prevents alert spam
- **Dry-run mode** — test the full pipeline locally without APIs: `npm run dry-run`
- **Graceful shutdown** — closes DB pool, stops cron on SIGTERM/SIGINT
- **Retry with backoff** — META API and Telegram calls retry on transient errors
- **Error alerts** — service errors are reported to Telegram too
- **Startup notification** — Telegram gets a "🟢 Service started" on boot
- **Structured logging** — JSON logs with timestamps and levels
- **Auto-migration** — DB tables are created on first start

---

## Key Notes

- META data is **~15 min delayed** — this is normal, not a bug
- META access tokens expire in **60 days** — set a calendar reminder or build refresh
- Dashboard reads from the **same Postgres** — no extra API calls to META
- The service stores **adset snapshots** each cycle for dashboard historical data

---

## Setup Checklist

### META API
- [ ] Create Meta App at [developers.facebook.com](https://developers.facebook.com)
- [ ] Request `ads_read` permission
- [ ] Generate long-lived access token (60 days)
- [ ] Get Ad Account ID (format: `act_XXXXXXXXX`)

### Telegram
- [ ] Create bot via [@BotFather](https://t.me/BotFather) → get `BOT_TOKEN`
- [ ] Create a group, add the bot, get `CHAT_ID`

### Railway
- [ ] Create new project at [railway.app](https://railway.app)
- [ ] Add Postgres plugin → copy `DATABASE_URL`
- [ ] Deploy Node service from GitHub repo
- [ ] Add all env vars in Railway dashboard
- [ ] DB tables auto-create on first start

### Vercel (Dashboard)
- [ ] Connect Astro repo (dashboard folder)
- [ ] Add `DATABASE_URL` env var
- [ ] Deploy

---

## Commands

```bash
# Install dependencies
npm install

# Run with mock data (no APIs needed)
npm run dry-run

# Run in production
npm start

# Run tests
npm test

# Dev mode with auto-restart
npm run dev
```
