const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dataDir = path.join('/tmp', `devdad-auth-test-${process.pid}`);
process.env.DEVDAD_DATA_DIR = dataDir;
process.env.CONTEXT = 'production';
process.env.URL = 'https://example.com';

const signup = require('../netlify/functions/auth-signup').handler;
const login = require('../netlify/functions/auth-login').handler;
const session = require('../netlify/functions/auth-session').handler;
const loadUserData = require('../netlify/functions/load-user-data').handler;
const requestPasswordReset = require('../netlify/functions/request-password-reset').handler;
const resetPassword = require('../netlify/functions/reset-password').handler;
const aiCoach = require('../netlify/functions/ai-coach').handler;
const { updateStore } = require('../netlify/functions/_store');

function event(method, body, { cookie = '', ip = '127.0.0.1' } = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      host: 'example.com',
      origin: 'https://example.com',
      cookie,
      'x-forwarded-for': ip,
      'x-forwarded-proto': 'https',
    },
  };
}

function body(response) {
  return JSON.parse(response.body);
}

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('registered access, queue recovery, token reset, and paid AI lock', async () => {
  const firstSignup = await signup(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
  }, { ip: '10.0.0.1' }));
  assert.equal(firstSignup.statusCode, 200);
  assert.equal(body(firstSignup).user.hasAccess, true);

  const duplicate = await signup(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
  }, { ip: '10.0.0.2' }));
  assert.equal(duplicate.statusCode, 409);

  const secondSignup = await signup(event('POST', {
    email: 'second@example.com',
    password: 'StrongPass2',
    confirmPassword: 'StrongPass2',
  }, { ip: '10.0.0.3' }));
  assert.equal(secondSignup.statusCode, 200, 'a rejected write must not poison later writes');

  const unauthorizedData = await loadUserData(event('GET'));
  assert.equal(unauthorizedData.statusCode, 401);

  const unknownResetRequest = await requestPasswordReset(event('POST', {
    email: 'missing@example.com',
  }, { ip: '10.0.0.8' }));
  assert.equal(unknownResetRequest.statusCode, 200);
  assert.match(body(unknownResetRequest).message, /If an account exists/);

  const cookie = firstSignup.headers['Set-Cookie'].split(';')[0];
  const activeSession = await session(event('GET', undefined, { cookie }));
  assert.equal(activeSession.statusCode, 200);
  assert.equal(body(activeSession).user.email, 'first@example.com');

  const token = crypto.randomBytes(32).toString('hex');
  await updateStore(store => {
    store.passwordResets['first@example.com'] = {
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  });

  const reset = await resetPassword(event('POST', {
    email: 'first@example.com',
    token,
    newPassword: 'NewStrongPass3',
    confirmNewPassword: 'NewStrongPass3',
  }, { ip: '10.0.0.4' }));
  assert.equal(reset.statusCode, 200);

  const oldLogin = await login(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
  }, { ip: '10.0.0.5' }));
  assert.equal(oldLogin.statusCode, 401);

  const newLogin = await login(event('POST', {
    email: 'first@example.com',
    password: 'NewStrongPass3',
  }, { ip: '10.0.0.6' }));
  assert.equal(newLogin.statusCode, 200);

  const resetCookie = newLogin.headers['Set-Cookie'].split(';')[0];
  const coachPayload = {
    snapshot: { units: 'lbs', recentFeedback: [], currentWorkout: { loadableExercises: [] } },
  };
  const lockedCoach = await aiCoach(event('POST', coachPayload, { cookie: resetCookie, ip: '10.0.0.7' }));
  assert.equal(lockedCoach.statusCode, 403);
  assert.equal(body(lockedCoach).code, 'paid_feature');
});
