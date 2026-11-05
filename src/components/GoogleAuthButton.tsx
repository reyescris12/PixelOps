// components/GoogleAuthButton.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  connectSubscriptionAccount,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
} from '../services/LLMProviderService';
import { signInWithAuth0 } from '../services/Auth0Service';

export interface GoogleUserProfile {
  email: string;
  name: string;
  picture?: string;
  sub?: string;
}

/**
 * Initializes Google Identity Services (GIS) button and credential listener
 */
export function initGoogleAuth(
  onSuccess: (email: string, name: string) => void,
  customClientId?: string,
  containerId: string = 'google-auth-container'
) {
  if (typeof window === 'undefined' || !(window as any).google) return false;

  const clientId =
    customClientId?.trim() ||
    localStorage.getItem('pixelops_google_client_id')?.trim() ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID) ||
    '';

  if (!clientId) {
    return false;
  }

  try {
    (window as any).google.accounts.id.initialize({
      client_id: clientId,
      callback: (response: any) => {
        try {
          if (!response?.credential) return;
          // Decode JWT credential payload
          const base64Url = response.credential.split('.')[1];
          const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = decodeURIComponent(
            atob(base64)
              .split('')
              .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
              .join('')
          );
          const profile: GoogleUserProfile = JSON.parse(jsonPayload);

          // Store real user info in localStorage / app state
          if (profile.email) {
            localStorage.setItem('pixelops_user_email', profile.email);
          }
          if (profile.name) {
            localStorage.setItem('pixelops_user_name', profile.name);
          }
          if (profile.picture) {
            localStorage.setItem('pixelops_user_avatar', profile.picture);
          }

          // Connect subscription account in LLM provider service
          try {
            connectSubscriptionAccount({
              providerId: 'gemini',
              planType: 'google_ai_pro',
              planName: 'Google AI Pro Plan (Gemini Advanced)',
              planTier: 'pro',
              email: profile.email,
              displayName: profile.name,
              avatarUrl: profile.picture,
              accessToken: response.credential,
              idToken: response.credential,
              status: 'connected',
              connectedAt: new Date().toISOString(),
            });

            const existingKey =
              localStorage.getItem('pixelops_gemini_api_key') ||
              localStorage.getItem('gemini_api_key') ||
              localStorage.getItem('apiKey');
            if (existingKey && existingKey.trim()) {
              const current = loadLLMProviderConfig();
              saveLLMProviderConfig({
                ...current,
                authMode: 'subscription',
                apiKey: existingKey.trim(),
              });
            }
          } catch (connErr) {
            console.warn('[GoogleAuthButton] connectSubscriptionAccount error:', connErr);
          }

          onSuccess(profile.email, profile.name);
        } catch (decodeErr) {
          console.error('[GoogleAuthButton] JWT decode failed:', decodeErr);
        }
      },
    });

    const targetEl = document.getElementById(containerId);
    if (targetEl) {
      targetEl.innerHTML = '';
      (window as any).google.accounts.id.renderButton(targetEl, {
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: 'signin_with',
        width: 280,
      });
      return true;
    }
  } catch (err) {
    console.warn('[GoogleAuthButton] GIS render error:', err);
  }

  return false;
}

export interface GoogleAuthButtonProps {
  onSuccess: (email: string, name: string) => void;
  clientId?: string;
  className?: string;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  onSuccess,
  clientId,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const uniqueId = useRef(`google-auth-container-${Math.random().toString(36).substring(2, 8)}`);

  useEffect(() => {
    let interval: any = null;
    let attempts = 0;

    const tryRender = () => {
      attempts++;
      if ((window as any).google?.accounts?.id && containerRef.current) {
        const ok = initGoogleAuth(onSuccess, clientId, uniqueId.current);
        if (ok) {
          setRendered(true);
          if (interval) clearInterval(interval);
          return;
        }
      }
      if (attempts > 15 && interval) {
        clearInterval(interval);
      }
    };

    tryRender();
    if (!rendered && clientId) {
      interval = setInterval(tryRender, 400);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [clientId, onSuccess, rendered]);

  const handleAuth0GoogleLogin = async () => {
    setIsSigningIn(true);
    try {
      const res = await signInWithAuth0({
        connection: 'google-oauth2',
        providerId: 'gemini',
      });
      if (res.ok && res.account) {
        onSuccess(res.account.email, res.account.displayName || res.account.email);
      } else if (res.error && !res.error.includes('cancelled')) {
        alert(res.error);
      }
    } catch (err: any) {
      console.warn('[GoogleAuthButton] Auth0 Sign-In caught error:', err);
      if (!err?.message?.includes('cancelled')) {
        alert(err?.message || 'Google Sign-In failed.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className={`flex flex-col items-center justify-center w-full ${className}`}>
      {/* If GIS renders successfully, show GIS button */}
      <div
        id={uniqueId.current}
        ref={containerRef}
        className={rendered ? 'flex items-center justify-center min-h-[40px] w-full' : 'hidden'}
      />

      {/* Auth0 Powered Google Sign-In Button (default & robust) */}
      {!rendered && (
        <button
          type="button"
          onClick={handleAuth0GoogleLogin}
          disabled={isSigningIn}
          className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#1e2230] hover:bg-[#282d40] border border-slate-700 hover:border-cyan-500/60 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span className="truncate">
            {isSigningIn ? 'Authenticating with Google via Auth0...' : 'Sign in with Google (Auth0)'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono-tabular">
            AUTH0
          </span>
        </button>
      )}
    </div>
  );
};

export default GoogleAuthButton;
