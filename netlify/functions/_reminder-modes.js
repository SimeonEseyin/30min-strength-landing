const ACTUAL_WORKOUT_FEEDBACK = new Set(['perfect', 'easy', 'hard']);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function parseIsoDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getActualWorkoutEntries(progress = {}) {
  return Object.values(progress.workoutFeedback || {})
    .filter((entry) => entry && ACTUAL_WORKOUT_FEEDBACK.has(entry.feedback))
    .map((entry) => {
      const date = parseIsoDate(entry.date);
      if (!date) return null;
      return {
        ...entry,
        dateObject: date,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateObject - b.dateObject);
}

function getLatestActualWorkout(entries = []) {
  return entries.length ? entries[entries.length - 1] : null;
}

function getCurrentWeekActualWorkoutCount(progress = {}) {
  const currentWeek = Math.max(1, parseInt(progress.currentWeek, 10) || 1);
  return Object.values(progress.workoutFeedback || {}).filter(
    (entry) => entry && ACTUAL_WORKOUT_FEEDBACK.has(entry.feedback) && Number(entry.week) === currentWeek
  ).length;
}

function getScheduleTarget(planConfig = {}) {
  return String(planConfig.scheduleTemplate || '') === '4-day' ? 4 : 3;
}

function getWeekKey(progress = {}) {
  return `week-${Math.max(1, parseInt(progress.currentWeek, 10) || 1)}`;
}

function getReminderMode(userData = {}, userRecord = {}, now = new Date()) {
  const progress = userData.progress || {};
  const history = userData.notificationHistory || {};
  const actualWorkouts = getActualWorkoutEntries(progress);
  const latestActualWorkout = getLatestActualWorkout(actualWorkouts);
  const startedAt = parseIsoDate(progress.lastWorkoutStartedAt);

  if (
    startedAt &&
    (now.getTime() - startedAt.getTime()) >= FOUR_HOURS_MS &&
    (!latestActualWorkout || latestActualWorkout.dateObject.getTime() < startedAt.getTime()) &&
    String(history.incompleteWorkout?.lastStartedAt || '') !== String(progress.lastWorkoutStartedAt || '')
  ) {
    return {
      type: 'incomplete-workout',
      details: {
        startedAt: progress.lastWorkoutStartedAt,
      },
    };
  }

  const createdAt = parseIsoDate(userRecord.createdAt);
  if (
    actualWorkouts.length === 0 &&
    createdAt &&
    (now.getTime() - createdAt.getTime()) >= ONE_DAY_MS &&
    !history.firstWorkout?.lastSentAt
  ) {
    return {
      type: 'first-workout',
      details: {
        createdAt: userRecord.createdAt,
      },
    };
  }

  if (
    latestActualWorkout &&
    (now.getTime() - latestActualWorkout.dateObject.getTime()) >= THREE_DAYS_MS &&
    String(history.inactive?.lastCompletedAt || '') !== String(latestActualWorkout.date || '')
  ) {
    return {
      type: 'inactive-3day',
      details: {
        lastCompletedAt: latestActualWorkout.date,
      },
    };
  }

  const weekKey = getWeekKey(progress);
  const currentDay = Math.max(1, parseInt(progress.currentDay, 10) || 1);
  if (
    currentDay >= 5 &&
    getCurrentWeekActualWorkoutCount(progress) < getScheduleTarget(userData.planConfig || {}) &&
    String(history.weeklyCatchup?.lastWeekKey || '') !== weekKey
  ) {
    return {
      type: 'weekly-catchup',
      details: {
        weekKey,
      },
    };
  }

  return {
    type: 'daily-reminder',
    details: {},
  };
}

function updateNotificationHistory(existingHistory = {}, reminderMode = {}, nowIso, localDate) {
  const history = {
    firstWorkout: {
      lastSentAt: null,
      lastSentLocalDate: null,
      ...(existingHistory.firstWorkout || {}),
    },
    incompleteWorkout: {
      lastSentAt: null,
      lastSentLocalDate: null,
      lastStartedAt: null,
      ...(existingHistory.incompleteWorkout || {}),
    },
    inactive: {
      lastSentAt: null,
      lastSentLocalDate: null,
      lastCompletedAt: null,
      ...(existingHistory.inactive || {}),
    },
    weeklyCatchup: {
      lastSentAt: null,
      lastSentLocalDate: null,
      lastWeekKey: null,
      ...(existingHistory.weeklyCatchup || {}),
    },
  };

  if (reminderMode.type === 'first-workout') {
    history.firstWorkout = {
      ...history.firstWorkout,
      lastSentAt: nowIso,
      lastSentLocalDate: localDate,
    };
  } else if (reminderMode.type === 'incomplete-workout') {
    history.incompleteWorkout = {
      ...history.incompleteWorkout,
      lastSentAt: nowIso,
      lastSentLocalDate: localDate,
      lastStartedAt: reminderMode.details?.startedAt || history.incompleteWorkout.lastStartedAt,
    };
  } else if (reminderMode.type === 'inactive-3day') {
    history.inactive = {
      ...history.inactive,
      lastSentAt: nowIso,
      lastSentLocalDate: localDate,
      lastCompletedAt: reminderMode.details?.lastCompletedAt || history.inactive.lastCompletedAt,
    };
  } else if (reminderMode.type === 'weekly-catchup') {
    history.weeklyCatchup = {
      ...history.weeklyCatchup,
      lastSentAt: nowIso,
      lastSentLocalDate: localDate,
      lastWeekKey: reminderMode.details?.weekKey || history.weeklyCatchup.lastWeekKey,
    };
  }

  return history;
}

function buildReminderPayload(reminderMode = {}, userData = {}) {
  const progress = userData.progress || {};
  const currentWeek = Math.max(1, parseInt(progress.currentWeek, 10) || 1);
  const currentDay = Math.max(1, parseInt(progress.currentDay, 10) || 1);
  const scheduleTarget = getScheduleTarget(userData.planConfig || {});

  if (reminderMode.type === 'first-workout') {
    return {
      title: 'Start your first workout',
      body: 'Day 1 is ready. Open DevDad and get your first 30-minute session done.',
      tag: 'devdad-first-workout',
      url: '/app',
      renotify: true,
    };
  }

  if (reminderMode.type === 'incomplete-workout') {
    return {
      title: 'Finish today’s workout',
      body: `You started Week ${currentWeek}, Day ${currentDay}. Come back and finish the session.`,
      tag: `devdad-incomplete-w${currentWeek}d${currentDay}`,
      url: '/app',
      renotify: true,
    };
  }

  if (reminderMode.type === 'inactive-3day') {
    return {
      title: 'Time to get back in',
      body: `You have been away a few days. Open DevDad and restart with Week ${currentWeek}, Day ${currentDay}.`,
      tag: 'devdad-inactive-reminder',
      url: '/app',
      renotify: true,
    };
  }

  if (reminderMode.type === 'weekly-catchup') {
    return {
      title: 'Keep this week on track',
      body: `You are still within reach of your ${scheduleTarget}-workout week. One more session keeps momentum up.`,
      tag: `devdad-weekly-catchup-${getWeekKey(progress)}`,
      url: '/app',
      renotify: true,
    };
  }

  return {
    title: 'Time for your 30-minute session',
    body: `Week ${currentWeek}, Day ${currentDay} is ready. Open DevDad and keep your plan moving.`,
    tag: `devdad-daily-reminder-w${currentWeek}d${currentDay}`,
    url: '/app',
    renotify: false,
  };
}

module.exports = {
  buildReminderPayload,
  getReminderMode,
  updateNotificationHistory,
};
