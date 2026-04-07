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
      hour,
      minute,
      minutes: hour * 60 + minute,
      formattedTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
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

function evaluateReminderDue({ now, settings, subscriptionEntry }) {
  const timeZone = String(subscriptionEntry?.notificationTimezone || settings?.notificationTimezone || 'UTC');
  const localParts = getLocalTimeParts(now, timeZone);
  const targetMinutes = getScheduledMinutes(settings?.notificationTime);

  if (!localParts) {
    return {
      timeZone,
      local: null,
      targetMinutes,
      due: false,
      reason: 'local-time-unavailable'
    };
  }

  const due =
    Boolean(settings?.notificationEnabled) &&
    localParts.minutes >= targetMinutes &&
    subscriptionEntry?.lastSentLocalDate !== localParts.localDate;

  return {
    timeZone,
    local: localParts,
    targetMinutes,
    due,
    reason: !settings?.notificationEnabled
      ? 'notifications-disabled'
      : localParts.minutes < targetMinutes
        ? 'before-target-time'
        : subscriptionEntry?.lastSentLocalDate === localParts.localDate
          ? 'already-sent-today'
          : 'due-now'
  };
}

module.exports = {
  getLocalTimeParts,
  getScheduledMinutes,
  evaluateReminderDue,
};
