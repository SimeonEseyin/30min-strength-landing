const { json, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { updateStore, normalizeEmail } = require('./_store');

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

  const normalizedEmail = normalizeEmail(session.email);

  const result = await updateStore(async (store) => {
    const subscriptions = Array.isArray(store.pushSubscriptions?.[normalizedEmail])
      ? store.pushSubscriptions[normalizedEmail]
      : [];

    const nextSubscriptions = subscriptions.map((entry) => ({
      ...entry,
      lastSentAt: null,
      lastSentLocalDate: null,
      lastAttemptAt: null,
      lastAttemptStatus: null,
      lastAttemptReason: null,
      updatedAt: new Date().toISOString()
    }));

    store.pushSubscriptions[normalizedEmail] = nextSubscriptions;

    return {
      reset: nextSubscriptions.length
    };
  });

  return json(200, {
    ok: true,
    ...result
  });
};
