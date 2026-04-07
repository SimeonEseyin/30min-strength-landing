const { json } = require('./_response');
const { updateStore, getUserData } = require('./_store');
const {
  isConfigured,
  sendPushRequest,
  buildReminderPayload,
} = require('./_push');

const REMINDER_WINDOW_MINUTES = 20;

function getLocalTimeParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') {
        acc[part.type] = part.value;
      }
      return acc;
    }, {});

    const hour = parseInt(parts.hour, 10);
    const minute = parseInt(parts.minute, 10);
    const year = parts.year;
    const month = parts.month;
    const day = parts.day;

    if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
      return null;
    }

    return {
      localDate: `${year}-${month}-${day}`,
      minutes: hour * 60 + minute
    };
  } catch (error) {
    return null;
  }
}

function getScheduledMinutes(timeString) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeString || ''));
  if (!match) return 7 * 60;
  return (parseInt(match[1], 10) * 60) + parseInt(match[2], 10);
}

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
      const settings = userData.settings || {};

      if (!settings.notificationEnabled) {
        continue;
      }

      const targetMinutes = getScheduledMinutes(settings.notificationTime);
      const nextSubscriptions = [];

      for (const entry of subscriptions) {
        if (!entry || !entry.subscription || !entry.subscription.endpoint) continue;
        checked += 1;

        const timeZone = String(entry.notificationTimezone || settings.notificationTimezone || 'UTC');
        const localParts = getLocalTimeParts(now, timeZone);
        if (!localParts) {
          nextSubscriptions.push(entry);
          continue;
        }

        const isDue =
          localParts.minutes >= targetMinutes &&
          localParts.minutes < (targetMinutes + REMINDER_WINDOW_MINUTES) &&
          entry.lastSentLocalDate !== localParts.localDate;

        if (!isDue) {
          nextSubscriptions.push(entry);
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
          nextSubscriptions.push({
            ...entry,
            updatedAt: new Date().toISOString(),
            lastSentAt: new Date().toISOString(),
            lastSentLocalDate: localParts.localDate
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

      store.pushSubscriptions[email] = nextSubscriptions;
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
