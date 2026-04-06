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
    goals: sanitizeGoals(progress?.goals || {}),
    currentCycleNumber: Math.max(1, parseInt(progress?.currentCycleNumber, 10) || 1),
    lastUpdated: new Date().toISOString(),
  };
}

function sanitizeHistory(history) {
  return Array.isArray(history) ? history.slice(-24) : [];
}

function sanitizeSettings(settings) {
  return {
    units: settings?.units === 'kg' ? 'kg' : 'lbs',
    darkMode: Boolean(settings?.darkMode),
    notificationTime: /^\d{2}:\d{2}$/.test(String(settings?.notificationTime || '')) ? settings.notificationTime : '07:00',
  };
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
    const next = {
      ...existing,
      progress: payload.progress ? sanitizeProgress(payload.progress) : existing.progress,
      history: payload.history ? sanitizeHistory(payload.history) : existing.history,
      settings: payload.settings ? sanitizeSettings(payload.settings) : existing.settings,
      profile: payload.profile ? sanitizeProfile(payload.profile) : existing.profile,
      weights: payload.weights ? sanitizeWeights(payload.weights) : existing.weights,
      updatedAt: new Date().toISOString(),
    };

    store.userData[session.email] = next;
    return next;
  });

  return json(200, { ok: true, data: updatedData });
};
