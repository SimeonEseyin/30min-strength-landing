const { json } = require('./_response');
const { getPublicStoreError } = require('./_store');
const { getSession, publicUser } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let session;
  try {
    session = await getSession(event);
  } catch (error) {
    const publicError = getPublicStoreError(error);
    return json(publicError.statusCode || 500, { error: publicError.message || 'Session check failed.' });
  }

  if (!session) {
    return json(200, { user: null });
  }

  return json(200, {
    user: publicUser(session.user, true, session.expiresAt),
  });
};
