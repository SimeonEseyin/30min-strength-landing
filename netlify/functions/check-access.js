const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email) || email.length > 254) {
    return { statusCode: 400, body: 'Invalid email' };
  }

  try {
    const sessions = await stripe.checkout.sessions.list({
      customer_email: email.toLowerCase(),
      limit: 10,
    });

    const hasPaid = sessions.data.some(s => s.payment_status === 'paid');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: hasPaid }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ verified: false }) };
  }
};
