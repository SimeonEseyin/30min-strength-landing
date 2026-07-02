const crypto = require('crypto');
const { json, parseJsonBody, hasTrustedOrigin, getRequestOrigin } = require('./_response');
const { normalizeEmail, readStoreEntry, updateStoreEntry } = require('./_store');
const { validateEmail, checkRateLimit } = require('./_auth');
const { sendPasswordResetEmail } = require('./_email');

const RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!hasTrustedOrigin(event)) return json(403, { error: 'Forbidden' });

  let email;
  try {
    ({ email } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'password-reset-request', {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000,
    minimumIntervalMs: 10_000,
  });
  if (!rateLimit.allowed) return json(429, { error: rateLimit.message });

  const user = await readStoreEntry('users', normalizedEmail);
  if (!user) {
    return json(200, { ok: true, message: GENERIC_MESSAGE });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await updateStoreEntry('passwordResets', normalizedEmail, () => ({
      tokenHash: hashToken(token),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RESET_TTL_MS).toISOString(),
  }));

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || getRequestOrigin(event);
  const resetUrl = new URL('/app', siteUrl);
  resetUrl.searchParams.set('reset_token', token);
  resetUrl.searchParams.set('email', normalizedEmail);

  try {
    await sendPasswordResetEmail({ to: normalizedEmail, resetUrl: resetUrl.href });
  } catch (error) {
    console.error('Unable to send password reset email:', error.message);
    await updateStoreEntry('passwordResets', normalizedEmail, current => {
      if (current?.tokenHash === hashToken(token)) return null;
      return current;
    });
  }

  return json(200, { ok: true, message: GENERIC_MESSAGE });
};
