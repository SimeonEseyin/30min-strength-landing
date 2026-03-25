const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const TIER_NAMES = {
  starter:  'DevDad Starter — 30-Minute Strength System',
  complete: 'DevDad Complete — 30-Minute Strength System',
  premium:  'DevDad Premium — 30-Minute Strength System',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let tier, price, email, name;
  try {
    ({ tier, price, email, name } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!tier || !price || !email) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: TIER_NAMES[tier] || 'DevDad Strength System' },
          unit_amount: Math.round(price * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${process.env.URL}/devdad-app-v2-enhanced.html?purchased=true&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.URL}/devdad-landing.html?cancelled=true`,
      metadata: { tier, name: name || '' },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
