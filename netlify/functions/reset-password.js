const crypto = require('crypto');
const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { normalizeEmail, updateStore } = require('./_store');
const {
  validateEmail,
  validatePassword,
  checkRateLimit,
  clearRateLimit,
  hashPassword,
  createSession,
  publicUser,
} = require('./_auth');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!hasTrustedOrigin(event)) return json(403, { error: 'Forbidden' });

  let email;
  let token;
  let newPassword;
  let confirmNewPassword;
  try {
    ({ email, token, newPassword, confirmNewPassword } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail) || typeof token !== 'string' || token.length !== 64) {
    return json(400, { error: 'This reset link is invalid or has expired.' });
  }

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'password-reset', {
    maxAttempts: 5,
    windowMs: 30 * 60 * 1000,
  });
  if (!rateLimit.allowed) return json(429, { error: rateLimit.message });

  const passwordError = validatePassword(String(newPassword || ''));
  if (passwordError) return json(400, { error: passwordError });
  if (newPassword !== confirmNewPassword) return json(400, { error: 'New passwords do not match' });

  const nextPassword = await hashPassword(String(newPassword));
  let updatedUser;
  try {
    updatedUser = await updateStore(store => {
      const reset = store.passwordResets[normalizedEmail];
      const suppliedHash = hashToken(token);
      const validReset = reset &&
        reset.tokenHash === suppliedHash &&
        new Date(reset.expiresAt).getTime() > Date.now();

      if (!validReset || !store.users[normalizedEmail]) {
        const error = new Error('This reset link is invalid or has expired.');
        error.statusCode = 401;
        throw error;
      }

      const user = store.users[normalizedEmail];
      user.passwordHash = nextPassword.hash;
      user.passwordSalt = nextPassword.salt;
      if (user.emailVerifiedAt === null) user.emailVerifiedAt = new Date().toISOString();
      user.updatedAt = new Date().toISOString();
      delete store.passwordResets[normalizedEmail];
      delete store.emailVerifications[normalizedEmail];

      Object.entries(store.sessions).forEach(([sessionId, session]) => {
        if (normalizeEmail(session?.email) === normalizedEmail) delete store.sessions[sessionId];
      });

      return { ...user };
    });
  } catch (error) {
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : 'Password reset failed. Please try again.' });
  }

  await clearRateLimit(event, normalizedEmail, 'password-reset');
  const session = await createSession(normalizedEmail);
  return json(200, {
    user: publicUser(updatedUser, true, session.expiresAt),
    message: 'Password reset successfully.',
  }, { 'Set-Cookie': session.cookie });
};
