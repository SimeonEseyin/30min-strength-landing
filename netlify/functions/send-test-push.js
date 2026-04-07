const { json, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { normalizeEmail, updateStore } = require('./_store');
const {
  isConfigured,
  sendPushRequest,
} = require('./_push');

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

  if (!isConfigured()) {
    return json(503, { error: 'Push notifications are not configured on the server.' });
  }

  const normalizedEmail = normalizeEmail(session.email);

  const result = await updateStore(async (store) => {
    const subscriptions = Array.isArray(store.pushSubscriptions[normalizedEmail])
      ? store.pushSubscriptions[normalizedEmail]
      : [];

    if (!subscriptions.length) {
      return {
        sent: 0,
        removed: 0,
        error: 'No push subscription is stored for this account on this deploy.'
      };
    }

    const nextSubscriptions = [];
    let sent = 0;
    let removed = 0;

    for (const entry of subscriptions) {
      if (!entry?.subscription?.endpoint) continue;

      try {
        const response = await sendPushRequest(entry.subscription);
        const accepted = response.status === 201 || response.status === 202;

        if (!accepted) {
          const requestError = new Error(`Push service returned ${response.status}`);
          requestError.statusCode = response.status;
          throw requestError;
        }

        sent += 1;
        nextSubscriptions.push({
          ...entry,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        const statusCode = error?.statusCode || error?.status;
        if (statusCode === 404 || statusCode === 410) {
          removed += 1;
          continue;
        }

        nextSubscriptions.push(entry);
      }
    }

    store.pushSubscriptions[normalizedEmail] = nextSubscriptions;

    return {
      sent,
      removed,
      error: sent > 0 ? '' : 'The server could not deliver a test push to this device.'
    };
  });

  if (result.sent > 0) {
    return json(200, {
      ok: true,
      sent: result.sent,
      removed: result.removed
    });
  }

  return json(500, {
    error: result.error || 'Unable to deliver a test push right now.',
    sent: result.sent || 0,
    removed: result.removed || 0
  });
};
