const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getPublicStoreError, normalizeEmail, updateStore } = require('./_store');
const { issueEmailVerification } = require('./_verification');
const { recordAnalyticsEventSafe, validVisitorId } = require('./_analytics');
const {
  sanitizeName,
  validateEmail,
  validatePassword,
  checkRateLimit,
  clearRateLimit,
  hashPassword,
} = require('./_auth');

const TERMS_VERSION = '2026-07-02';

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
  let termsAccepted;
  let analytics;

  try {
    ({ email, password, confirmPassword, termsAccepted, analytics } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!validateEmail(normalizedEmail)) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  const rateLimit = await checkRateLimit(event, normalizedEmail, 'signup');
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

  if (termsAccepted !== true) {
    return json(400, { error: 'You must accept the Terms of Service and Privacy Policy' });
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
        emailVerifiedAt: null,
        termsAcceptedAt: now,
        termsVersion: TERMS_VERSION,
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

  try {
    await issueEmailVerification(normalizedEmail, event);
  } catch (error) {
    await updateStore(store => {
      if (store.users[normalizedEmail]?.createdAt === createdUser.createdAt && store.users[normalizedEmail]?.emailVerifiedAt === null) {
        delete store.users[normalizedEmail];
      }
      delete store.emailVerifications[normalizedEmail];
    });
    await clearRateLimit(event, normalizedEmail, 'signup');
    return json(503, { error: 'We could not send the verification email. Please try again shortly.' });
  }

  await clearRateLimit(event, normalizedEmail, 'signup');
  const visitorId = validVisitorId(analytics?.visitorId) ? analytics.visitorId : '';
  await recordAnalyticsEventSafe({
    eventName: 'account_created',
    email: normalizedEmail,
    visitorId,
    path: analytics?.path,
    attribution: analytics?.attribution,
  });
  await recordAnalyticsEventSafe({
    eventName: 'verification_requested',
    email: normalizedEmail,
    visitorId,
    path: analytics?.path,
    attribution: analytics?.attribution,
  });
  return json(202, {
    requiresVerification: true,
    email: normalizedEmail,
    message: 'Check your email to activate your account.',
  });
};
