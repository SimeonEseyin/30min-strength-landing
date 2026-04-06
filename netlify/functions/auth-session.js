const { json } = require('./_response');
const { getSession, publicUser } = require('./_auth');
const { restoreStripeEntitlementByEmail } = require('./_entitlements');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method Not Allowed' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(200, { user: null });
  }

  let hasPurchased = session.hasPurchased;
  if (!hasPurchased) {
    try {
      hasPurchased = await restoreStripeEntitlementByEmail(session.email);
    } catch {
      hasPurchased = false;
    }
  }

  return json(200, {
    user: publicUser(session.user, hasPurchased, session.expiresAt),
  });
};
