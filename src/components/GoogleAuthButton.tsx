// components/GoogleAuthButton.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  connectSubscriptionAccount,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
} from '../services/LLMProviderService';

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

            // If user already has a BYOK Gemini API key, keep authMode on 'apikey'
            // so the GIS login does not block or conflict with direct API key inference
            const existingKey =
              localStorage.getItem('pixelops_gemini_api_key') ||
              localStorage.getItem('gemini_api_key') ||
              localStorage.getItem('apiKey');
            if (existingKey && existingKey.trim()) {
              const current = loadLLMProviderConfig();
              saveLLMProviderConfig({
                ...current,
                authMode: 'apikey',
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
      if (attempts > 30 && interval) {
        clearInterval(interval);
      }
    };

    tryRender();
    if (!rendered) {
      interval = setInterval(tryRender, 400);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [clientId, onSuccess, rendered]);

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        id={uniqueId.current}
        ref={containerRef}
        className="flex items-center justify-center min-h-[40px] w-full"
      />
      {!rendered && (
        <div id="google-auth-container" className="hidden" />
      )}
    </div>
  );
};

export default GoogleAuthButton;
