const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { normalizeEmail, readStore, updateStore } = require('./_store');
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
    return json(error.statusCode || 500, { error: error.message || 'Account creation failed. Please try again.' });
  }

  clearRateLimit(event, normalizedEmail, 'signup');
  const session = await createSession(normalizedEmail);
  const store = await readStore();
  const hasPurchased = Boolean(store.entitlements[normalizedEmail]);

  return json(200, {
    user: publicUser(createdUser, hasPurchased, session.expiresAt),
  }, {
    'Set-Cookie': session.cookie,
  });
};
