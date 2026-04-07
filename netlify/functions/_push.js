const crypto = require('crypto');

function getPublicKey() {
  return String(
    process.env.PUSH_VAPID_PUBLIC_KEY ||
    process.env.VAPID_PUBLIC_KEY ||
    ''
  ).trim();
}

function getPrivateKey() {
  return String(
    process.env.PUSH_VAPID_PRIVATE_KEY ||
    process.env.VAPID_PRIVATE_KEY ||
    ''
  ).trim();
}

function getSubject() {
  return String(process.env.PUSH_VAPID_SUBJECT || 'mailto:devdad.desk@gmail.com').trim();
}

function isConfigured() {
  return Boolean(getPublicKey() && getPrivateKey());
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function getKeyMaterial() {
  const publicKey = base64UrlDecode(getPublicKey());
  const privateKey = base64UrlDecode(getPrivateKey());

  if (publicKey.length !== 65 || publicKey[0] !== 0x04 || privateKey.length !== 32) {
    throw new Error('Invalid VAPID key format.');
  }

  return {
    publicKey,
    privateKey
  };
}

function getVapidPrivateKeyObject() {
  const { publicKey, privateKey } = getKeyMaterial();

  return crypto.createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(publicKey.subarray(1, 33)),
      y: base64UrlEncode(publicKey.subarray(33, 65)),
      d: base64UrlEncode(privateKey)
    },
    format: 'jwk'
  });
}

function createVapidJwt(audience) {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({
    typ: 'JWT',
    alg: 'ES256'
  })));
  const payload = base64UrlEncode(Buffer.from(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: getSubject()
  })));
  const unsignedToken = `${header}.${payload}`;

  const signature = crypto.sign('sha256', Buffer.from(unsignedToken), {
    key: getVapidPrivateKeyObject(),
    dsaEncoding: 'ieee-p1363'
  });

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function sendPushRequest(subscription, payload = null) {
  const endpoint = new URL(subscription.endpoint);
  const jwt = createVapidJwt(endpoint.origin);

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${getPublicKey()}`,
      TTL: '3600',
      Urgency: 'normal'
    },
    body: payload ? JSON.stringify(payload) : ''
  });
}

function buildReminderPayload(userData) {
  const week = Math.max(1, parseInt(userData?.progress?.currentWeek, 10) || 1);
  const day = Math.max(1, parseInt(userData?.progress?.currentDay, 10) || 1);

  return {
    title: 'Time for your 30-minute session',
    body: `Week ${week}, Day ${day} is ready. Open DevDad and get the work in.`,
    url: '/app',
    tag: 'devdad-daily-reminder',
    icon: '/icons/web-app-manifest-192x192.png',
    badge: '/icons/favicon-96x96.png'
  };
}

function buildTestPushPayload() {
  return {
    title: 'DevDad push is working',
    body: 'This is a server push test. Closed-app reminders are wired correctly on this device.',
    url: '/app',
    tag: 'devdad-test-push',
    icon: '/icons/web-app-manifest-192x192.png',
    badge: '/icons/favicon-96x96.png'
  };
}

module.exports = {
  getPublicKey,
  getSubject,
  isConfigured,
  sendPushRequest,
  buildReminderPayload,
  buildTestPushPayload,
};
