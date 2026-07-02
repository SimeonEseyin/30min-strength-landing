const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getSession, checkRateLimit } = require('./_auth');
const { CLIENT_EVENTS, validVisitorId, recordAnalyticsEventSafe } = require('./_analytics');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });
  if (!hasTrustedOrigin(event)) return json(403, { error: 'Forbidden' });

  let eventName;
  let visitorId;
  let path;
  let attribution;
  try {
    ({ eventName, visitorId, path, attribution } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!CLIENT_EVENTS.has(eventName) || !validVisitorId(visitorId)) {
    return json(400, { error: 'Invalid analytics event' });
  }

  const rateLimit = await checkRateLimit(event, 'client-events', 'analytics', {
    maxAttempts: 100,
    windowMs: 24 * 60 * 60 * 1000,
    minimumIntervalMs: 0,
  });
  if (!rateLimit.allowed) return json(429, { error: 'Analytics rate limit reached' });

  let session = null;
  try {
    session = await getSession(event);
  } catch {
    session = null;
  }

  await recordAnalyticsEventSafe({
    eventName,
    email: session?.email || '',
    visitorId,
    path,
    attribution,
  });

  return json(202, { accepted: true });
};
