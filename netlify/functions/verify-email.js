const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { normalizeEmail, updateStore } = require('./_store');
const { validateEmail, checkRateLimit, clearRateLimit, createSession, publicUser } = require('./_auth');
const { hashVerificationToken } = require('./_verification');
const { recordAnalyticsEventSafe } = require('./_analytics');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!hasTrustedOrigin(event)) return json(403, { error: 'Forbidden' });

  let email;
  let token;
  try {
    ({ email, token } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail) || typeof token !== 'string' || token.length !== 64) {
    return json(400, { error: 'This verification link is invalid or has expired.' });
  }

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'email-verification', {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) return json(429, { error: rateLimit.message });

  let verifiedUser;
  try {
    verifiedUser = await updateStore(store => {
      const user = store.users[normalizedEmail];
      const verification = store.emailVerifications[normalizedEmail];
      const valid = user && verification &&
        verification.tokenHash === hashVerificationToken(token) &&
        new Date(verification.expiresAt).getTime() > Date.now();

      if (!valid) {
        const error = new Error('This verification link is invalid or has expired.');
        error.statusCode = 401;
        throw error;
      }

      const now = new Date().toISOString();
      user.emailVerifiedAt = now;
      user.updatedAt = now;
      delete store.emailVerifications[normalizedEmail];
      return { ...user };
    });
  } catch (error) {
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Email verification failed. Please try again.',
    });
  }

  await clearRateLimit(event, normalizedEmail, 'email-verification');
  const session = await createSession(normalizedEmail);
  await recordAnalyticsEventSafe({ eventName: 'email_verified', email: normalizedEmail, path: '/app' });
  return json(200, {
    user: publicUser(verifiedUser, true, session.expiresAt),
    message: 'Email verified. Your account is ready.',
  }, { 'Set-Cookie': session.cookie });
};
