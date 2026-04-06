const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const tempDataDir = path.join(process.env.TMPDIR || '/tmp', 'devdad-data');

function getPreferredDataDir() {
  if (process.env.DEVDAD_DATA_DIR) {
    return process.env.DEVDAD_DATA_DIR;
  }

  const runningInServerless = Boolean(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    __dirname.startsWith('/var/task') ||
    process.cwd().startsWith('/var/task') ||
    rootDir.startsWith('/var/task')
  );

  if (runningInServerless) {
    return tempDataDir;
  }

  return path.join(rootDir, '.mvp-data');
}

const preferredDataDir = getPreferredDataDir();
let activeStoreFile = null;

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

function isRecoverableStoreError(error) {
  return Boolean(error && ['ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes(error.code));
}

function ensureStoreFileForDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const storeFile = path.join(dataDir, 'store.json');
  if (!fs.existsSync(storeFile)) {
    fs.writeFileSync(storeFile, JSON.stringify(defaultStore(), null, 2));
  }
  return storeFile;
}

function ensureStoreFile() {
  if (activeStoreFile && fs.existsSync(activeStoreFile)) {
    return activeStoreFile;
  }

  const candidates = [...new Set([preferredDataDir, tempDataDir])];
  let lastError = null;

  for (const candidate of candidates) {
    try {
      activeStoreFile = ensureStoreFileForDir(candidate);
      return activeStoreFile;
    } catch (error) {
      lastError = error;
      if (!isRecoverableStoreError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
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
  const storeFile = ensureStoreFile();
  const raw = await fs.promises.readFile(storeFile, 'utf8');
  try {
    return mergeDefaults(JSON.parse(raw));
  } catch {
    return defaultStore();
  }
}

async function writeStore(store) {
  const storeFile = ensureStoreFile();
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
