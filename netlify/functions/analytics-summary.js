const crypto = require('crypto');
const { json } = require('./_response');
const { readStore } = require('./_store');
const { ANALYTICS_EVENTS } = require('./_analytics');

const FUNNEL_STEPS = [
  'landing_view',
  'quiz_started',
  'quiz_completed',
  'signup_started',
  'account_created',
  'email_verified',
  'first_workout_started',
  'first_workout_completed',
  'premium_interest_saved',
];

function authorized(event) {
  const expected = String(process.env.ANALYTICS_ADMIN_TOKEN || '').trim();
  const authorization = event.headers?.authorization || event.headers?.Authorization || '';
  const analyticsToken = event.headers?.['x-analytics-token'] || event.headers?.['X-Analytics-Token'] || '';
  const supplied = String(analyticsToken || authorization).replace(/^Bearer\s+/i, '').trim();
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });
  if (!process.env.ANALYTICS_ADMIN_TOKEN) {
    return json(503, { error: 'Analytics reporting is not configured.' });
  }
  if (!authorized(event)) return json(401, { error: 'Unauthorized' });

  const store = await readStore();
  const actors = Object.values(store.analyticsActors || {});
  const eventSummary = {};

  for (const eventName of ANALYTICS_EVENTS) {
    eventSummary[eventName] = { uniqueActors: 0, totalEvents: 0 };
  }

  for (const actor of actors) {
    for (const [eventName, eventRecord] of Object.entries(actor?.events || {})) {
      if (!eventSummary[eventName]) continue;
      eventSummary[eventName].uniqueActors += 1;
      eventSummary[eventName].totalEvents += Math.max(0, Number(eventRecord?.count) || 0);
    }
  }

  let previousActors = null;
  const funnel = FUNNEL_STEPS.map(eventName => {
    const uniqueActors = eventSummary[eventName]?.uniqueActors || 0;
    const conversionFromPrevious = previousActors === null
      ? null
      : (previousActors > 0 ? Math.round((uniqueActors / previousActors) * 1000) / 10 : 0);
    previousActors = uniqueActors;
    return { eventName, uniqueActors, conversionFromPrevious };
  });

  const now = Date.now();
  const registeredActors = actors.filter(actor => actor?.actorType === 'user');
  const retention = [1, 7, 30].map(day => {
    const thresholdMs = day * 24 * 60 * 60 * 1000;
    const eligible = registeredActors.filter(actor => {
      const firstSeen = new Date(actor.firstSeenAt).getTime();
      return Number.isFinite(firstSeen) && now - firstSeen >= thresholdMs;
    });
    const returned = eligible.filter(actor => {
      const firstSeen = new Date(actor.firstSeenAt).getTime();
      const lastSeen = new Date(actor.lastSeenAt).getTime();
      return Number.isFinite(lastSeen) && lastSeen - firstSeen >= thresholdMs;
    });
    return {
      day,
      eligibleActors: eligible.length,
      returnedActors: returned.length,
      returnRate: eligible.length ? Math.round((returned.length / eligible.length) * 1000) / 10 : null,
    };
  });

  return json(200, {
    generatedAt: new Date().toISOString(),
    actors: {
      total: actors.length,
      anonymous: actors.filter(actor => actor?.actorType === 'anonymous').length,
      registered: actors.filter(actor => actor?.actorType === 'user').length,
    },
    events: eventSummary,
    funnel,
    retention,
  });
};
