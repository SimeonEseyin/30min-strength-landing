const { retrieveCheckoutSession } = require('./_stripe');
const { json, hasTrustedOrigin } = require('./_response');
const { checkRateLimit, clearRateLimit } = require('./_auth');
const { normalizeEmail, updateStore } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  let sessionId;
  try {
    ({ sessionId } = JSON.parse(event.body));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    return json(400, { error: 'Invalid session ID' });
  }

  const rateLimit = checkRateLimit(event, sessionId, 'verify-purchase');
  if (!rateLimit.allowed) {
    return json(429, { error: rateLimit.message });
  }

  try {
    const session = await retrieveCheckoutSession(sessionId);
    const email = normalizeEmail(session.customer_email || session.customer_details?.email || '');

    if (session.payment_status === 'paid' && email) {
      await updateStore(store => {
        store.entitlements[email] = {
          email,
          source: 'stripe_checkout',
          checkoutSessionId: session.id,
          customerId: session.customer || '',
          verifiedAt: new Date().toISOString(),
        };
      });

      clearRateLimit(event, sessionId, 'verify-purchase');
      return json(200, { verified: true });
    }

    return json(200, { verified: false });
  } catch (err) {
    return json(400, { verified: false });
  }
};
