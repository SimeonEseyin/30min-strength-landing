const fs = require('fs');
const path = require('path');
let getStore = null;

try {
  ({ getStore } = require('@netlify/blobs'));
} catch {
  getStore = null;
}

const rootDir = path.resolve(__dirname, '..', '..');
const tempDataDir = path.join(process.env.TMPDIR || '/tmp', 'devdad-data');
const STORE_BLOB_KEY = 'store';
const STORE_NAMESPACE = 'devdad-data';
const BLOB_WRITE_RETRIES = 5;

function getPreferredDataDir() {
  if (process.env.DEVDAD_DATA_DIR) {
    return process.env.DEVDAD_DATA_DIR;
  }

  return path.join(rootDir, '.mvp-data');
}

function isServerlessRuntime() {
  return Boolean(
    process.env.NETLIFY ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    __dirname.startsWith('/var/task') ||
    process.cwd().startsWith('/var/task') ||
    rootDir.startsWith('/var/task')
  );
}

function canUseNetlifyBlobs() {
  return isServerlessRuntime() && typeof getStore === 'function';
}

function createBlobStore() {
  if (!canUseNetlifyBlobs()) {
    return null;
  }

  try {
    return getStore({
      name: STORE_NAMESPACE,
      consistency: 'strong',
    });
  } catch {
    return null;
  }
}

const preferredDataDir = getPreferredDataDir();
let activeStoreFile = null;
let activeBlobStore = undefined;

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

function shouldFallbackFromBlobError(error) {
  if (!error) return false;
  return Boolean(
    error.name === 'MissingBlobsEnvironmentError' ||
    error.code === 'NOT_FOUND' ||
    error.code === 'FORBIDDEN' ||
    error.status === 401 ||
    error.status === 403
  );
}

function getBlobStore() {
  if (activeBlobStore !== undefined) {
    return activeBlobStore;
  }

  activeBlobStore = createBlobStore();
  return activeBlobStore;
}

function disableBlobStore() {
  activeBlobStore = null;
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
  const blobStore = getBlobStore();
  if (blobStore) {
    try {
      const store = await blobStore.get(STORE_BLOB_KEY, {
        type: 'json',
        consistency: 'strong',
      });
      return mergeDefaults(store || defaultStore());
    } catch (error) {
      if (isRecoverableStoreError(error)) {
        return mergeDefaults(defaultStore());
      }
      if (shouldFallbackFromBlobError(error)) {
        disableBlobStore();
      } else {
        throw error;
      }
    }
  }

  const storeFile = ensureStoreFile();
  const raw = await fs.promises.readFile(storeFile, 'utf8');
  try {
    return mergeDefaults(JSON.parse(raw));
  } catch {
    return defaultStore();
  }
}

async function writeStore(store) {
  const blobStore = getBlobStore();
  if (blobStore) {
    try {
      await blobStore.setJSON(STORE_BLOB_KEY, mergeDefaults(store));
      return;
    } catch (error) {
      if (!shouldFallbackFromBlobError(error)) {
        throw error;
      }
      disableBlobStore();
    }
  }

  const storeFile = ensureStoreFile();
  await fs.promises.writeFile(storeFile, JSON.stringify(mergeDefaults(store), null, 2));
}

async function updateStore(mutator) {
  writeChain = writeChain.then(async () => {
    const blobStore = getBlobStore();
    if (blobStore) {
      try {
        for (let attempt = 0; attempt < BLOB_WRITE_RETRIES; attempt++) {
          const existing = await blobStore.getWithMetadata(STORE_BLOB_KEY, {
            consistency: 'strong',
            type: 'json',
          });
          const store = mergeDefaults(existing?.data || defaultStore());
          const result = await mutator(store);
          const writeResult = existing
            ? await blobStore.setJSON(STORE_BLOB_KEY, store, { onlyIfMatch: existing.etag })
            : await blobStore.setJSON(STORE_BLOB_KEY, store, { onlyIfNew: true });

          if (writeResult.modified) {
            return result;
          }
        }

        throw new Error('Store write conflict. Please retry.');
      } catch (error) {
        if (!shouldFallbackFromBlobError(error)) {
          throw error;
        }
        disableBlobStore();
      }
    }

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
