const crypto = require('crypto');
const { getRequestOrigin } = require('./_response');
const { updateStoreEntry } = require('./_store');
const { sendEmailVerification } = require('./_email');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function hashVerificationToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueEmailVerification(email, event) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const tokenHash = hashVerificationToken(token);

  await updateStoreEntry('emailVerifications', email, () => ({
    tokenHash,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + VERIFICATION_TTL_MS).toISOString(),
  }));

  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || getRequestOrigin(event);
  const verificationUrl = new URL('/app', siteUrl);
  verificationUrl.searchParams.set('verify_token', token);
  verificationUrl.searchParams.set('email', email);

  try {
    await sendEmailVerification({ to: email, verificationUrl: verificationUrl.href });
  } catch (error) {
    await updateStoreEntry('emailVerifications', email, current => (
      current?.tokenHash === tokenHash ? null : current
    ));
    throw error;
  }
}

module.exports = { hashVerificationToken, issueEmailVerification };
