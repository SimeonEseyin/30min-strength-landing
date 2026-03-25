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

  const API_KEY = process.env.CONVERTKIT_API_KEY;
  const FORM_ID = process.env.CONVERTKIT_FORM_ID;

  if (!API_KEY || !FORM_ID) {
    // Not configured yet — log and succeed silently so the quiz flow isn't blocked
    console.warn('ConvertKit env vars not set. Skipping sequence enrollment.');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  }

  try {
    const res = await fetch(`https://api.convertkit.com/v3/forms/${FORM_ID}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: API_KEY,
        email,
        first_name: name || '',
        tags: Array.isArray(tags) ? tags : [],
      }),
    });

    const data = await res.json();
    return {
      statusCode: res.ok ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: res.ok, data }),
    };
  } catch (err) {
    console.error('ConvertKit error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
