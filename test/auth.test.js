const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dataDir = path.join('/tmp', `devdad-auth-test-${process.pid}`);
process.env.DEVDAD_DATA_DIR = dataDir;
process.env.CONTEXT = 'production';
process.env.URL = 'https://example.com';
process.env.RESEND_API_KEY = 're_test';
process.env.PASSWORD_RESET_FROM_EMAIL = 'DevDad Strength <reset@example.com>';
process.env.ANALYTICS_ADMIN_TOKEN = 'test-analytics-admin-token';

const originalFetch = global.fetch;
const sentEmails = [];
global.fetch = async (url, options = {}) => {
  if (String(url) === 'https://api.resend.com/emails') {
    sentEmails.push(JSON.parse(options.body));
    return { ok: true, status: 200 };
  }
  throw new Error(`Unexpected fetch in test: ${url}`);
};

const signup = require('../netlify/functions/auth-signup').handler;
const login = require('../netlify/functions/auth-login').handler;
const session = require('../netlify/functions/auth-session').handler;
const loadUserData = require('../netlify/functions/load-user-data').handler;
const requestPasswordReset = require('../netlify/functions/request-password-reset').handler;
const resetPassword = require('../netlify/functions/reset-password').handler;
const aiCoach = require('../netlify/functions/ai-coach').handler;
const premiumInterest = require('../netlify/functions/premium-interest').handler;
const verifyEmail = require('../netlify/functions/verify-email').handler;
const trackEvent = require('../netlify/functions/track-event').handler;
const analyticsSummary = require('../netlify/functions/analytics-summary').handler;
const { updateStore, readStoreEntry } = require('../netlify/functions/_store');

function event(method, body, { cookie = '', ip = '127.0.0.1', authorization = '' } = {}) {
  return {
    httpMethod: method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      host: 'example.com',
      origin: 'https://example.com',
      cookie,
      'x-forwarded-for': ip,
      'x-forwarded-proto': 'https',
      authorization,
    },
  };
}

function body(response) {
  return JSON.parse(response.body);
}

test.after(() => {
  global.fetch = originalFetch;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function latestEmailToken(parameter) {
  const email = sentEmails.at(-1);
  const url = new URL(email.text.match(/https:\/\/\S+/)[0]);
  return url.searchParams.get(parameter);
}

test('consent, email verification, registered access, recovery, and paid feature locks', async () => {
  const visitorId = 'visitor_1234567890123456';
  const landingEvent = await trackEvent(event('POST', {
    eventName: 'landing_view',
    visitorId,
    path: '/',
    attribution: { source: 'test', campaign: 'auth-flow' },
  }, { ip: '10.0.0.12' }));
  assert.equal(landingEvent.statusCode, 202);

  const forgedServerEvent = await trackEvent(event('POST', {
    eventName: 'account_created',
    visitorId,
    path: '/',
  }, { ip: '10.0.0.12' }));
  assert.equal(forgedServerEvent.statusCode, 400);

  const rejectedTerms = await signup(event('POST', {
    email: 'terms@example.com',
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
    termsAccepted: false,
  }, { ip: '10.0.0.9' }));
  assert.equal(rejectedTerms.statusCode, 400);

  const firstSignup = await signup(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
    termsAccepted: true,
  }, { ip: '10.0.0.1' }));
  assert.equal(firstSignup.statusCode, 202);
  assert.equal(body(firstSignup).requiresVerification, true);

  const unverifiedLogin = await login(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
  }, { ip: '10.0.0.10' }));
  assert.equal(unverifiedLogin.statusCode, 403);
  assert.equal(body(unverifiedLogin).code, 'email_verification_required');

  const verification = await verifyEmail(event('POST', {
    email: 'first@example.com',
    token: latestEmailToken('verify_token'),
  }, { ip: '10.0.0.11' }));
  assert.equal(verification.statusCode, 200);
  assert.equal(body(verification).user.hasAccess, true);

  const duplicate = await signup(event('POST', {
    email: 'first@example.com',
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
    termsAccepted: true,
  }, { ip: '10.0.0.2' }));
  assert.equal(duplicate.statusCode, 409);

  const secondSignup = await signup(event('POST', {
    email: 'second@example.com',
    password: 'StrongPass2',
    confirmPassword: 'StrongPass2',
    termsAccepted: true,
  }, { ip: '10.0.0.3' }));
  assert.equal(secondSignup.statusCode, 202, 'a rejected write must not poison later writes');

  const unauthorizedData = await loadUserData(event('GET'));
  assert.equal(unauthorizedData.statusCode, 401);

  const unknownResetRequest = await requestPasswordReset(event('POST', {
    email: 'missing@example.com',
  }, { ip: '10.0.0.8' }));
  assert.equal(unknownResetRequest.statusCode, 200);
  assert.match(body(unknownResetRequest).message, /If an account exists/);

  const cookie = verification.headers['Set-Cookie'].split(';')[0];
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

  const anonymousInterest = await premiumInterest(event('POST', { feature: 'ai-coach' }));
  assert.equal(anonymousInterest.statusCode, 401);

  const joinedInterest = await premiumInterest(event('POST', { feature: 'ai-coach' }, { cookie: resetCookie }));
  assert.equal(joinedInterest.statusCode, 200);
  assert.equal(body(joinedInterest).ok, true);

  const anonymousActorId = `anon_${crypto.createHash('sha256').update(visitorId).digest('hex')}`;
  const anonymousAnalytics = await readStoreEntry('analyticsActors', anonymousActorId);
  assert.equal(anonymousAnalytics.events.landing_view.count, 1);

  const userActorId = `user_${crypto.createHash('sha256').update('first@example.com').digest('hex')}`;
  const userAnalytics = await readStoreEntry('analyticsActors', userActorId);
  assert.equal(userAnalytics.events.account_created.count, 1);
  assert.equal(userAnalytics.events.email_verified.count, 1);
  assert.equal(userAnalytics.events.premium_interest_saved.count, 1);

  const deniedSummary = await analyticsSummary(event('GET'));
  assert.equal(deniedSummary.statusCode, 401);

  const summary = await analyticsSummary(event('GET', undefined, {
    authorization: `Bearer ${process.env.ANALYTICS_ADMIN_TOKEN}`,
  }));
  assert.equal(summary.statusCode, 200);
  assert.equal(body(summary).events.landing_view.uniqueActors, 1);
  assert.equal(body(summary).events.account_created.uniqueActors, 2);
});
