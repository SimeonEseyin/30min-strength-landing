(function initializeDevDadAnalytics() {
  const VISITOR_KEY = 'devdad_analytics_id';
  const ATTRIBUTION_KEY = 'devdad_attribution';

  function getVisitorId() {
    try {
      let visitorId = localStorage.getItem(VISITOR_KEY);
      if (!visitorId) {
        visitorId = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(VISITOR_KEY, visitorId);
      }
      return visitorId;
    } catch {
      return `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
  }

  function captureAttribution() {
    try {
      const existing = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY) || 'null');
      if (existing) return existing;

      const params = new URLSearchParams(location.search);
      let referrerHost = '';
      try {
        referrerHost = document.referrer ? new URL(document.referrer).hostname : '';
      } catch {
        referrerHost = '';
      }

      const attribution = {
        source: params.get('utm_source') || '',
        medium: params.get('utm_medium') || '',
        campaign: params.get('utm_campaign') || '',
        content: params.get('utm_content') || '',
        term: params.get('utm_term') || '',
        referrerHost,
        landingPath: `${location.pathname}${location.search}`.slice(0, 160),
      };
      localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
      return attribution;
    } catch {
      return {};
    }
  }

  function track(eventName) {
    const payload = {
      eventName,
      visitorId: getVisitorId(),
      path: location.pathname,
      attribution: captureAttribution(),
    };

    return fetch('/.netlify/functions/track-event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => null);
  }

  function getContext() {
    return {
      visitorId: getVisitorId(),
      path: location.pathname,
      attribution: captureAttribution(),
    };
  }

  window.DevDadAnalytics = { track, getContext };
})();
