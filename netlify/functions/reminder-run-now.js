const { json, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { readStore, updateStore, normalizeEmail, getUserData } = require('./_store');
const { sendPushRequest, isConfigured } = require('./_push');
const { evaluateReminderDue } = require('./_reminder-debug');

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
  const store = await readStore();
  const userData = getUserData(store, normalizedEmail);
  const settings = userData.settings || {};
  const subscriptions = Array.isArray(store.pushSubscriptions?.[normalizedEmail])
    ? store.pushSubscriptions[normalizedEmail]
    : [];
  const now = new Date();

  const results = await updateStore(async (nextStore) => {
    const currentSubscriptions = Array.isArray(nextStore.pushSubscriptions?.[normalizedEmail])
      ? nextStore.pushSubscriptions[normalizedEmail]
      : [];

    const nextSubscriptions = [];
    const outcomes = [];

    for (let index = 0; index < currentSubscriptions.length; index += 1) {
      const entry = currentSubscriptions[index];
      if (!entry?.subscription?.endpoint) continue;

      const evaluation = evaluateReminderDue({
        now,
        settings,
        subscriptionEntry: entry
      });

      try {
        const response = await sendPushRequest(entry.subscription);
        const accepted = response.status === 201 || response.status === 202;

        if (!accepted) {
          const requestError = new Error(`Push service returned ${response.status}`);
          requestError.statusCode = response.status;
          throw requestError;
        }

        const updatedEntry = {
          ...entry,
          updatedAt: now.toISOString(),
          lastSentAt: now.toISOString(),
          lastSentLocalDate: evaluation.local?.localDate || entry.lastSentLocalDate || null,
          lastAttemptAt: now.toISOString(),
          lastAttemptStatus: `manual-sent:${response.status}`,
          lastAttemptReason: evaluation.due ? 'manual-run-due' : `manual-run-${evaluation.reason || 'forced'}`
        };

        nextSubscriptions.push(updatedEntry);
        outcomes.push({
          index,
          endpoint: String(entry.subscription.endpoint).slice(0, 120),
          status: `sent:${response.status}`,
          evaluation
        });
      } catch (error) {
        const statusCode = error?.statusCode || error?.status || 'unknown';
        nextSubscriptions.push({
          ...entry,
          lastAttemptAt: now.toISOString(),
          lastAttemptStatus: `manual-error:${statusCode}`,
          lastAttemptReason: error?.message || 'manual-push-send-failed'
        });
        outcomes.push({
          index,
          endpoint: String(entry.subscription.endpoint).slice(0, 120),
          status: `error:${statusCode}`,
          error: error?.message || 'manual-push-send-failed',
          evaluation
        });
      }
    }

    nextStore.pushSubscriptions[normalizedEmail] = nextSubscriptions;
    return outcomes;
  });

  return json(200, {
    ok: true,
    email: normalizedEmail,
    notificationEnabled: Boolean(settings.notificationEnabled),
    notificationTime: settings.notificationTime || null,
    notificationTimezone: settings.notificationTimezone || null,
    subscriptionCount: subscriptions.length,
    results
  });
};
