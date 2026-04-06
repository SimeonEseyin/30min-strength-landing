const { json, parseJsonBody, hasTrustedOrigin } = require('./_response');
const { getSession, validatePassword, verifyPassword, hashPassword, createSession } = require('./_auth');
const { updateStore } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!hasTrustedOrigin(event)) {
    return json(403, { error: 'Forbidden' });
  }

  const session = await getSession(event);
  if (!session) {
    return json(401, { error: 'Unauthorized' });
  }

  let currentPassword;
  let newPassword;
  let confirmNewPassword;

  try {
    ({ currentPassword, newPassword, confirmNewPassword } = parseJsonBody(event));
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    return json(400, { error: 'All fields required' });
  }

  const passwordError = validatePassword(String(newPassword || ''));
  if (passwordError) {
    return json(400, { error: passwordError });
  }

  if (newPassword !== confirmNewPassword) {
    return json(400, { error: 'New passwords do not match' });
  }

  const currentValid = await verifyPassword(
    String(currentPassword || ''),
    session.user.passwordSalt,
    session.user.passwordHash
  );

  if (!currentValid) {
    return json(401, { error: 'Current password is incorrect' });
  }

  const nextPassword = await hashPassword(String(newPassword || ''));
  await updateStore(store => {
    if (!store.users[session.email]) return;
    store.users[session.email].passwordHash = nextPassword.hash;
    store.users[session.email].passwordSalt = nextPassword.salt;
    store.users[session.email].updatedAt = new Date().toISOString();

    Object.entries(store.sessions).forEach(([sessionId, activeSession]) => {
      if ((activeSession?.email || '').toLowerCase() === session.email) {
        delete store.sessions[sessionId];
      }
    });
  });

  const nextSession = await createSession(session.email);
  return json(200, { ok: true, message: 'Password changed successfully!' }, {
    'Set-Cookie': nextSession.cookie,
  });
};
