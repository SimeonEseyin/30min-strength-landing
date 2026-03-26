const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const dataDir = process.env.DEVDAD_DATA_DIR || path.join(rootDir, '.mvp-data');
const storeFile = path.join(dataDir, 'store.json');

let writeChain = Promise.resolve();

function defaultUserData() {
  return {
    progress: {
      currentWeek: 1,
      currentDay: 1,
      completedDays: [],
      workoutFeedback: {},
      goals: {
        targetWeight: '',
        strengthGoal: '',
        consistencyGoal: 80,
        customGoal: '',
      },
      currentCycleNumber: 1,
      lastUpdated: null,
    },
    history: [],
    settings: {
      units: 'lbs',
      darkMode: false,
      notificationTime: '07:00',
    },
    profile: {
      currentWeight: '',
      height: '',
      weightHistory: [],
      avatarDataUrl: '',
    },
    weights: {},
    updatedAt: null,
  };
}

function defaultStore() {
  return {
    users: {},
    entitlements: {},
    sessions: {},
    userData: {},
  };
}

function ensureStoreFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(storeFile)) {
    fs.writeFileSync(storeFile, JSON.stringify(defaultStore(), null, 2));
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function mergeDefaults(store) {
  const merged = {
    ...defaultStore(),
    ...store,
  };

  if (!merged.users || typeof merged.users !== 'object') merged.users = {};
  if (!merged.entitlements || typeof merged.entitlements !== 'object') merged.entitlements = {};
  if (!merged.sessions || typeof merged.sessions !== 'object') merged.sessions = {};
  if (!merged.userData || typeof merged.userData !== 'object') merged.userData = {};

  return merged;
}

async function readStore() {
  ensureStoreFile();
  const raw = await fs.promises.readFile(storeFile, 'utf8');
  try {
    return mergeDefaults(JSON.parse(raw));
  } catch {
    return defaultStore();
  }
}

async function writeStore(store) {
  ensureStoreFile();
  await fs.promises.writeFile(storeFile, JSON.stringify(mergeDefaults(store), null, 2));
}

async function updateStore(mutator) {
  writeChain = writeChain.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  return writeChain;
}

function getUserData(store, email) {
  const normalizedEmail = normalizeEmail(email);
  return {
    ...defaultUserData(),
    ...(store.userData[normalizedEmail] || {}),
    progress: {
      ...defaultUserData().progress,
      ...((store.userData[normalizedEmail] || {}).progress || {}),
      goals: {
        ...defaultUserData().progress.goals,
        ...(((store.userData[normalizedEmail] || {}).progress || {}).goals || {}),
      },
    },
    settings: {
      ...defaultUserData().settings,
      ...((store.userData[normalizedEmail] || {}).settings || {}),
    },
    profile: {
      ...defaultUserData().profile,
      ...((store.userData[normalizedEmail] || {}).profile || {}),
    },
    history: Array.isArray((store.userData[normalizedEmail] || {}).history)
      ? (store.userData[normalizedEmail] || {}).history
      : [],
    weights: ((store.userData[normalizedEmail] || {}).weights && typeof (store.userData[normalizedEmail] || {}).weights === 'object')
      ? (store.userData[normalizedEmail] || {}).weights
      : {},
  };
}

module.exports = {
  defaultUserData,
  normalizeEmail,
  readStore,
  updateStore,
  getUserData,
};
