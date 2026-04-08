const crypto = require('crypto');

const AES128GCM_RECORD_SIZE = 4096;
const MAX_PAYLOAD_SIZE = 3993;

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

function hkdfExtract(salt, inputKeyMaterial) {
  return crypto.createHmac('sha256', salt).update(inputKeyMaterial).digest();
}

function hkdfExpand(pseudoRandomKey, info, length) {
  const buffers = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(buffers).length < length) {
    previous = crypto.createHmac('sha256', pseudoRandomKey)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    buffers.push(previous);
    counter += 1;
  }

  return Buffer.concat(buffers).subarray(0, length);
}

function normalizePayload(payload) {
  if (payload == null) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function encryptPushPayload(subscription, payloadBuffer) {
  const clientPublicKey = base64UrlDecode(subscription?.keys?.p256dh || '');
  const authSecret = base64UrlDecode(subscription?.keys?.auth || '');

  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 0x04) {
    throw new Error('Invalid push subscription public key.');
  }

  if (authSecret.length < 16) {
    throw new Error('Invalid push subscription auth secret.');
  }

  if (payloadBuffer.length > MAX_PAYLOAD_SIZE) {
    throw new Error('Push payload is too large.');
  }

  const localKey = crypto.createECDH('prime256v1');
  const localPublicKey = localKey.generateKeys();
  const sharedSecret = localKey.computeSecret(clientPublicKey);

  const ikm = hkdfExpand(
    hkdfExtract(authSecret, sharedSecret),
    Buffer.concat([
      Buffer.from('WebPush: info\0', 'utf8'),
      clientPublicKey,
      localPublicKey
    ]),
    32
  );

  const salt = crypto.randomBytes(16);
  const pseudoRandomKey = hkdfExtract(salt, ikm);
  const contentEncryptionKey = hkdfExpand(
    pseudoRandomKey,
    Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'),
    16
  );
  const nonce = hkdfExpand(
    pseudoRandomKey,
    Buffer.from('Content-Encoding: nonce\0', 'utf8'),
    12
  );

  const plaintext = Buffer.concat([payloadBuffer, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const recordSizeBuffer = Buffer.alloc(4);
  recordSizeBuffer.writeUInt32BE(AES128GCM_RECORD_SIZE, 0);

  return {
    body: Buffer.concat([
      salt,
      recordSizeBuffer,
      Buffer.from([localPublicKey.length]),
      localPublicKey,
      ciphertext
    ]),
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream'
    }
  };
}

async function sendPushRequest(subscription, payload = null, options = {}) {
  const endpoint = new URL(subscription.endpoint);
  const jwt = createVapidJwt(endpoint.origin);
  const payloadBuffer = normalizePayload(payload);
  const encryptedPayload = payloadBuffer ? encryptPushPayload(subscription, payloadBuffer) : null;

  const headers = {
    Authorization: `vapid t=${jwt}, k=${getPublicKey()}`,
    TTL: String(options.ttl || 3600),
    Urgency: options.urgency || 'normal',
    ...(encryptedPayload ? encryptedPayload.headers : {})
  };

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body: encryptedPayload ? encryptedPayload.body : ''
  });
}

module.exports = {
  getPublicKey,
  getSubject,
  isConfigured,
  sendPushRequest,
};
