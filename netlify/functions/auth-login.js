const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getPublicStoreError, normalizeEmail, readStoreEntry, updateStoreEntry } = require('./_store');
const { recordAnalyticsEventSafe } = require('./_analytics');
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

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'login');
  if (!rateLimit.allowed) {
    return json(429, { error: rateLimit.message });
  }

  let user;
  try {
    user = await readStoreEntry('users', normalizedEmail);
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Login failed. Please try again.' });
  }

  if (!user) {
    return json(401, { error: 'Invalid email or password' });
  }

  const validPassword = await verifyPassword(String(password || ''), user.passwordSalt, user.passwordHash);
  if (!validPassword) {
    return json(401, { error: 'Invalid email or password' });
  }

  // Accounts created before verification was introduced have no field and remain valid.
  if (user.emailVerifiedAt === null) {
    return json(403, {
      error: 'Verify your email before logging in.',
      code: 'email_verification_required',
      email: normalizedEmail,
    });
  }

  await clearRateLimit(event, normalizedEmail, 'login');
  let session;
  try {
    await updateStoreEntry('users', normalizedEmail, currentUser => {
      if (!currentUser) return null;
      const now = new Date().toISOString();
      return { ...currentUser, updatedAt: now, lastLoginAt: now };
    });

    session = await createSession(normalizedEmail);
    await recordAnalyticsEventSafe({ eventName: 'login_completed', email: normalizedEmail, path: '/app' });
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Login failed. Please try again.' });
  }

  return json(200, {
    user: publicUser(user, true, session.expiresAt),
  }, {
    'Set-Cookie': session.cookie,
  });
};
