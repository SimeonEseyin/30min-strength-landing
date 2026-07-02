const { json } = require('./_response');
const { getSession } = require('./_auth');
const { readStoreEntry, getUserData } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  const storedUserData = await readStoreEntry('userData', session.email);
  const store = { userData: { [session.email]: storedUserData || {} } };
  return json(200, {
    data: getUserData(store, session.email),
  });
};
