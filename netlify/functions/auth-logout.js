const { json, hasTrustedOrigin } = require('./_response');
const { destroySession } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  const cookie = await destroySession(event);
  return json(200, { ok: true }, {
    'Set-Cookie': cookie,
  });
};
