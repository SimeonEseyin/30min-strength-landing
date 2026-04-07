const { json } = require('./_response');
const { updateStore, getUserData } = require('./_store');
const {
  isConfigured,
  sendPushRequest,
} = require('./_push');
const { evaluateReminderDue } = require('./_reminder-debug');

function maskEmail(email = '') {
  const value = String(email || '').trim().toLowerCase();
  const atIndex = value.indexOf('@');
  if (atIndex <= 1) return value;
  return `${value.slice(0, 2)}***${value.slice(atIndex)}`;
}

function describeEndpoint(endpoint = '') {
  try {
    const url = new URL(String(endpoint || ''));
    return `${url.hostname}${url.pathname.slice(-24)}`;
  } catch (error) {
    return String(endpoint || '').slice(0, 64);
  }
}

exports.handler = async () => {
  if (!isConfigured()) {
    console.log('[send-workout-reminders] push not configured');
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
    let users = 0;

    console.log('[send-workout-reminders] start', JSON.stringify({
      now: now.toISOString(),
      usersWithSubscriptions: Object.keys(store.pushSubscriptions || {}).length
    }));

    for (const email of Object.keys(store.pushSubscriptions || {})) {
      const subscriptions = Array.isArray(store.pushSubscriptions[email]) ? store.pushSubscriptions[email] : [];
      if (!subscriptions.length) continue;
      users += 1;

      const userData = getUserData(store, email);
      const settings = userData.settings || {};

      if (!settings.notificationEnabled) {
        console.log('[send-workout-reminders] user-skipped', JSON.stringify({
          email: maskEmail(email),
          reason: 'notifications-disabled',
          subscriptions: subscriptions.length
        }));
        continue;
      }

      const nextSubscriptions = [];

      for (const entry of subscriptions) {
        if (!entry || !entry.subscription || !entry.subscription.endpoint) continue;
        checked += 1;

        const evaluation = evaluateReminderDue({
          now,
          settings,
          subscriptionEntry: entry
        });

        if (!evaluation.local || !evaluation.due) {
          console.log('[send-workout-reminders] subscription-skipped', JSON.stringify({
            email: maskEmail(email),
            endpoint: describeEndpoint(entry.subscription.endpoint),
            localDate: evaluation.local?.localDate || null,
            localTime: evaluation.local?.formattedTime || null,
            targetMinutes: evaluation.targetMinutes,
            lastSentLocalDate: entry.lastSentLocalDate || null,
            reason: evaluation.reason || 'skipped'
          }));
          nextSubscriptions.push({
            ...entry,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: evaluation.due ? 'ready' : 'skipped',
            lastAttemptReason: evaluation.reason || 'skipped'
          });
          continue;
        }

        try {
          const response = await sendPushRequest(entry.subscription);
          const accepted = response.status === 201 || response.status === 202;

          if (!accepted) {
            const requestError = new Error(`Push service returned ${response.status}`);
            requestError.statusCode = response.status;
            throw requestError;
          }

          sent += 1;
          console.log('[send-workout-reminders] subscription-sent', JSON.stringify({
            email: maskEmail(email),
            endpoint: describeEndpoint(entry.subscription.endpoint),
            localDate: evaluation.local.localDate,
            localTime: evaluation.local.formattedTime,
            targetMinutes: evaluation.targetMinutes,
            responseStatus: response.status
          }));
          nextSubscriptions.push({
            ...entry,
            updatedAt: now.toISOString(),
            lastSentAt: now.toISOString(),
            lastSentLocalDate: evaluation.local.localDate,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: `sent:${response.status}`,
            lastAttemptReason: 'sent'
          });
        } catch (error) {
          const statusCode = error?.statusCode || error?.status;
          if (statusCode === 404 || statusCode === 410) {
            removed += 1;
            console.log('[send-workout-reminders] subscription-removed', JSON.stringify({
              email: maskEmail(email),
              endpoint: describeEndpoint(entry.subscription.endpoint),
              responseStatus: statusCode
            }));
            continue;
          }

          console.log('[send-workout-reminders] subscription-error', JSON.stringify({
            email: maskEmail(email),
            endpoint: describeEndpoint(entry.subscription.endpoint),
            responseStatus: statusCode || 'unknown',
            message: error?.message || 'push-send-failed'
          }));
          nextSubscriptions.push({
            ...entry,
            lastAttemptAt: now.toISOString(),
            lastAttemptStatus: `error:${statusCode || 'unknown'}`,
            lastAttemptReason: error?.message || 'push-send-failed'
          });
        }
      }

      store.pushSubscriptions[email] = nextSubscriptions;
    }

    return {
      sent,
      removed,
      checked,
      users
    };
  });

  console.log('[send-workout-reminders] complete', JSON.stringify({
    sent: result.sent,
    removed: result.removed,
    checked: result.checked,
    users: result.users
  }));

  return json(200, {
    ok: true,
    ...result
  });
};
