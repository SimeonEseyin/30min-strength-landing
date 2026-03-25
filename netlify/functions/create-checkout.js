const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'DevDad Strength — 30-Minute Strength System (Founding Member)' },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.URL}/devdad-app-v2-enhanced.html?purchased=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.URL}/devdad-landing.html?cancelled=true`,
      metadata: { name: safeName },
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
