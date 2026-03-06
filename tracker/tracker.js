/**
 * IvyTracker v2.0 — First-Party Customer Journey Tracking
 * 
 * FIXED: Now writes directly to Supabase REST API (proven CORS support)
 * instead of Edge Function (which had sendBeacon CORS issues).
 * 
 * Uses localStorage for visitor ID (no cookies, unblockable by consent banners).
 * 
 * Installation: Add <script async src="https://your-cdn/tracker.js"></script> to theme.liquid
 */
(function () {
    'use strict';

    // ─── Configuration ───────────────────────────────────────
    var SB_URL = 'https://ceohhxygnoagcaeloxoc.supabase.co';
    var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNlb2hoeHlnbm9hZ2NhZWxveG9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzA5MzQsImV4cCI6MjA4NzgwNjkzNH0.sqLIptYyiMpoM_zV_39xxNqnWW0GY9w28k_n-fMWiY4';

    var SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    var FLUSH_MS = 3000;                  // send events every 3 seconds

    // ─── Utility: UUID generator ─────────────────────────────
    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // ─── Visitor ID (persists forever in localStorage) ───────
    function getVid() {
        var v = localStorage.getItem('_ivt_vid');
        if (!v) {
            v = uuid();
            localStorage.setItem('_ivt_vid', v);
        }
        return v;
    }

    // ─── Session ID (new after 30min inactivity) ─────────────
    function getSid() {
        var n = Date.now(), s = localStorage.getItem('_ivt_sid'), l = parseInt(localStorage.getItem('_ivt_last') || '0', 10);
        if (!s || n - l > SESSION_TIMEOUT) {
            s = uuid();
            localStorage.setItem('_ivt_sid', s);
        }
        localStorage.setItem('_ivt_last', String(n));
        return s;
    }

    // ─── Parse UTM parameters from current URL ──────────────
    function getUtms() {
        var p = new URLSearchParams(window.location.search), u = {};
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'].forEach(function (k) {
            var v = p.get(k);
            if (v) u[k] = v;
        });
        if (Object.keys(u).length > 0) localStorage.setItem('_ivt_utms', JSON.stringify(u));
        return JSON.parse(localStorage.getItem('_ivt_utms') || '{}');
    }

    // ─── Detect device type ──────────────────────────────────
    function devType() {
        var u = navigator.userAgent;
        if (/Mobi|Android/i.test(u)) return 'mobile';
        if (/Tablet|iPad/i.test(u)) return 'tablet';
        return 'desktop';
    }

    // ─── Detect browser ─────────────────────────────────────
    function browser() {
        var u = navigator.userAgent;
        if (u.indexOf('Chrome') > -1 && u.indexOf('Edg') === -1) return 'Chrome';
        if (u.indexOf('Safari') > -1 && u.indexOf('Chrome') === -1) return 'Safari';
        if (u.indexOf('Firefox') > -1) return 'Firefox';
        if (u.indexOf('Edg') > -1) return 'Edge';
        return 'Other';
    }

    // ─── Extract Shopify product info from page ──────────────
    function prodInfo() {
        var i = {};
        try {
            if (window.meta && window.meta.product) {
                i.product_id = String(window.meta.product.id);
                i.product_title = window.meta.product.type || document.title;
            }
            if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
                var s = window.ShopifyAnalytics.meta.product;
                i.product_id = i.product_id || String(s.id);
                i.product_title = i.product_title || s.type;
            }
            var sc = document.querySelectorAll('script[type="application/ld+json"]');
            for (var j = 0; j < sc.length; j++) {
                try {
                    var ld = JSON.parse(sc[j].textContent);
                    if (ld['@type'] === 'Product') {
                        i.product_id = i.product_id || ld.productID || ld.sku;
                        i.product_title = i.product_title || ld.name;
                        break;
                    }
                } catch (e) { }
            }
        } catch (e) { }
        return i;
    }

    // ─── Detect page type ───────────────────────────────────
    function pageType() {
        var p = window.location.pathname;
        if (p === '/' || p === '') return 'home';
        if (p.indexOf('/products/') === 0) return 'product';
        if (p.indexOf('/collections') === 0) return 'collection';
        if (p.indexOf('/cart') === 0) return 'cart';
        if (p.indexOf('/checkouts') === 0) return 'checkout';
        if (p.indexOf('/thank_you') > -1 || p.indexOf('/orders/') > -1) return 'thank_you';
        return 'other';
    }

    // ─── Core Logic ──────────────────────────────────────────
    var vid = getVid(), sid = getSid(), utms = getUtms();
    var queue = [];
    var visitorSaved = false;

    // Supabase REST Helpers
    function sbPost(table, data) {
        try {
            var x = new XMLHttpRequest();
            x.open("POST", SB_URL + "/rest/v1/" + table, true);
            x.setRequestHeader("apikey", SB_KEY);
            x.setRequestHeader("Authorization", "Bearer " + SB_KEY);
            x.setRequestHeader("Content-Type", "application/json");
            x.setRequestHeader("Prefer", "return=minimal");
            x.send(JSON.stringify(data));
        } catch (e) { }
    }

    function saveVisitor() {
        if (visitorSaved) return;
        visitorSaved = true;
        sbPost("tracking_visitors", {
            visitor_id: vid,
            last_seen: new Date().toISOString(),
            utm_source: utms.utm_source || null,
            utm_medium: utms.utm_medium || null,
            utm_campaign: utms.utm_campaign || null,
            utm_content: utms.utm_content || null,
            referrer: document.referrer || null,
            device: devType(),
            browser: browser()
        });
    }

    function track(type, extra) {
        var evt = {
            visitor_id: vid,
            session_id: sid,
            event_type: type,
            page_url: window.location.href,
            page_title: document.title,
            timestamp: new Date().toISOString(),
            metadata: null
        };

        // Auto-add product if on product page
        if (type === "pageview" || type === "product_view") {
            var pi = prodInfo();
            if (pi.product_id) {
                evt.product_id = pi.product_id;
                evt.product_title = pi.product_title;
            }
        }

        // Explicit extra overrides
        if (extra) {
            if (extra.product_id) evt.product_id = extra.product_id;
            if (extra.product_title) evt.product_title = extra.product_title;
            if (extra.metadata) evt.metadata = extra.metadata;
        }

        queue.push(evt);
        if (queue.length >= 15 || type === "purchase") flush();
    }

    function flush() {
        if (queue.length === 0) return;
        saveVisitor();
        var batch = queue.splice(0, queue.length);
        sbPost("tracking_events", batch);
    }

    // ─── Auto-track Triggers ─────────────────────────────
    function autoPageView() {
        var pt = pageType();
        track("pageview", { metadata: { page_type: pt } });
        if (pt === "product") {
            var pi = prodInfo();
            if (pi.product_id) track("product_view", pi);
        }
    }

    // Add to Cart: form submit
    document.addEventListener("submit", function (e) {
        var f = e.target;
        if (f && f.action && f.action.indexOf("/cart/add") > -1) {
            var pi = prodInfo();
            track("add_to_cart", { product_id: pi.product_id, product_title: pi.product_title, metadata: { method: "form" } });
        }
    });

    // Add to Cart: AJAX
    var _f = window.fetch;
    if (_f) {
        window.fetch = function () {
            var u = arguments[0];
            if (typeof u === "string" && u.indexOf("/cart/add") > -1) {
                var pi = prodInfo();
                track("add_to_cart", { product_id: pi.product_id, product_title: pi.product_title, metadata: { method: "ajax" } });
            }
            return _f.apply(this, arguments);
        }
    }

    // Checkout
    if (window.location.pathname.indexOf("/checkouts") === 0) {
        track("checkout", { metadata: { step: window.location.pathname.split("/").pop() } });
    }

    // Purchase (thank you page)
    if (pageType() === "thank_you") {
        var co = window.Shopify && window.Shopify.checkout;
        if (co) {
            track("purchase", {
                metadata: {
                    order_id: co.order_id,
                    order_name: co.order_number ? "#" + co.order_number : null,
                    total_price: co.total_price || co.payment_due,
                    currency: co.currency
                }
            });
            // Insert into conversions directly as well
            sbPost("tracking_conversions", {
                visitor_id: vid,
                session_id: sid,
                order_id: co.order_id,
                order_name: co.order_number ? "#" + co.order_number : null,
                total_price: parseFloat(co.total_price || co.payment_due || 0),
                utm_campaign: utms.utm_campaign || null
            });
        } else {
            track("purchase", {});
        }
    }

    // SPA navigation
    var _ps = history.pushState, _rs = history.replaceState;
    history.pushState = function () { _ps.apply(this, arguments); setTimeout(autoPageView, 100) };
    history.replaceState = function () { _rs.apply(this, arguments); setTimeout(autoPageView, 100) };
    window.addEventListener("popstate", function () { setTimeout(autoPageView, 100) });

    // Init
    autoPageView();
    setInterval(flush, FLUSH_MS);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush() });

})();
