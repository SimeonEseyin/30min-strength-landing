const { listCheckoutSessionsByEmail } = require('./_stripe');
const { json } = require('./_response');
const { normalizeEmail, readStore, updateStore } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email) || email.length > 254) {
    return json(400, { error: 'Invalid email' });
  }

  const normalizedEmail = normalizeEmail(email);

  try {
    const store = await readStore();
    if (store.entitlements[normalizedEmail]) {
      return json(200, { verified: true });
    }

    const sessions = await listCheckoutSessionsByEmail(normalizedEmail, 100);

    const hasPaid = sessions.data.some(s => s.payment_status === 'paid');
    if (hasPaid) {
      await updateStore(nextStore => {
        nextStore.entitlements[normalizedEmail] = {
          email: normalizedEmail,
          source: 'stripe_restore_lookup',
          verifiedAt: new Date().toISOString(),
        };
      });
    }

    return json(200, { verified: hasPaid });
  } catch (err) {
    return json(500, { verified: false });
  }
};
