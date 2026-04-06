function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const eqIndex = entry.indexOf('=');
      if (eqIndex === -1) return acc;
      const key = entry.slice(0, eqIndex).trim();
      const value = entry.slice(eqIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
}

function getRequestOrigin(event) {
  const proto = event.headers?.['x-forwarded-proto'] || event.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event.headers?.['x-forwarded-host'] || event.headers?.['X-Forwarded-Host'] || event.headers?.host || event.headers?.Host;
  if (!host) return '';

  return `${proto}://${host}`;
}

function getTrustedOrigins(event) {
  return [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    getRequestOrigin(event),
  ].filter(Boolean);
}

function hasTrustedOrigin(event) {
  const trustedOrigins = getTrustedOrigins(event);
  if (trustedOrigins.length === 0) return true;

  const origin = event.headers?.origin || event.headers?.Origin || '';
  const referer = event.headers?.referer || event.headers?.Referer || '';

  if (origin) {
    return trustedOrigins.includes(origin);
  }

  if (referer) {
    try {
      return trustedOrigins.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  return true;
}

module.exports = {
  json,
  parseJsonBody,
  parseCookies,
  serializeCookie,
  getRequestOrigin,
  hasTrustedOrigin,
};
