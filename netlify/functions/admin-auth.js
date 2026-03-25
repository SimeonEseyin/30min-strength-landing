const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let token;
  try {
    ({ token } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  if (!token || typeof token !== 'string') {
    return { statusCode: 401, body: JSON.stringify({ ok: false }) };
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return { statusCode: 503, body: JSON.stringify({ ok: false }) };
  }

  // Timing-safe comparison to prevent timing attacks
  const provided = Buffer.from(token.padEnd(128).slice(0, 128));
  const expected = Buffer.from(adminToken.padEnd(128).slice(0, 128));

  const match =
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected) &&
    token === adminToken;

  if (match) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }

  return {
    statusCode: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: false }),
  };
};
