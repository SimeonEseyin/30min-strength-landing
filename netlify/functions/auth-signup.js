const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getPublicStoreError, normalizeEmail, readStore, updateStore } = require('./_store');
const { restoreStripeEntitlementByEmail } = require('./_entitlements');
const {
  sanitizeName,
  validateEmail,
  validatePassword,
  checkRateLimit,
  clearRateLimit,
  hashPassword,
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
  let confirmPassword;

  try {
    ({ email, password, confirmPassword } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  const rateLimit = checkRateLimit(event, normalizedEmail, 'signup');
  if (!rateLimit.allowed) {
    return json(429, { error: rateLimit.message });
  }

  const passwordError = validatePassword(String(password || ''));
  if (passwordError) {
    return json(400, { error: passwordError });
  }

  if (password !== confirmPassword) {
    return json(400, { error: 'Passwords do not match' });
  }

  let createdUser = null;

  try {
    const passwordRecord = await hashPassword(password);
    createdUser = await updateStore(store => {
      if (store.users[normalizedEmail]) {
        const error = new Error('An account with this email already exists. Please log in.');
        error.statusCode = 409;
        throw error;
      }

      const now = new Date().toISOString();
      const user = {
        email: normalizedEmail,
        name: sanitizeName(normalizedEmail),
        passwordHash: passwordRecord.hash,
        passwordSalt: passwordRecord.salt,
        createdAt: now,
        updatedAt: now,
      };
      store.users[normalizedEmail] = user;
      return user;
    });
  } catch (error) {
    const publicError = getPublicStoreError(error, 'Account creation is temporarily unavailable. Please try again shortly.');
    return json(publicError.statusCode || 500, { error: publicError.message || 'Account creation failed. Please try again.' });
  }

  clearRateLimit(event, normalizedEmail, 'signup');
  let session;
  let store;

  try {
    session = await createSession(normalizedEmail);
    store = await readStore();
  } catch (error) {
    const publicError = getPublicStoreError(error, 'Account creation is temporarily unavailable. Please try again shortly.');
    return json(publicError.statusCode || 500, { error: publicError.message || 'Account creation failed. Please try again.' });
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
    user: publicUser(createdUser, hasPurchased, session.expiresAt),
  }, {
    'Set-Cookie': session.cookie,
  });
};
