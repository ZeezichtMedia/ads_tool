// ─── Threshold Unit Tests ────────────────────────────────
// Uses Node.js built-in test runner — no extra deps needed.
// Run: node --test tests/thresholds.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkThresholds, getATC, getPurchases, parseMetrics } from '../src/thresholds.js';

// ─── Helper: create a mock adset with overrides ──────────
const mockAdset = (overrides = {}) => ({
    adset_id: 'test_001',
    adset_name: 'Test Adset',
    campaign_name: 'Test Campaign',
    spend: '0',
    cpc: '0',
    cpm: '0',
    impressions: '0',
    clicks: '0',
    actions: [],
    cost_per_action_type: [],
    ...overrides,
});

// ─── Helper Extraction Tests ─────────────────────────────

describe('getATC', () => {
    it('returns 0 for empty actions', () => {
        assert.equal(getATC([]), 0);
        assert.equal(getATC(undefined), 0);
    });

    it('extracts add_to_cart value', () => {
        const actions = [{ action_type: 'add_to_cart', value: '5' }];
        assert.equal(getATC(actions), 5);
    });

    it('returns 0 when add_to_cart not present', () => {
        const actions = [{ action_type: 'purchase', value: '2' }];
        assert.equal(getATC(actions), 0);
    });
});

describe('getPurchases', () => {
    it('returns 0 for empty actions', () => {
        assert.equal(getPurchases([]), 0);
        assert.equal(getPurchases(undefined), 0);
    });

    it('extracts purchase value', () => {
        const actions = [{ action_type: 'purchase', value: '3' }];
        assert.equal(getPurchases(actions), 3);
    });
});

describe('parseMetrics', () => {
    it('parses all numeric fields correctly', () => {
        const adset = mockAdset({
            spend: '15.50',
            cpc: '1.20',
            impressions: '1000',
            clicks: '20',
        });
        const m = parseMetrics(adset);
        assert.equal(m.spend, 15.5);
        assert.equal(m.cpc, 1.2);
        assert.equal(m.impressions, 1000);
        assert.equal(m.clicks, 20);
        assert.equal(m.ctr, 2); // (20/1000)*100
    });

    it('handles zero impressions without NaN CTR', () => {
        const m = parseMetrics(mockAdset());
        assert.equal(m.ctr, 0);
    });
});

// ─── Rule 1: €10 spend, 0 ATC ───────────────────────────

describe('Rule: spend_10_no_atc', () => {
    it('triggers at €10 with zero ATC', () => {
        const alerts = checkThresholds(mockAdset({ spend: '10.00' }));
        const rule = alerts.find((a) => a.rule === 'spend_10_no_atc');
        assert.ok(rule, 'should trigger spend_10_no_atc');
        assert.equal(rule.severity, 'high');
    });

    it('triggers above €10 with zero ATC', () => {
        const alerts = checkThresholds(mockAdset({ spend: '15.00' }));
        const rule = alerts.find((a) => a.rule === 'spend_10_no_atc');
        assert.ok(rule);
    });

    it('does NOT trigger below €10', () => {
        const alerts = checkThresholds(mockAdset({ spend: '9.99' }));
        const rule = alerts.find((a) => a.rule === 'spend_10_no_atc');
        assert.equal(rule, undefined);
    });

    it('does NOT trigger when ATC > 0', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '15.00',
                actions: [{ action_type: 'add_to_cart', value: '1' }],
            })
        );
        const rule = alerts.find((a) => a.rule === 'spend_10_no_atc');
        assert.equal(rule, undefined);
    });
});

// ─── Rule 2: €30 spend, 0 ATC ───────────────────────────

describe('Rule: spend_30_no_atc', () => {
    it('triggers at €30 with zero ATC', () => {
        const alerts = checkThresholds(mockAdset({ spend: '30.00' }));
        const rule = alerts.find((a) => a.rule === 'spend_30_no_atc');
        assert.ok(rule);
        assert.equal(rule.severity, 'critical');
    });

    it('does NOT trigger below €30', () => {
        const alerts = checkThresholds(mockAdset({ spend: '29.99' }));
        const rule = alerts.find((a) => a.rule === 'spend_30_no_atc');
        assert.equal(rule, undefined);
    });
});

// ─── Rule 3: €50 spend, 0 purchases ─────────────────────

describe('Rule: spend_50_no_purchase', () => {
    it('triggers at €50 with zero purchases', () => {
        const alerts = checkThresholds(mockAdset({ spend: '50.00' }));
        const rule = alerts.find((a) => a.rule === 'spend_50_no_purchase');
        assert.ok(rule);
        assert.equal(rule.severity, 'critical');
    });

    it('does NOT trigger when purchases > 0', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '60.00',
                actions: [{ action_type: 'purchase', value: '1' }],
            })
        );
        const rule = alerts.find((a) => a.rule === 'spend_50_no_purchase');
        assert.equal(rule, undefined);
    });
});

// ─── Rule 4: High CPC ───────────────────────────────────

describe('Rule: high_cpc', () => {
    it('triggers when CPC > €1.75 and spend >= €5', () => {
        const alerts = checkThresholds(mockAdset({ cpc: '2.00', spend: '5.00' }));
        const rule = alerts.find((a) => a.rule === 'high_cpc');
        assert.ok(rule);
        assert.equal(rule.severity, 'medium');
    });

    it('does NOT trigger when CPC <= €1.75', () => {
        const alerts = checkThresholds(mockAdset({ cpc: '1.75', spend: '10.00' }));
        const rule = alerts.find((a) => a.rule === 'high_cpc');
        assert.equal(rule, undefined);
    });

    it('does NOT trigger when spend < €5', () => {
        const alerts = checkThresholds(mockAdset({ cpc: '3.00', spend: '4.00' }));
        const rule = alerts.find((a) => a.rule === 'high_cpc');
        assert.equal(rule, undefined);
    });
});

// ─── Rule 5: Low CTR ────────────────────────────────────

describe('Rule: low_ctr', () => {
    it('triggers when CTR < 1% with €10 spend and 500+ impressions', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '10.00',
                impressions: '1000',
                clicks: '5', // CTR = 0.5%
            })
        );
        const rule = alerts.find((a) => a.rule === 'low_ctr');
        assert.ok(rule);
        assert.equal(rule.severity, 'medium');
    });

    it('does NOT trigger when CTR >= 1%', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '10.00',
                impressions: '1000',
                clicks: '15', // CTR = 1.5%
            })
        );
        const rule = alerts.find((a) => a.rule === 'low_ctr');
        assert.equal(rule, undefined);
    });

    it('does NOT trigger with <= 500 impressions', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '10.00',
                impressions: '400',
                clicks: '1',
            })
        );
        const rule = alerts.find((a) => a.rule === 'low_ctr');
        assert.equal(rule, undefined);
    });
});

// ─── Edge Cases ──────────────────────────────────────────

describe('Edge cases', () => {
    it('returns empty array for zero spend', () => {
        const alerts = checkThresholds(mockAdset());
        assert.equal(alerts.length, 0);
    });

    it('can trigger multiple rules simultaneously', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '55.00',
                cpc: '2.50',
                impressions: '1000',
                clicks: '5', // CTR 0.5%
            })
        );
        // Should trigger: spend_10_no_atc, spend_30_no_atc, spend_50_no_purchase, high_cpc, low_ctr
        assert.ok(alerts.length >= 4, `Expected >=4 alerts, got ${alerts.length}`);
    });

    it('performing adset triggers no alerts', () => {
        const alerts = checkThresholds(
            mockAdset({
                spend: '25.00',
                cpc: '0.50',
                impressions: '5000',
                clicks: '50',
                actions: [
                    { action_type: 'add_to_cart', value: '8' },
                    { action_type: 'purchase', value: '2' },
                ],
            })
        );
        assert.equal(alerts.length, 0);
    });
});
