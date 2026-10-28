import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Handle OAuth popup redirect when provider returns to the root URL
if (typeof window !== 'undefined' && window.opener && window.opener !== window) {
  const search = window.location.search || '';
  const hash = window.location.hash || '';
  const isOAuthReturn =
    search.includes('code=') ||
    search.includes('connected_account_id=') ||
    search.includes('status=') ||
    search.includes('composio') ||
    hash.includes('access_token=') ||
    hash.includes('code=');

  if (isOAuthReturn) {
    try {
      const searchParams = new URLSearchParams(search);
      const paramsObj: Record<string, string> = {};
      searchParams.forEach((val, key) => {
        paramsObj[key] = val;
      });

      const payload = {
        type: 'COMPOSIO_AUTH_SUCCESS',
        composioAuthSuccess: true,
        status: 'SUCCESS',
        url: window.location.href,
        params: paramsObj,
        timestamp: Date.now(),
      };

      // 1. Post directly to opener
      window.opener.postMessage(payload, '*');

      // 2. BroadcastChannel
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel('pixelops_composio_oauth');
        bc.postMessage(payload);
        bc.close();
      }

      // 3. LocalStorage
      try {
        localStorage.setItem('pixelops_last_oauth_sync', JSON.stringify(payload));
      } catch {}
    } catch {}

    // Replace document content with closing screen and close popup
    document.body.innerHTML = `
      <div style="background-color:#0c0d12;color:#4ade80;font-family:monospace;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;text-align:center;">
        <div style="background:#141620;border:1px solid #363d54;border-radius:4px;padding:24px;max-width:440px;box-shadow:0 0 25px rgba(74,222,128,0.2);">
          <div style="color:#f3ead8;font-weight:bold;margin-bottom:8px;">[OAUTH HANDSHAKE VERIFIED]</div>
          <div style="color:#94a3b8;font-size:12px;margin-bottom:12px;">Transmitting credentials to Command Center...</div>
          <div style="color:#e59838;font-size:11px;">Closing popup window...</div>
        </div>
      </div>
    `;

    setTimeout(() => {
      try {
        window.close();
      } catch {}
    }, 500);

    // Stop execution so React does NOT boot a second app instance
    throw new Error('OAUTH_POPUP_REDIRECT_HANDLED: Window closing.');
  }
}

createRoot(document.getElementById('root')!).render(<App />);
