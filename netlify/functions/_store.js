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
const ENTITY_STORE_PREFIX = 'v2/entities/';
const ENTITY_STORE_MARKER = 'v2/migrated';
const STORE_COLLECTIONS = [
  'users',
  'entitlements',
  'sessions',
  'userData',
  'pushSubscriptions',
  'passwordResets',
  'emailVerifications',
  'rateLimits',
  'premiumInterests',
  'analyticsActors',
];

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

function canUseLocalFileStore() {
  return !isServerlessRuntime() || Boolean(process.env.DEVDAD_DATA_DIR);
}

function getManualBlobConfig() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.BLOBS_SITE_ID || process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;

  if (!siteID || !token) {
    return null;
  }

  return { siteID, token };
}

function createBlobStore() {
  if (!canUseNetlifyBlobs()) {
    return null;
  }

  try {
    const manualBlobConfig = getManualBlobConfig();
    return getStore({
      name: STORE_NAMESPACE,
      consistency: 'strong',
      ...(manualBlobConfig || {}),
    });
  } catch (error) {
    if (canUseLocalFileStore() && shouldFallbackFromBlobError(error)) {
      return null;
    }
    throw error;
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
      lastWorkoutStartedAt: null,
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
      darkMode: true,
      notificationEnabled: false,
      notificationTimezone: 'UTC',
      notificationTime: '07:00',
    },
    profile: {
      currentWeight: '',
      height: '',
      weightHistory: [],
      avatarDataUrl: '',
    },
    weights: {},
    coachCache: {
      coach: null,
      snapshot: '',
      updatedAt: null,
    },
    planConfig: {
      focus: 'Build strength',
      sessionLength: 30,
      trainingEnvironment: 'Home only',
      availableEquipment: ['Dumbbells'],
      recoveryMode: 'normal',
      scheduleTemplate: '3-day',
      seededFromQuiz: false,
      lastAdjustedAt: null,
    },
    intake: {
      source: '',
      capturedAt: null,
      seededAt: null,
      quizAnswers: null,
      preview: null,
    },
    notificationHistory: {
      firstWorkout: {
        lastSentAt: null,
        lastSentLocalDate: null,
      },
      incompleteWorkout: {
        lastSentAt: null,
        lastSentLocalDate: null,
        lastStartedAt: null,
      },
      inactive: {
        lastSentAt: null,
        lastSentLocalDate: null,
        lastCompletedAt: null,
      },
      weeklyCatchup: {
        lastSentAt: null,
        lastSentLocalDate: null,
        lastWeekKey: null,
      },
    },
    updatedAt: null,
  };
}

function defaultStore() {
  return {
    users: {},
    entitlements: {},
    sessions: {},
    userData: {},
    pushSubscriptions: {},
    passwordResets: {},
    emailVerifications: {},
    rateLimits: {},
    premiumInterests: {},
    analyticsActors: {},
  };
}

function isRecoverableStoreError(error) {
  return Boolean(error && ['ENOENT', 'EACCES', 'EPERM', 'EROFS'].includes(error.code));
}

function shouldFallbackFromBlobError(error) {
  if (!error) return false;
  return Boolean(
    error.name === 'MissingBlobsEnvironmentError' ||
    error.code === 'FORBIDDEN' ||
    error.status === 401 ||
    error.status === 403
  );
}

function getPersistentStoreError() {
  const error = new Error('Persistent auth store is unavailable in the serverless runtime.');
  error.statusCode = 503;
  return error;
}

function getPublicStoreError(error, fallbackMessage = 'Authentication is temporarily unavailable. Please try again in a moment.') {
  if (error?.statusCode === 503 || error?.name === 'MissingBlobsEnvironmentError') {
    const publicError = new Error(fallbackMessage);
    publicError.statusCode = 503;
    return publicError;
  }

  return error;
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
  if (!merged.pushSubscriptions || typeof merged.pushSubscriptions !== 'object') merged.pushSubscriptions = {};
  if (!merged.passwordResets || typeof merged.passwordResets !== 'object') merged.passwordResets = {};
  if (!merged.emailVerifications || typeof merged.emailVerifications !== 'object') merged.emailVerifications = {};
  if (!merged.rateLimits || typeof merged.rateLimits !== 'object') merged.rateLimits = {};
  if (!merged.premiumInterests || typeof merged.premiumInterests !== 'object') merged.premiumInterests = {};
  if (!merged.analyticsActors || typeof merged.analyticsActors !== 'object') merged.analyticsActors = {};

  return merged;
}

function encodeStoreKey(value) {
  return Buffer.from(String(value), 'utf8').toString('base64url');
}

function decodeStoreKey(value) {
  return Buffer.from(String(value), 'base64url').toString('utf8');
}

function getEntityBlobKey(collection, key) {
  return `${ENTITY_STORE_PREFIX}${collection}/${encodeStoreKey(key)}`;
}

async function hasEntityStore(blobStore) {
  return Boolean(await blobStore.get(ENTITY_STORE_MARKER, { consistency: 'strong' }));
}

async function listAllEntityBlobs(blobStore) {
  const blobs = [];
  for await (const page of blobStore.list({ prefix: ENTITY_STORE_PREFIX, paginate: true })) {
    blobs.push(...page.blobs);
  }
  return blobs;
}

async function readEntityStore(blobStore) {
  if (!(await hasEntityStore(blobStore))) {
    const legacyStore = await blobStore.get(STORE_BLOB_KEY, {
      type: 'json',
      consistency: 'strong',
    });
    return { store: mergeDefaults(legacyStore || defaultStore()), migrated: false };
  }

  const store = defaultStore();
  const blobs = await listAllEntityBlobs(blobStore);
  await Promise.all(blobs.map(async ({ key: blobKey }) => {
    const relativeKey = blobKey.slice(ENTITY_STORE_PREFIX.length);
    const separator = relativeKey.indexOf('/');
    if (separator === -1) return;

    const collection = relativeKey.slice(0, separator);
    if (!STORE_COLLECTIONS.includes(collection)) return;

    const encodedKey = relativeKey.slice(separator + 1);
    const value = await blobStore.get(blobKey, { type: 'json', consistency: 'strong' });
    if (value !== null && value !== undefined) {
      store[collection][decodeStoreKey(encodedKey)] = value;
    }
  }));

  return { store: mergeDefaults(store), migrated: true };
}

function valuesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function persistEntityChanges(blobStore, previousStore, nextStore, writeEverything = false) {
  const writes = [];

  for (const collection of STORE_COLLECTIONS) {
    const previous = previousStore[collection] || {};
    const next = nextStore[collection] || {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

    for (const key of keys) {
      const blobKey = getEntityBlobKey(collection, key);
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        writes.push(blobStore.delete(blobKey));
      } else if (writeEverything || !valuesMatch(previous[key], next[key])) {
        writes.push(blobStore.setJSON(blobKey, next[key]));
      }
    }
  }

  await Promise.all(writes);
  if (writeEverything) {
    await blobStore.set(ENTITY_STORE_MARKER, new Date().toISOString());
  }
}

async function readStore() {
  const blobStore = getBlobStore();
  if (blobStore) {
    try {
      const { store } = await readEntityStore(blobStore);
      return store;
    } catch (error) {
      if (isRecoverableStoreError(error)) {
        return mergeDefaults(defaultStore());
      }
      if (canUseLocalFileStore() && shouldFallbackFromBlobError(error)) {
        disableBlobStore();
      } else {
        throw error;
      }
    }
  }

  if (!canUseLocalFileStore()) {
    throw getPersistentStoreError();
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
      if (!canUseLocalFileStore() || !shouldFallbackFromBlobError(error)) {
        throw error;
      }
      disableBlobStore();
    }
  }

  if (!canUseLocalFileStore()) {
    throw getPersistentStoreError();
  }

  const storeFile = ensureStoreFile();
  const temporaryFile = `${storeFile}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryFile, JSON.stringify(mergeDefaults(store), null, 2));
  await fs.promises.rename(temporaryFile, storeFile);
}

async function updateStore(mutator) {
  const operation = writeChain.catch(() => {}).then(async () => {
    const blobStore = getBlobStore();
    if (blobStore) {
      try {
        const { store, migrated } = await readEntityStore(blobStore);
        const previousStore = structuredClone(store);
        const result = await mutator(store);
        await persistEntityChanges(blobStore, previousStore, mergeDefaults(store), !migrated);
        return result;
      } catch (error) {
        if (!canUseLocalFileStore() || !shouldFallbackFromBlobError(error)) {
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
  writeChain = operation.catch(() => {});
  return operation;
}

function assertStoreCollection(collection) {
  if (!STORE_COLLECTIONS.includes(collection)) {
    throw new Error(`Unknown store collection: ${collection}`);
  }
}

async function readStoreEntry(collection, key) {
  assertStoreCollection(collection);
  const normalizedKey = String(key);
  const blobStore = getBlobStore();

  if (blobStore) {
    try {
      if (await hasEntityStore(blobStore)) {
        return await blobStore.get(getEntityBlobKey(collection, normalizedKey), {
          type: 'json',
          consistency: 'strong',
        });
      }
    } catch (error) {
      if (!canUseLocalFileStore() || !shouldFallbackFromBlobError(error)) throw error;
      disableBlobStore();
    }
  }

  const store = await readStore();
  return store[collection][normalizedKey] ?? null;
}

async function updateStoreEntry(collection, key, mutator) {
  assertStoreCollection(collection);
  const normalizedKey = String(key);
  const blobStore = getBlobStore();

  if (blobStore) {
    try {
      if (await hasEntityStore(blobStore)) {
        const blobKey = getEntityBlobKey(collection, normalizedKey);
        const existing = await blobStore.get(blobKey, { type: 'json', consistency: 'strong' });
        const next = await mutator(existing ?? null);
        if (next === null || next === undefined) await blobStore.delete(blobKey);
        else await blobStore.setJSON(blobKey, next);
        return next;
      }
    } catch (error) {
      if (!canUseLocalFileStore() || !shouldFallbackFromBlobError(error)) throw error;
      disableBlobStore();
    }
  }

  return updateStore(store => {
    const existing = store[collection][normalizedKey] ?? null;
    const next = mutator(existing);
    if (next && typeof next.then === 'function') {
      return next.then(resolved => {
        if (resolved === null || resolved === undefined) delete store[collection][normalizedKey];
        else store[collection][normalizedKey] = resolved;
        return resolved;
      });
    }
    if (next === null || next === undefined) delete store[collection][normalizedKey];
    else store[collection][normalizedKey] = next;
    return next;
  });
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
    coachCache: {
      ...defaultUserData().coachCache,
      ...((store.userData[normalizedEmail] || {}).coachCache || {}),
    },
    planConfig: {
      ...defaultUserData().planConfig,
      ...((store.userData[normalizedEmail] || {}).planConfig || {}),
      availableEquipment: Array.isArray(((store.userData[normalizedEmail] || {}).planConfig || {}).availableEquipment)
        ? ((store.userData[normalizedEmail] || {}).planConfig || {}).availableEquipment
        : defaultUserData().planConfig.availableEquipment,
    },
    intake: {
      ...defaultUserData().intake,
      ...((store.userData[normalizedEmail] || {}).intake || {}),
    },
    notificationHistory: {
      ...defaultUserData().notificationHistory,
      ...((store.userData[normalizedEmail] || {}).notificationHistory || {}),
      firstWorkout: {
        ...defaultUserData().notificationHistory.firstWorkout,
        ...((((store.userData[normalizedEmail] || {}).notificationHistory || {}).firstWorkout) || {}),
      },
      incompleteWorkout: {
        ...defaultUserData().notificationHistory.incompleteWorkout,
        ...((((store.userData[normalizedEmail] || {}).notificationHistory || {}).incompleteWorkout) || {}),
      },
      inactive: {
        ...defaultUserData().notificationHistory.inactive,
        ...((((store.userData[normalizedEmail] || {}).notificationHistory || {}).inactive) || {}),
      },
      weeklyCatchup: {
        ...defaultUserData().notificationHistory.weeklyCatchup,
        ...((((store.userData[normalizedEmail] || {}).notificationHistory || {}).weeklyCatchup) || {}),
      },
    },
  };
}

module.exports = {
  defaultUserData,
  getPublicStoreError,
  normalizeEmail,
  readStore,
  updateStore,
  readStoreEntry,
  updateStoreEntry,
  getUserData,
};
