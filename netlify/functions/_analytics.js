const crypto = require('crypto');
const { normalizeEmail, updateStoreEntry } = require('./_store');

const ANALYTICS_EVENTS = new Set([
  'landing_view',
  'quiz_started',
  'quiz_completed',
  'signup_started',
  'account_created',
  'verification_requested',
  'email_verified',
  'login_completed',
  'first_workout_started',
  'first_workout_completed',
  'workout_completed',
  'premium_interest_clicked',
  'premium_interest_saved',
]);

const CLIENT_EVENTS = new Set([
  'landing_view',
  'quiz_started',
  'quiz_completed',
  'signup_started',
  'premium_interest_clicked',
]);

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sanitizeText(value, maxLength = 120) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

function validVisitorId(visitorId) {
  return /^[a-zA-Z0-9_-]{16,80}$/.test(String(visitorId || ''));
}

function sanitizeAttribution(attribution) {
  if (!attribution || typeof attribution !== 'object') return {};
  return {
    source: sanitizeText(attribution.source, 80),
    medium: sanitizeText(attribution.medium, 80),
    campaign: sanitizeText(attribution.campaign, 100),
    content: sanitizeText(attribution.content, 100),
    term: sanitizeText(attribution.term, 100),
    referrerHost: sanitizeText(attribution.referrerHost, 120),
    landingPath: sanitizeText(attribution.landingPath, 160),
  };
}

async function recordAnalyticsEvent({ eventName, email = '', visitorId = '', path = '', attribution = {} }) {
  if (!ANALYTICS_EVENTS.has(eventName)) throw new Error('Unknown analytics event');

  const normalizedEmail = normalizeEmail(email);
  const hasVisitor = validVisitorId(visitorId);
  if (!normalizedEmail && !hasVisitor) return false;

  const actorId = normalizedEmail
    ? `user_${hashIdentifier(normalizedEmail)}`
    : `anon_${hashIdentifier(visitorId)}`;
  const anonymousHash = hasVisitor ? hashIdentifier(visitorId) : '';
  const now = new Date().toISOString();
  const safePath = sanitizeText(path, 160);
  const safeAttribution = sanitizeAttribution(attribution);

  await updateStoreEntry('analyticsActors', actorId, existing => {
    const previousEvent = existing?.events?.[eventName] || {};
    const firstAttribution = existing?.firstAttribution && Object.keys(existing.firstAttribution).length
      ? existing.firstAttribution
      : safeAttribution;

    return {
      schemaVersion: 1,
      actorType: normalizedEmail ? 'user' : 'anonymous',
      anonymousIdHash: normalizedEmail && anonymousHash
        ? anonymousHash
        : (existing?.anonymousIdHash || ''),
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      firstAttribution,
      lastAttribution: Object.keys(safeAttribution).some(key => safeAttribution[key])
        ? safeAttribution
        : (existing?.lastAttribution || {}),
      events: {
        ...(existing?.events || {}),
        [eventName]: {
          count: Math.max(0, Number(previousEvent.count) || 0) + 1,
          firstAt: previousEvent.firstAt || now,
          lastAt: now,
          lastPath: safePath || previousEvent.lastPath || '',
        },
      },
    };
  });

  return true;
}

async function recordAnalyticsEventSafe(event) {
  try {
    return await recordAnalyticsEvent(event);
  } catch (error) {
    console.error('Analytics event failed:', error.message);
    return false;
  }
}

module.exports = {
  ANALYTICS_EVENTS,
  CLIENT_EVENTS,
  validVisitorId,
  recordAnalyticsEvent,
  recordAnalyticsEventSafe,
};
