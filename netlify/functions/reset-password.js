const { listCheckoutSessionsByEmail, retrievePaymentIntent } = require('./_stripe');
const { json, parseJsonBody } = require('./_response');
const { normalizeEmail, readStore, updateStore } = require('./_store');
const {
  validateEmail,
  validatePassword,
  hashPassword,
  createSession,
  publicUser,
} = require('./_auth');

function getCardLast4(paymentIntent) {
  return paymentIntent?.latest_charge?.payment_method_details?.card?.last4 || '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let email;
  let cardLast4;
  let newPassword;
  let confirmNewPassword;

  try {
    ({ email, cardLast4, newPassword, confirmNewPassword } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  const normalizedCardLast4 = String(cardLast4 || '').replace(/\D/g, '').slice(-4);
  if (!/^\d{4}$/.test(normalizedCardLast4)) {
    return json(400, { error: 'Enter the last 4 digits of the card used at checkout' });
  }

  const passwordError = validatePassword(String(newPassword || ''));
  if (passwordError) {
    return json(400, { error: passwordError });
  }

  if (newPassword !== confirmNewPassword) {
    return json(400, { error: 'New passwords do not match' });
  }

  const store = await readStore();
  const existingUser = store.users[normalizedEmail];
  if (!existingUser) {
    return json(404, { error: 'No account found for this email. Create an account instead.' });
  }

  let verifiedPurchase = false;
  try {
    const checkoutSessions = await listCheckoutSessionsByEmail(normalizedEmail, 100);
    for (const session of checkoutSessions.data || []) {
      if (session.payment_status !== 'paid' || !session.payment_intent) continue;

      const paymentIntent = await retrievePaymentIntent(session.payment_intent);
      if (getCardLast4(paymentIntent) === normalizedCardLast4) {
        verifiedPurchase = true;
        break;
      }
    }
  } catch {
    return json(502, { error: 'Password reset is temporarily unavailable. Please try again.' });
  }

  if (!verifiedPurchase) {
    return json(401, { error: 'We could not verify that purchase. Check the email and card last 4.' });
  }

  const nextPassword = await hashPassword(String(newPassword || ''));
  const updatedUser = await updateStore(nextStore => {
    const user = nextStore.users[normalizedEmail];
    if (!user) {
      const error = new Error('No account found for this email. Create an account instead.');
      error.statusCode = 404;
      throw error;
    }

    user.passwordHash = nextPassword.hash;
    user.passwordSalt = nextPassword.salt;
    user.updatedAt = new Date().toISOString();

    Object.entries(nextStore.sessions).forEach(([sessionId, session]) => {
      if (normalizeEmail(session?.email) === normalizedEmail) {
        delete nextStore.sessions[sessionId];
      }
    });

    return { ...user };
  });

  const session = await createSession(normalizedEmail);
  return json(200, {
    user: publicUser(updatedUser, Boolean(store.entitlements[normalizedEmail]) || verifiedPurchase, session.expiresAt),
    message: 'Password reset successfully.',
  }, {
    'Set-Cookie': session.cookie,
  });
};
