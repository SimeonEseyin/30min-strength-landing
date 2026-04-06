const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getPublicStoreError, normalizeEmail, readStore, updateStore } = require('./_store');
const { restoreStripeEntitlementByEmail } = require('./_entitlements');
const {
  validateEmail,
  checkRateLimit,
  clearRateLimit,
  verifyPassword,
  createSession,
  publicUser,
} = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  let email;
  let password;

  try {
    ({ email, password } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return json(400, { error: 'Invalid email format' });
  }

  const rateLimit = checkRateLimit(event, normalizedEmail, 'login');
  if (!rateLimit.allowed) {
    return json(429, { error: rateLimit.message });
  }

  let store;
  try {
    store = await readStore();
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Login failed. Please try again.' });
  }

  const user = store.users[normalizedEmail];
  if (!user) {
    return json(401, { error: 'Invalid email or password' });
  }

  const validPassword = await verifyPassword(String(password || ''), user.passwordSalt, user.passwordHash);
  if (!validPassword) {
    return json(401, { error: 'Invalid email or password' });
  }

  clearRateLimit(event, normalizedEmail, 'login');
  let session;
  try {
    await updateStore(nextStore => {
      if (nextStore.users[normalizedEmail]) {
        nextStore.users[normalizedEmail].updatedAt = new Date().toISOString();
        nextStore.users[normalizedEmail].lastLoginAt = new Date().toISOString();
      }
    });

    session = await createSession(normalizedEmail);
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Login failed. Please try again.' });
  }

  let hasPurchased = Boolean(store.entitlements[normalizedEmail]);
  if (!hasPurchased) {
    try {
      hasPurchased = await restoreStripeEntitlementByEmail(normalizedEmail);
    } catch {
      hasPurchased = false;
    }
  }

  return json(200, {
    user: publicUser(user, hasPurchased, session.expiresAt),
  }, {
    'Set-Cookie': session.cookie,
  });
};
