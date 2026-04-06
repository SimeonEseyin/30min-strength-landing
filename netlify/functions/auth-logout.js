const { json, hasTrustedOrigin } = require('./_response');
const { getPublicStoreError } = require('./_store');
const { destroySession } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  let cookie;
  try {
    cookie = await destroySession(event);
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Logout failed. Please try again.' });
  }

  return json(200, { ok: true }, {
    'Set-Cookie': cookie,
  });
};
