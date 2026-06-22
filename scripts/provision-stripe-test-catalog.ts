/**
 * Provisions ConsentMD subscription catalog in Stripe TEST mode.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm exec ts-node scripts/provision-stripe-test-catalog.ts
 *
 * Requires a secret key starting with sk_test_ (not sk_live_).
 */
import Stripe from 'stripe';

const PLANS = [
  {
    tier: 'starter',
    lookupKey: 'consentmd_starter',
    unitAmount: 25_000,
    nickname: 'Starter (1-25 users)',
  },
  {
    tier: 'pro',
    lookupKey: 'consentmd_pro',
    unitAmount: 45_000,
    nickname: 'Pro (26-50 users)',
  },
  {
    tier: 'enterprise',
    lookupKey: 'consentmd_enterprise',
    unitAmount: 75_000,
    nickname: 'Enterprise (51+ users)',
  },
] as const;

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.error('Set STRIPE_SECRET_KEY (must be sk_test_...)');
    process.exit(1);
  }
  if (!secretKey.startsWith('sk_test_')) {
    console.error(
      'Refusing to provision: STRIPE_SECRET_KEY must be a TEST key (sk_test_...).',
    );
    console.error(
      'The Stripe MCP plugin is on live mode; use this script with a test secret key from:',
    );
    console.error(
      'https://dashboard.stripe.com/test/apikeys',
    );
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);

  const product = await stripe.products.create({
    name: 'ConsentMD Platform Subscription',
    description:
      'Monthly subscription for ConsentMD organizations. Starter (1-25), Pro (26-50), Enterprise (51+).',
    metadata: { environment: 'test', service: 'consentmd-payments' },
  });

  console.log(`Product: ${product.id}`);

  const priceIds: Record<string, string> = {};

  for (const plan of PLANS) {
    const existing = await stripe.prices.list({
      lookup_keys: [plan.lookupKey],
      active: true,
      limit: 1,
    });

    if (existing.data[0]) {
      priceIds[plan.tier] = existing.data[0].id;
      console.log(
        `${plan.tier}: ${existing.data[0].id} (existing, lookup_key=${plan.lookupKey})`,
      );
      continue;
    }

    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: plan.unitAmount,
      nickname: plan.nickname,
      lookup_key: plan.lookupKey,
      transfer_lookup_key: true,
      recurring: { interval: 'month' },
      metadata: { plan: plan.tier, environment: 'test' },
    });

    priceIds[plan.tier] = price.id;
    console.log(
      `${plan.tier}: ${price.id} ($${plan.unitAmount / 100}/mo, lookup_key=${plan.lookupKey})`,
    );
  }

  console.log('\nAdd to .env:\n');
  console.log(`STRIPE_PRICE_STARTER=${priceIds.starter}`);
  console.log(`STRIPE_PRICE_PRO=${priceIds.pro}`);
  console.log(`STRIPE_PRICE_ENTERPRISE=${priceIds.enterprise}`);
  console.log(`\nProduct ID: ${product.id}`);
  console.log('\nWebhook (test): stripe listen --forward-to localhost:3001/api/webhooks/stripe');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
