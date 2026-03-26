const { json, parseJsonBody } = require('./_response');
const { normalizeEmail, readStore, updateStore } = require('./_store');
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

  const rateLimit = checkRateLimit(event, normalizedEmail);
  if (!rateLimit.allowed) {
    return json(429, { error: rateLimit.message });
  }

  const store = await readStore();
  const user = store.users[normalizedEmail];
  if (!user) {
    return json(401, { error: 'Invalid email or password' });
  }

  const validPassword = await verifyPassword(String(password || ''), user.passwordSalt, user.passwordHash);
  if (!validPassword) {
    return json(401, { error: 'Invalid email or password' });
  }

  clearRateLimit(event, normalizedEmail);
  await updateStore(nextStore => {
    if (nextStore.users[normalizedEmail]) {
      nextStore.users[normalizedEmail].updatedAt = new Date().toISOString();
      nextStore.users[normalizedEmail].lastLoginAt = new Date().toISOString();
    }
  });

  const session = await createSession(normalizedEmail);
  return json(200, {
    user: publicUser(user, Boolean(store.entitlements[normalizedEmail]), session.expiresAt),
  }, {
    'Set-Cookie': session.cookie,
  });
};
