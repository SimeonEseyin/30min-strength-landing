const { json } = require('./_response');
const { getSession, publicUser } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(200, { user: null });
  }

  return json(200, {
    user: publicUser(session.user, session.hasPurchased, session.expiresAt),
  });
};
