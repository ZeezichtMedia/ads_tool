import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log('Seeding initial alert rules...');

    const rules = [
        {
            name: 'kill_10_high_cpc',
            conditions: [
                { metric: 'spend', op: '>=', value: 10 },
                { metric: 'cpc', op: '>', value: 1.75 }
            ],
            emoji: '🔴',
            severity: 'high',
            message_template: '€{spend} spent — CPC {cpc} is over €1.75 threshold. KILL?',
            is_active: true
        },
        {
            name: 'kill_20_no_atc_or_high_cpc',
            conditions: [
                { metric: 'spend', op: '>=', value: 20 },
                { metric: 'atc', op: '==', value: 0 }
            ],
            emoji: '🚨',
            severity: 'critical',
            message_template: '€{spend} spent — 0 Add To Carts. KILL?',
            is_active: true
        },
        {
            name: 'kill_20_high_cpc',
            conditions: [
                { metric: 'spend', op: '>=', value: 20 },
                { metric: 'cpc', op: '>', value: 1.75 }
            ],
            emoji: '🚨',
            severity: 'critical',
            message_template: '€{spend} spent — CPC {cpc} is over €1.75 threshold. KILL?',
            is_active: true
        },
        {
            name: 'kill_30_no_purchase',
            conditions: [
                { metric: 'spend', op: '>=', value: 30 },
                { metric: 'purchases', op: '==', value: 0 }
            ],
            emoji: '💀',
            severity: 'critical',
            message_template: '€{spend} spent — 0 Purchases. KILL!',
            is_active: true
        }
    ];

    for (const rule of rules) {
        const { error } = await supabase.from('alert_rules').insert(rule);
        if (error) {
            console.error(`Failed to insert rule ${rule.name}:`, error.message);
        } else {
            console.log(`Inserted rule: ${rule.name}`);
        }
    }
    console.log('Seeding complete.');
}

run().catch(console.error);
