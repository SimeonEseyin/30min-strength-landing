const { json } = require('./_response');
const { getSession } = require('./_auth');
const { readStore, getUserData } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  const store = await readStore();
  return json(200, {
    data: getUserData(store, session.email),
  });
};
