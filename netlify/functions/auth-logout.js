const { json } = require('./_response');
const { destroySession } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const cookie = await destroySession(event);
  return json(200, { ok: true }, {
    'Set-Cookie': cookie,
  });
};
