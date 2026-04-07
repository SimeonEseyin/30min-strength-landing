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

async function sendPushRequest(subscription) {
  const endpoint = new URL(subscription.endpoint);
  const jwt = createVapidJwt(endpoint.origin);

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${getPublicKey()}`,
      TTL: '3600',
      Urgency: 'normal'
    },
    body: ''
  });
}

module.exports = {
  getPublicKey,
  getSubject,
  isConfigured,
  sendPushRequest,
};
