// ─────────────────────────────────────────────────────────────────────────
//  PrintShop Pro — API Client  (js/api.js)
//  Drop-in replacement for google.script.run — works on Vercel via fetch.
// ─────────────────────────────────────────────────────────────────────────

// ── Config guard — show visible banner if URL not set ─────────────────────
(function checkConfig() {
  // Wait for DOM to load so we can show a banner
  const check = () => {
    const url = window.GAS_API_URL;
    if (!url || url.includes('YOUR_DEPLOYMENT_ID')) {
      const b = document.createElement('div');
      b.id = 'api-config-banner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;' +
        'padding:14px 20px;font-size:14px;font-weight:600;text-align:center;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.4)';
      b.textContent = '⚠️ GAS_API_URL not configured — open js/config.js and paste your Google Apps Script Web App URL';
      document.body.prepend(b);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check);
  else check();
})();

// ── Core fetch wrapper ────────────────────────────────────────────────────
const API_TIMEOUT_MS = 30000; // 30 seconds — GAS can be slow on cold start

async function callAPI(action, args = []) {
  const url = window.GAS_API_URL;
  if (!url || url.includes('YOUR_DEPLOYMENT_ID')) {
    throw new Error('GAS_API_URL not configured. Open js/config.js and paste your Web App URL.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    // text/plain body → CORS "simple" request → no preflight OPTIONS needed
    const response = await fetch(url, {
      method   : 'POST',
      mode     : 'cors',
      redirect : 'follow',
      signal   : controller.signal,
      body     : JSON.stringify({ action, args })
      // No Content-Type header → browser sends 'text/plain;charset=UTF-8'
    });

    if (!response.ok) throw new Error('HTTP ' + response.status + ' from GAS API');
    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out (30s). GAS may be starting up — please retry.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── google.script.run shim ────────────────────────────────────────────────
// `get run` getter creates a fresh context per chain — handles concurrent calls.
window.google = {
  script: {
    get run() {
      const ctx = { onSuccess: () => {}, onFailure: () => {} };

      const proxy = new Proxy({}, {
        get(_, method) {
          // FIXED: ignore Symbol property accesses (devtools, browser internals)
          // Without this guard, Symbol.toPrimitive etc. would trigger API calls
          if (typeof method === 'symbol') return undefined;

          if (method === 'withSuccessHandler') return fn => { ctx.onSuccess = fn; return proxy; };
          if (method === 'withFailureHandler') return fn => { ctx.onFailure = fn; return proxy; };

          // Any other string property = GAS function name to invoke
          return (...args) => {
            callAPI(method, args)
              .then(result => ctx.onSuccess(result))
              .catch(error  => ctx.onFailure({ message: String(error) }));
          };
        }
      });

      return proxy;
    }
  }
};
