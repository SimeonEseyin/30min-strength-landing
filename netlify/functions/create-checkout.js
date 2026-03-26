const { createCheckoutSession } = require('./_stripe');

const PRICE_CENTS = 4700; // $47 — founding member price

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
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

  // Sanitize name: strip tags, limit length
  const safeName = typeof name === 'string'
    ? name.replace(/[<>]/g, '').trim().slice(0, 100)
    : '';

  try {
    const session = await createCheckoutSession({
      email,
      safeName,
      priceCents: PRICE_CENTS,
      successUrl: `${process.env.URL}/app?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${process.env.URL}/devdad-landing.html?cancelled=true`,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: 'Checkout unavailable. Please try again.' }) };
  }
};
