const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getSession } = require('./_auth');
const { updateStore, getUserData } = require('./_store');

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value, maxLength = 500) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

function sanitizeGoals(goals) {
  return {
    targetWeight: sanitizeString(goals?.targetWeight || '', 50),
    strengthGoal: sanitizeString(goals?.strengthGoal || '', 120),
    consistencyGoal: Math.max(0, Math.min(100, parseInt(goals?.consistencyGoal, 10) || 80)),
    customGoal: sanitizeString(goals?.customGoal || '', 240),
  };
}

function sanitizeProgress(progress) {
  return {
    currentWeek: Math.max(1, Math.min(12, parseInt(progress?.currentWeek, 10) || 1)),
    currentDay: Math.max(1, Math.min(7, parseInt(progress?.currentDay, 10) || 1)),
    completedDays: Array.isArray(progress?.completedDays) ? progress.completedDays.slice(-200) : [],
    workoutFeedback: isPlainObject(progress?.workoutFeedback) ? progress.workoutFeedback : {},
    lastWorkoutStartedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(progress?.lastWorkoutStartedAt || ''))
      ? String(progress.lastWorkoutStartedAt)
      : null,
    goals: sanitizeGoals(progress?.goals || {}),
    currentCycleNumber: Math.max(1, parseInt(progress?.currentCycleNumber, 10) || 1),
    lastUpdated: new Date().toISOString(),
  };
}

function sanitizeAchievement(achievement) {
  if (!isPlainObject(achievement)) return null;

  return {
    icon: sanitizeString(achievement.icon || '', 8),
    text: sanitizeString(achievement.text || '', 80),
    desc: sanitizeString(achievement.desc || '', 180),
  };
}

function sanitizePlanSnapshot(planSnapshot) {
  if (!isPlainObject(planSnapshot)) return null;

  const sessionLength = parseInt(planSnapshot.sessionLength, 10);
  const validSessionLengths = new Set([15, 30, 45, 60]);
  const validScheduleTemplates = new Set(['3-day', '4-day']);

  return {
    focus: sanitizeString(planSnapshot.focus || 'Build strength', 80) || 'Build strength',
    sessionLength: validSessionLengths.has(sessionLength) ? sessionLength : 30,
    trainingEnvironment: sanitizeString(planSnapshot.trainingEnvironment || 'Home only', 40) || 'Home only',
    scheduleTemplate: validScheduleTemplates.has(String(planSnapshot.scheduleTemplate || ''))
      ? String(planSnapshot.scheduleTemplate)
      : '3-day',
  };
}

function sanitizeHistoryEntry(entry) {
  if (!isPlainObject(entry)) return null;

  const totalWorkouts = Math.max(0, Math.min(84, parseInt(entry.totalWorkouts, 10) || 0));
  const targetWorkouts = Math.max(totalWorkouts, Math.min(84, parseInt(entry.targetWorkouts, 10) || totalWorkouts));

  return {
    schemaVersion: Math.max(1, Math.min(2, parseInt(entry.schemaVersion, 10) || 1)),
    cycleNumber: Math.max(1, parseInt(entry.cycleNumber, 10) || 1),
    completedDate: /^\d{4}-\d{2}-\d{2}T/.test(String(entry.completedDate || '')) ? entry.completedDate : new Date().toISOString(),
    totalWorkouts,
    targetWorkouts,
    consistencyRate: Math.max(0, Math.min(100, parseInt(entry.consistencyRate, 10) || 0)),
    perfectWorkouts: Math.max(0, Math.min(totalWorkouts, parseInt(entry.perfectWorkouts, 10) || 0)),
    progressionWorkouts: Math.max(0, Math.min(totalWorkouts, parseInt(entry.progressionWorkouts, 10) || 0)),
    achievements: Array.isArray(entry.achievements)
      ? entry.achievements.map(sanitizeAchievement).filter(Boolean).slice(0, 16)
      : [],
    goals: sanitizeGoals(entry.goals || {}),
    planSnapshot: sanitizePlanSnapshot(entry.planSnapshot),
    completedDays: Array.isArray(entry.completedDays) ? entry.completedDays.slice(-200) : [],
    workoutFeedback: isPlainObject(entry.workoutFeedback) ? entry.workoutFeedback : {},
  };
}

function sanitizeHistory(history) {
  return Array.isArray(history)
    ? history.map(sanitizeHistoryEntry).filter(Boolean).slice(-24)
    : [];
}

function sanitizeSettings(settings) {
  return {
    units: settings?.units === 'kg' ? 'kg' : 'lbs',
    darkMode: true,
    notificationEnabled: Boolean(settings?.notificationEnabled),
    notificationTimezone: String(settings?.notificationTimezone || '').trim().slice(0, 100) || 'UTC',
    notificationTime: /^\d{2}:\d{2}$/.test(String(settings?.notificationTime || '')) ? settings.notificationTime : '07:00',
  };
}

function reminderScheduleChanged(previousSettings = {}, nextSettings = {}) {
  return (
    Boolean(previousSettings.notificationEnabled) !== Boolean(nextSettings.notificationEnabled) ||
    String(previousSettings.notificationTime || '') !== String(nextSettings.notificationTime || '') ||
    String(previousSettings.notificationTimezone || '') !== String(nextSettings.notificationTimezone || '')
  );
}

function sanitizeProfile(profile) {
  const avatarDataUrl = String(profile?.avatarDataUrl || '').trim();
  const safeAvatarDataUrl = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(avatarDataUrl) && avatarDataUrl.length <= 200_000
    ? avatarDataUrl
    : '';

  return {
    currentWeight: sanitizeString(profile?.currentWeight || '', 20),
    height: sanitizeString(profile?.height || '', 20),
    weightHistory: Array.isArray(profile?.weightHistory) ? profile.weightHistory.slice(-365) : [],
    avatarDataUrl: safeAvatarDataUrl,
  };
}

function sanitizeWeights(weights) {
  return isPlainObject(weights) ? weights : {};
}

function sanitizeCoachSuggestion(suggestion) {
  if (!isPlainObject(suggestion)) return null;

  const targetWeight = Number(suggestion.targetWeight);
  return {
    exerciseName: sanitizeString(suggestion.exerciseName || '', 120),
    action: sanitizeString(suggestion.action || '', 32),
    targetWeight: Number.isFinite(targetWeight) ? targetWeight : null,
    units: sanitizeString(suggestion.units || '', 16),
    reason: sanitizeString(suggestion.reason || '', 240),
  };
}

function sanitizeCoachCache(coachCache) {
  if (!isPlainObject(coachCache)) {
    return {
      coach: null,
      snapshot: '',
      updatedAt: null,
    };
  }

  const coach = isPlainObject(coachCache.coach) ? coachCache.coach : null;
  if (!coach) {
    return {
      coach: null,
      snapshot: '',
      updatedAt: null,
    };
  }

  const suggestions = Array.isArray(coach.suggestions)
    ? coach.suggestions.map(sanitizeCoachSuggestion).filter(Boolean).slice(0, 3)
    : [];

  return {
    coach: {
      headline: sanitizeString(coach.headline || '', 160),
      summary: sanitizeString(coach.summary || '', 320),
      sessionFocus: sanitizeString(coach.sessionFocus || '', 240),
      recoveryNote: sanitizeString(coach.recoveryNote || '', 240),
      recommendationType: sanitizeString(coach.recommendationType || '', 32),
      confidence: sanitizeString(coach.confidence || '', 16),
      suggestions,
      source: sanitizeString(coach.source || '', 32),
    },
    snapshot: sanitizeString(coachCache.snapshot || '', 4000),
    updatedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(coachCache.updatedAt || '')) ? coachCache.updatedAt : new Date().toISOString(),
  };
}

function sanitizePlanConfig(planConfig) {
  if (!isPlainObject(planConfig)) {
    return {
      focus: 'Build strength',
      sessionLength: 30,
      trainingEnvironment: 'Home only',
      availableEquipment: ['Dumbbells'],
      recoveryMode: 'normal',
      scheduleTemplate: '3-day',
      seededFromQuiz: false,
      lastAdjustedAt: null,
    };
  }

  const sessionLength = parseInt(planConfig.sessionLength, 10);
  const validSessionLengths = new Set([15, 30, 45, 60]);
  const validRecoveryModes = new Set(['light', 'moderate', 'normal']);
  const validScheduleTemplates = new Set(['3-day', '4-day']);

  return {
    focus: sanitizeString(planConfig.focus || 'Build strength', 80) || 'Build strength',
    sessionLength: validSessionLengths.has(sessionLength) ? sessionLength : 30,
    trainingEnvironment: sanitizeString(planConfig.trainingEnvironment || 'Home only', 40) || 'Home only',
    availableEquipment: Array.isArray(planConfig.availableEquipment)
      ? planConfig.availableEquipment.map(item => sanitizeString(item, 40)).filter(Boolean).slice(0, 8)
      : ['Dumbbells'],
    recoveryMode: validRecoveryModes.has(String(planConfig.recoveryMode || '')) ? String(planConfig.recoveryMode) : 'normal',
    scheduleTemplate: validScheduleTemplates.has(String(planConfig.scheduleTemplate || '')) ? String(planConfig.scheduleTemplate) : '3-day',
    seededFromQuiz: Boolean(planConfig.seededFromQuiz),
    lastAdjustedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(planConfig.lastAdjustedAt || '')) ? planConfig.lastAdjustedAt : null,
  };
}

function sanitizeQuizAnswers(quizAnswers) {
  if (!isPlainObject(quizAnswers)) return null;

  return {
    goal: sanitizeString(quizAnswers.goal || '', 80),
    time: sanitizeString(quizAnswers.time || '', 40),
    location: sanitizeString(quizAnswers.location || '', 40),
    sleep: sanitizeString(quizAnswers.sleep || '', 40),
    challenge: sanitizeString(quizAnswers.challenge || '', 80),
    equipment: Array.isArray(quizAnswers.equipment)
      ? quizAnswers.equipment.map(item => sanitizeString(item, 40)).filter(Boolean).slice(0, 8)
      : [],
  };
}

function sanitizeQuizPreview(preview) {
  if (!isPlainObject(preview)) return null;

  const frequency = parseInt(preview.frequency, 10);
  const minutes = parseInt(preview.minutes, 10);
  return {
    frequency: Number.isFinite(frequency) ? Math.max(1, Math.min(7, frequency)) : 3,
    minutes: Number.isFinite(minutes) ? Math.max(10, Math.min(120, minutes)) : 30,
    setup: sanitizeString(preview.setup || '', 80),
    recovery: sanitizeString(preview.recovery || '', 160),
    challenge: sanitizeString(preview.challenge || '', 160),
  };
}

function sanitizeIntake(intake) {
  if (!isPlainObject(intake)) {
    return {
      source: '',
      capturedAt: null,
      seededAt: null,
      quizAnswers: null,
      preview: null,
    };
  }

  return {
    source: sanitizeString(intake.source || '', 32),
    capturedAt: /^\d{4}-\d{2}-\d{2}T/.test(String(intake.capturedAt || '')) ? intake.capturedAt : null,
    seededAt: /^\d{4}-\d{2}-\d{2}T/.test(String(intake.seededAt || '')) ? intake.seededAt : null,
    quizAnswers: sanitizeQuizAnswers(intake.quizAnswers),
    preview: sanitizeQuizPreview(intake.preview),
  };
}

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

  let payload;
  try {
    payload = parseJsonBody(event);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const rawSize = JSON.stringify(payload || {}).length;
  if (rawSize > 300_000) {
    return json(413, { error: 'Payload too large' });
  }

  const updatedData = await updateStore(store => {
    const existing = getUserData(store, session.email);
    const nextSettings = payload.settings ? sanitizeSettings(payload.settings) : existing.settings;
    const next = {
      ...existing,
      progress: payload.progress ? sanitizeProgress(payload.progress) : existing.progress,
      history: payload.history ? sanitizeHistory(payload.history) : existing.history,
      settings: nextSettings,
      profile: payload.profile ? sanitizeProfile(payload.profile) : existing.profile,
      weights: payload.weights ? sanitizeWeights(payload.weights) : existing.weights,
      coachCache: payload.coachCache ? sanitizeCoachCache(payload.coachCache) : existing.coachCache,
      planConfig: payload.planConfig ? sanitizePlanConfig(payload.planConfig) : existing.planConfig,
      intake: payload.intake ? sanitizeIntake(payload.intake) : existing.intake,
      updatedAt: new Date().toISOString(),
    };

    if (payload.settings && reminderScheduleChanged(existing.settings, nextSettings)) {
      const currentSubscriptions = Array.isArray(store.pushSubscriptions?.[session.email])
        ? store.pushSubscriptions[session.email]
        : [];

      store.pushSubscriptions[session.email] = currentSubscriptions.map((entry) => ({
        ...entry,
        lastSentAt: null,
        lastSentLocalDate: null,
        lastAttemptAt: null,
        lastAttemptStatus: null,
        lastAttemptReason: null,
        updatedAt: new Date().toISOString()
      }));
    }

    store.userData[session.email] = next;
    return next;
  });

  return json(200, { ok: true, data: updatedData });
};
