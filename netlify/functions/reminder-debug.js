const { json } = require('./_response');
const { getSession } = require('./_auth');
const { readStore, normalizeEmail, getUserData } = require('./_store');
const { evaluateReminderDue } = require('./_reminder-debug');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  const store = await readStore();
  const normalizedEmail = normalizeEmail(session.email);
  const userData = getUserData(store, normalizedEmail);
  const settings = userData.settings || {};
  const subscriptions = Array.isArray(store.pushSubscriptions?.[normalizedEmail])
    ? store.pushSubscriptions[normalizedEmail]
    : [];
  const now = new Date();

  const diagnostics = subscriptions.map((entry, index) => ({
    index,
    endpoint: String(entry?.subscription?.endpoint || '').slice(0, 120),
    createdAt: entry?.createdAt || null,
    updatedAt: entry?.updatedAt || null,
    lastSentAt: entry?.lastSentAt || null,
    lastSentLocalDate: entry?.lastSentLocalDate || null,
    lastAttemptAt: entry?.lastAttemptAt || null,
    lastAttemptStatus: entry?.lastAttemptStatus || null,
    lastAttemptReason: entry?.lastAttemptReason || null,
    evaluation: evaluateReminderDue({
      now,
      settings,
      subscriptionEntry: entry
    })
  }));

  return json(200, {
    ok: true,
    serverTimeIso: now.toISOString(),
    email: normalizedEmail,
    settings: {
      notificationEnabled: Boolean(settings.notificationEnabled),
      notificationTime: settings.notificationTime || null,
      notificationTimezone: settings.notificationTimezone || null,
    },
    subscriptionCount: subscriptions.length,
    subscriptions: diagnostics
  });
};
