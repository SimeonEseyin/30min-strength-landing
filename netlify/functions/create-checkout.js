const { createCheckoutSession } = require('./_stripe');
const { hasTrustedOrigin, getRequestOrigin } = require('./_response');
const { checkRateLimit, clearRateLimit } = require('./_auth');

const PRICE_CENTS = 4700; // $47 — founding member price

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!hasTrustedOrigin(event)) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  let email, name;
  try {
    ({ email, name } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email) || email.length > 254) {
    return { statusCode: 400, body: 'Invalid email' };
  }

  const rateLimit = checkRateLimit(event, email, 'checkout');
  if (!rateLimit.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: rateLimit.message }),
    };
  }

  // Sanitize name: strip tags, limit length
  const safeName = typeof name === 'string'
    ? name.replace(/[<>]/g, '').trim().slice(0, 100)
    : '';
  const baseUrl = getRequestOrigin(event) || process.env.URL;

  try {
    const session = await createCheckoutSession({
      email,
      safeName,
      priceCents: PRICE_CENTS,
      successUrl: `${baseUrl}/app?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/devdad-landing.html?cancelled=true`,
    });

    clearRateLimit(event, email, 'checkout');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Checkout unavailable. Please try again.' }) };
  }
};
