const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { normalizeEmail, readStoreEntry } = require('./_store');
const { validateEmail, checkRateLimit } = require('./_auth');
const { issueEmailVerification } = require('./_verification');

const GENERIC_MESSAGE = 'If that account still needs verification, a new link has been sent.';

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

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'resend-verification', {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000,
    minimumIntervalMs: 10_000,
  });
  if (!rateLimit.allowed) return json(429, { error: rateLimit.message });

  const user = await readStoreEntry('users', normalizedEmail);
  if (user?.emailVerifiedAt === null) {
    try {
      await issueEmailVerification(normalizedEmail, event);
    } catch (error) {
      console.error('Unable to resend verification email:', error.message);
    }
  }

  return json(200, { ok: true, message: GENERIC_MESSAGE });
};
