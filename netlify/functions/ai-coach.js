const { json } = require('./_response');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  return json(403, {
    error: 'AI Coach is available on paid plans only.',
    code: 'paid_feature',
  });
};
