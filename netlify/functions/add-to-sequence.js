// Adds a new lead to a ConvertKit sequence after quiz completion.
// Required env vars:
//   CONVERTKIT_API_KEY  — your ConvertKit API key
//   CONVERTKIT_FORM_ID  — the form ID that triggers the welcome sequence

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let email, name, tags;
  try {
    ({ email, name, tags } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email) || email.length > 254) {
    return { statusCode: 400, body: 'Invalid email' };
  }

  const safeName = typeof name === 'string' ? name.replace(/[<>]/g, '').trim().slice(0, 100) : '';
  const safeTags = Array.isArray(tags) ? tags.filter(t => typeof t === 'string').slice(0, 10) : [];

  const API_KEY = process.env.CONVERTKIT_API_KEY;
  const FORM_ID = process.env.CONVERTKIT_FORM_ID;

  if (!API_KEY || !FORM_ID) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  try {
    const res = await fetch(`https://api.convertkit.com/v3/forms/${FORM_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: API_KEY,
        email,
        first_name: safeName,
        tags: safeTags,
      }),
    });

    const data = await res.json();
    return {
      statusCode: res.ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: res.ok, data }),
    };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ ok: false }) };
  }
};
