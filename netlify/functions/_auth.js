const crypto = require('crypto');
const { normalizeEmail, readStore, updateStore } = require('./_store');
const { parseCookies, serializeCookie } = require('./_response');

const SESSION_COOKIE = 'devdad_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const loginAttempts = new Map();

function getCookieOptions() {
  const isProduction = process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProduction,
    path: '/',
  };
}

function sanitizeName(email) {
  return String(email || '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 60) || 'Member';
}

function validateEmail(email) {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

function validatePassword(password) {
  const errors = [];
  if (password.length < 8) errors.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('one number');
  return errors.length ? `Password must contain ${errors.join(', ')}` : null;
}

function getClientKey(event, email, scope = 'auth') {
  const forwardedFor = event.headers?.['x-forwarded-for'] || event.headers?.['X-Forwarded-For'] || 'unknown';
  return `${scope}::${forwardedFor.split(',')[0].trim()}::${normalizeEmail(email)}`;
}

function checkRateLimit(event, email, scope = 'auth') {
  const now = Date.now();
  const key = getClientKey(event, email, scope);
  const existing = loginAttempts.get(key);

  if (!existing || now - existing.firstAttempt > 15 * 60 * 1000) {
    loginAttempts.set(key, { count: 1, firstAttempt: now, lastAttempt: now });
    return { allowed: true };
  }

  if (now - existing.lastAttempt < 2000) {
    return { allowed: false, message: 'Please wait before trying again.' };
  }

  if (existing.count >= 5) {
    const waitTime = Math.ceil((15 * 60 * 1000 - (now - existing.firstAttempt)) / 60000);
    return { allowed: false, message: `Too many attempts. Wait ${waitTime} minute(s).` };
  }

  existing.count += 1;
  existing.lastAttempt = now;
  loginAttempts.set(key, existing);
  return { allowed: true };
}

function clearRateLimit(event, email, scope = 'auth') {
  loginAttempts.delete(getClientKey(event, email, scope));
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = await scryptAsync(password, salt);
  return {
    salt,
    hash: derivedKey.toString('hex'),
  };
}

async function verifyPassword(password, salt, expectedHash) {
  const derivedKey = await scryptAsync(password, salt);
  const actual = Buffer.from(derivedKey.toString('hex'), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function createSession(email) {
  const normalizedEmail = normalizeEmail(email);
  const token = randomToken();
  const sessionId = hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await updateStore(store => {
    store.sessions[sessionId] = {
      email: normalizedEmail,
      createdAt: now.toISOString(),
      expiresAt,
    };
  });

  return {
    token,
    cookie: serializeCookie(SESSION_COOKIE, token, {
      ...getCookieOptions(),
      maxAge: SESSION_TTL_SECONDS,
    }),
    expiresAt,
  };
}

async function destroySession(event) {
  const token = parseCookies(event.headers?.cookie || '')[SESSION_COOKIE];
  if (token) {
    await updateStore(store => {
      delete store.sessions[hashToken(token)];
    });
  }
  return serializeCookie(SESSION_COOKIE, '', {
    ...getCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
}

async function getSession(event) {
  const token = parseCookies(event.headers?.cookie || '')[SESSION_COOKIE];
  if (!token) return null;

  const sessionId = hashToken(token);
  const store = await readStore();
  const session = store.sessions[sessionId];
  if (!session) return null;

  if (new Date(session.expiresAt) <= new Date()) {
    await updateStore(nextStore => {
      delete nextStore.sessions[sessionId];
    });
    return null;
  }

  const user = store.users[normalizeEmail(session.email)];
  if (!user) return null;

  return {
    sessionId,
    email: normalizeEmail(session.email),
    user,
    hasPurchased: Boolean(store.entitlements[normalizeEmail(session.email)]),
    expiresAt: session.expiresAt,
  };
}

function publicUser(user, hasPurchased, expiresAt) {
  return {
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    hasPurchased,
    expiresAt,
  };
}

module.exports = {
  SESSION_COOKIE,
  sanitizeName,
  validateEmail,
  validatePassword,
  checkRateLimit,
  clearRateLimit,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSession,
  publicUser,
};
