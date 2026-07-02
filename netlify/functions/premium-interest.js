const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { updateStoreEntry } = require('./_store');
const { recordAnalyticsEventSafe } = require('./_analytics');

const ALLOWED_FEATURES = new Set(['ai-coach']);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  let feature;
  try {
    ({ feature } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!ALLOWED_FEATURES.has(feature)) {
    return json(400, { error: 'Unknown premium feature' });
  }

  const now = new Date().toISOString();
  await updateStoreEntry('premiumInterests', session.email, existing => ({
    email: session.email,
    features: {
      ...(existing?.features || {}),
      [feature]: {
        firstRequestedAt: existing?.features?.[feature]?.firstRequestedAt || now,
        lastRequestedAt: now,
      },
    },
    updatedAt: now,
  }));
  await recordAnalyticsEventSafe({
    eventName: 'premium_interest_saved',
    email: session.email,
    path: '/app',
  });

  return json(200, {
    ok: true,
    message: 'You are on the AI Coach early-access list.',
  });
};
