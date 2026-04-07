const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { normalizeEmail, updateStore } = require('./_store');
const { getPublicKey, getSubject, isConfigured: isPushConfigured } = require('./_push');

function sanitizeSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;

  const endpoint = String(subscription.endpoint || '').trim();
  const auth = String(subscription.keys?.auth || '').trim();
  const p256dh = String(subscription.keys?.p256dh || '').trim();

  if (!/^https:\/\//.test(endpoint) || !auth || !p256dh) {
    return null;
  }

  return {
    endpoint,
    expirationTime: Number.isFinite(subscription.expirationTime) ? subscription.expirationTime : null,
    keys: {
      auth,
      p256dh
    }
  };
}

function sanitizeTime(value) {
  const raw = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(raw) ? raw : '07:00';
}

function sanitizeTimeZone(value) {
  return String(value || '').trim().slice(0, 100) || 'UTC';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return json(200, {
      configured: isPushConfigured(),
      publicKey: getPublicKey() || null,
      subject: getSubject()
    });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  const normalizedEmail = normalizeEmail(session.email);

  if (event.httpMethod === 'POST') {
    const body = parseJsonBody(event);
    const subscription = sanitizeSubscription(body.subscription);
    if (!subscription) {
      return json(400, { error: 'Invalid push subscription.' });
    }

    const notificationTime = sanitizeTime(body.notificationTime);
    const notificationTimezone = sanitizeTimeZone(body.notificationTimezone);

    await updateStore((store) => {
      const existing = Array.isArray(store.pushSubscriptions[normalizedEmail])
        ? store.pushSubscriptions[normalizedEmail]
        : [];
      const currentEntry = existing.find(
        (entry) => entry && entry.subscription && entry.subscription.endpoint === subscription.endpoint
      );
      const now = new Date().toISOString();

      const nextSubscriptions = existing
        .filter((entry) => entry && entry.subscription && entry.subscription.endpoint !== subscription.endpoint)
        .concat([{
          subscription,
          notificationTimezone,
          createdAt: currentEntry?.createdAt || now,
          updatedAt: now,
          lastSentAt: currentEntry?.lastSentAt || null,
          lastSentLocalDate: currentEntry?.lastSentLocalDate || null,
          userAgent: String(event.headers?.['user-agent'] || '').slice(0, 240)
        }]);

      store.pushSubscriptions[normalizedEmail] = nextSubscriptions.slice(-8);
      store.userData[normalizedEmail] = store.userData[normalizedEmail] || {};
      store.userData[normalizedEmail].settings = {
        ...((store.userData[normalizedEmail] || {}).settings || {}),
        notificationEnabled: true,
        notificationTime,
        notificationTimezone
      };
    });

    return json(200, {
      ok: true,
      configured: isPushConfigured()
    });
  }

  if (event.httpMethod === 'DELETE') {
    const body = parseJsonBody(event);
    const endpoint = String(body?.subscription?.endpoint || '').trim();
    if (!endpoint) {
      return json(400, { error: 'Subscription endpoint required.' });
    }

    await updateStore((store) => {
      const existing = Array.isArray(store.pushSubscriptions[normalizedEmail])
        ? store.pushSubscriptions[normalizedEmail]
        : [];

      store.pushSubscriptions[normalizedEmail] = existing.filter(
        (entry) => entry && entry.subscription && entry.subscription.endpoint !== endpoint
      );
    });

    return json(200, { ok: true });
  }

  return json(405, { error: 'Method Not Allowed' });
};
