const STRIPE_API_BASE = 'https://api.stripe.com/v1';

function getSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }
  return secretKey;
}

async function stripeRequest(path, { method = 'GET', form = null, query = null } = {}) {
  const secretKey = getSecretKey();
  const url = new URL(`${STRIPE_API_BASE}${path}`);

  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
  };

  let body;
  if (form) {
    const params = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = params.toString();
  }

  const response = await fetch(url, { method, headers, body });
  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Stripe request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function createCheckoutSession({ email, safeName, successUrl, cancelUrl, priceCents }) {
  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    form: {
      'payment_method_types[0]': 'card',
      customer_email: email,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': 'DevDad Strength — 30-Minute Strength System (Founding Member)',
      'line_items[0][price_data][unit_amount]': priceCents,
      'line_items[0][quantity]': 1,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      'metadata[name]': safeName,
    },
  });
}

async function retrieveCheckoutSession(sessionId) {
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

async function retrievePaymentIntent(paymentIntentId) {
  return stripeRequest(`/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    query: {
      'expand[0]': 'latest_charge',
    },
  });
}

async function listCheckoutSessions(limit = 100, startingAfter = null) {
  return stripeRequest('/checkout/sessions', {
    query: {
      limit,
      starting_after: startingAfter,
    },
  });
}

async function listCheckoutSessionsByEmail(email, limit = 100, maxPages = 10) {
  const normalizedEmail = String(email).toLowerCase();
  const matches = [];
  let startingAfter = null;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < maxPages) {
    const result = await listCheckoutSessions(limit, startingAfter);
    const batch = result.data || [];

    matches.push(
      ...batch.filter(session => {
        const sessionEmail = (session.customer_email || session.customer_details?.email || '').toLowerCase();
        return sessionEmail === normalizedEmail;
      })
    );

    hasMore = Boolean(result.has_more) && batch.length > 0;
    startingAfter = hasMore ? batch[batch.length - 1].id : null;
    page += 1;
  }

  return {
    data: matches,
    has_more: hasMore,
  };
}

module.exports = {
  createCheckoutSession,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  listCheckoutSessions,
  listCheckoutSessionsByEmail,
};
