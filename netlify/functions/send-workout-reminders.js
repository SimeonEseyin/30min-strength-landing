const { json } = require('./_response');
const { updateStore, getUserData } = require('./_store');
const {
  isConfigured,
  sendPushRequest,
} = require('./_push');
const { evaluateReminderDue } = require('./_reminder-debug');
const {
  buildReminderPayload,
  getReminderMode,
  updateNotificationHistory,
} = require('./_reminder-modes');

exports.handler = async () => {
  if (!isConfigured()) {
    return json(200, {
      ok: true,
      sent: 0,
      skipped: 'push-not-configured'
    });
  }

  const result = await updateStore(async (store) => {
    const now = new Date();
    let sent = 0;
    let removed = 0;
    let checked = 0;

    for (const email of Object.keys(store.pushSubscriptions || {})) {
      const subscriptions = Array.isArray(store.pushSubscriptions[email]) ? store.pushSubscriptions[email] : [];
      if (!subscriptions.length) continue;

      const userData = getUserData(store, email);
      const userRecord = store.users[email] || {};
      const settings = userData.settings || {};
      const reminderMode = getReminderMode(userData, userRecord, now);
      const reminderPayload = buildReminderPayload(reminderMode, userData);

      if (!settings.notificationEnabled) {
        continue;
      }

      const nextSubscriptions = [];
      let sentLocalDate = null;
      let userSentAny = false;

      for (const entry of subscriptions) {
        if (!entry || !entry.subscription || !entry.subscription.endpoint) continue;
        checked += 1;

        const evaluation = evaluateReminderDue({
          now,
          settings,
          subscriptionEntry: entry
        });

        if (!evaluation.local || !evaluation.due) {
          nextSubscriptions.push({
            ...entry,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: evaluation.due ? 'ready' : 'skipped',
            lastAttemptReason: evaluation.reason || 'skipped'
          });
          continue;
        }

        try {
          const response = await sendPushRequest(entry.subscription, reminderPayload);
          const accepted = response.status === 201 || response.status === 202;

          if (!accepted) {
            const requestError = new Error(`Push service returned ${response.status}`);
            requestError.statusCode = response.status;
            throw requestError;
          }

          sent += 1;
          userSentAny = true;
          sentLocalDate = sentLocalDate || evaluation.local.localDate;
          nextSubscriptions.push({
            ...entry,
            updatedAt: now.toISOString(),
            lastSentAt: now.toISOString(),
            lastSentLocalDate: evaluation.local.localDate,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: `sent:${response.status}`,
            lastAttemptReason: reminderMode.type
          });
        } catch (error) {
          const statusCode = error?.statusCode || error?.status;
          if (statusCode === 404 || statusCode === 410) {
            removed += 1;
            continue;
          }

          nextSubscriptions.push({
            ...entry,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: `error:${statusCode || 'unknown'}`,
            lastAttemptReason: `${reminderMode.type}:${error?.message || 'push-send-failed'}`
          });
        }
      }

      store.pushSubscriptions[email] = nextSubscriptions;
      if (userSentAny) {
        store.userData[email] = {
          ...userData,
          notificationHistory: updateNotificationHistory(
            userData.notificationHistory || {},
            reminderMode,
            now.toISOString(),
            sentLocalDate
          ),
          updatedAt: now.toISOString(),
        };
      }
    }

    return {
      sent,
      removed,
      checked
    };
  });

  return json(200, {
    ok: true,
    ...result
  });
};
