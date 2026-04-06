const { listCheckoutSessionsByEmail } = require('./_stripe');
const { normalizeEmail, updateStore } = require('./_store');

function getLatestPaidCheckoutSession(sessions = []) {
  return [...sessions]
    .filter(session => session?.payment_status === 'paid' && session?.id)
    .sort((left, right) => (Number(right?.created) || 0) - (Number(left?.created) || 0))[0] || null;
}

async function persistStripeEntitlement(email, checkoutSession, source = 'stripe_checkout_restore') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !checkoutSession?.id) {
    return false;
  }

  await updateStore(store => {
    store.entitlements[normalizedEmail] = {
      ...(store.entitlements[normalizedEmail] || {}),
      email: normalizedEmail,
      source,
      checkoutSessionId: checkoutSession.id,
      customerId: checkoutSession.customer || '',
      verifiedAt: new Date().toISOString(),
    };
  });

  return true;
}

async function restoreStripeEntitlementByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return false;
  }

  const checkoutSessions = await listCheckoutSessionsByEmail(normalizedEmail, 100);
  const paidSession = getLatestPaidCheckoutSession(checkoutSessions.data || []);

  if (!paidSession) {
    return false;
  }

  await persistStripeEntitlement(normalizedEmail, paidSession);
  return true;
}

module.exports = {
  persistStripeEntitlement,
  restoreStripeEntitlementByEmail,
};
