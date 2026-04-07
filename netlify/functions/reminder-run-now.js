const { json, hasTrustedOrigin, parseJsonBody } = require('./_response');
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

  const body = parseJsonBody(event);
  const force = Boolean(body.force);
  const reset = Boolean(body.reset);

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

      const workingEntry = reset
        ? {
            ...entry,
            lastSentAt: null,
            lastSentLocalDate: null,
            lastAttemptAt: null,
            lastAttemptStatus: null,
            lastAttemptReason: null,
          }
        : entry;

      const evaluation = evaluateReminderDue({
        now,
        settings,
        subscriptionEntry: workingEntry
      });

      if (!force && !evaluation.due) {
        nextSubscriptions.push({
          ...workingEntry,
          updatedAt: now.toISOString(),
          lastAttemptAt: now.toISOString(),
          lastAttemptStatus: 'manual-skipped',
          lastAttemptReason: evaluation.reason || 'manual-skipped'
        });
        outcomes.push({
          index,
          endpoint: String(workingEntry.subscription.endpoint).slice(0, 120),
          status: 'skipped',
          evaluation
        });
        continue;
      }

      try {
        const response = await sendPushRequest(workingEntry.subscription);
        const accepted = response.status === 201 || response.status === 202;

        if (!accepted) {
          const requestError = new Error(`Push service returned ${response.status}`);
          requestError.statusCode = response.status;
          throw requestError;
        }

        const updatedEntry = {
          ...workingEntry,
          updatedAt: now.toISOString(),
          lastSentAt: now.toISOString(),
          lastSentLocalDate: evaluation.local?.localDate || workingEntry.lastSentLocalDate || null,
          lastAttemptAt: now.toISOString(),
          lastAttemptStatus: `manual-sent:${response.status}`,
          lastAttemptReason: force ? `manual-force-${evaluation.reason || 'forced'}` : 'manual-run-due'
        };

        nextSubscriptions.push(updatedEntry);
        outcomes.push({
          index,
          endpoint: String(workingEntry.subscription.endpoint).slice(0, 120),
          status: `sent:${response.status}`,
          evaluation
        });
      } catch (error) {
        const statusCode = error?.statusCode || error?.status || 'unknown';
        nextSubscriptions.push({
          ...workingEntry,
          updatedAt: now.toISOString(),
          lastAttemptAt: now.toISOString(),
          lastAttemptStatus: `manual-error:${statusCode}`,
          lastAttemptReason: error?.message || 'manual-push-send-failed'
        });
        outcomes.push({
          index,
          endpoint: String(workingEntry.subscription.endpoint).slice(0, 120),
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
    force,
    reset,
    notificationEnabled: Boolean(settings.notificationEnabled),
    notificationTime: settings.notificationTime || null,
    notificationTimezone: settings.notificationTimezone || null,
    subscriptionCount: subscriptions.length,
    results
  });
};
