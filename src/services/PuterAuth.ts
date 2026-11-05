/**
 * src/services/PuterAuth.ts
 * Puter.js 1-Click Zero-Key AI Authentication & Multi-Model Inference Service
 * Connects users to Puter.js (https://js.puter.com/v2/) for zero-setup, zero-key AI
 * inference across Google Gemini, Claude, OpenAI, and DeepSeek models.
 */

declare global {
  interface Window {
    puter?: any;
  }
}

export interface PuterUser {
  username?: string;
  email?: string;
  uuid?: string;
}

export interface PuterModelOption {
  id: string;
  name: string;
  tag: 'ZERO_KEY';
  context: string;
}

export const PUTER_SUPPORTED_MODELS: PuterModelOption[] = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    tag: 'ZERO_KEY',
    context: 'Fast multimodal zero-key inference',
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    tag: 'ZERO_KEY',
    context: 'Top-tier reasoning & coding via Puter',
  },
  {
    id: 'gpt-4o',
    name: 'OpenAI GPT-4o',
    tag: 'ZERO_KEY',
    context: 'Flagship multimodal intelligence via Puter',
  },
  {
    id: 'gpt-4o-mini',
    name: 'OpenAI GPT-4o Mini',
    tag: 'ZERO_KEY',
    context: 'Ultra-fast lightweight reasoning',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    tag: 'ZERO_KEY',
    context: 'Deep chain-of-thought open reasoning',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    tag: 'ZERO_KEY',
    context: 'High-throughput conversational AI',
  },
];

let puterLoadPromise: Promise<any> | null = null;

/**
 * Ensures the Puter.js SDK is loaded and available on window.puter
 */
export async function ensurePuterLoaded(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('Puter.js requires a browser environment.');
  }

  if (window.puter && window.puter.ai && window.puter.auth) {
    return window.puter;
  }

  if (puterLoadPromise) {
    return puterLoadPromise;
  }

  puterLoadPromise = new Promise((resolve, reject) => {
    // If script tag already exists
    const existing = document.querySelector('script[src*="js.puter.com"]');
    if (existing && window.puter) {
      resolve(window.puter);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;

    const timeout = setTimeout(() => {
      reject(new Error('Puter.js SDK script load timed out. Check network connection.'));
    }, 15000);

    script.onload = () => {
      clearTimeout(timeout);
      if (window.puter) {
        resolve(window.puter);
      } else {
        reject(new Error('Puter.js loaded but window.puter is undefined.'));
      }
    };

    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Failed to load Puter.js script from https://js.puter.com/v2/'));
    };

    document.head.appendChild(script);
  });

  return puterLoadPromise;
}

/**
 * Checks whether Puter.js is currently signed in
 */
export async function isPuterSignedIn(): Promise<boolean> {
  try {
    const puter = await ensurePuterLoaded();
    const signedIn = Boolean(puter.auth?.isSignedIn?.());
    if (signedIn) {
      localStorage.setItem('pixelops_puter_signed_in', 'true');
    }
    return signedIn;
  } catch {
    return localStorage.getItem('pixelops_ai_sso_mode') === 'puter';
  }
}

/**
 * Retrieves the current Puter authenticated user profile
 */
export async function getPuterUser(): Promise<PuterUser | null> {
  try {
    const puter = await ensurePuterLoaded();
    if (puter.auth?.isSignedIn?.()) {
      const user = await puter.auth.getUser();
      if (user) {
        if (user.username) {
          localStorage.setItem('pixelops_puter_username', user.username);
        }
        return user;
      }
    }
    return null;
  } catch {
    const cachedName = localStorage.getItem('pixelops_puter_username');
    return cachedName ? { username: cachedName } : null;
  }
}

/**
 * Checks whether Puter SSO is the active AI mode
 */
export function isPuterActive(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem('pixelops_ai_sso_mode') === 'puter';
}

/**
 * Sets Puter as the active AI SSO mode
 */
export function setPuterActive(active: boolean = true): void {
  if (typeof localStorage === 'undefined') return;
  if (active) {
    localStorage.setItem('pixelops_ai_sso_mode', 'puter');
  } else if (localStorage.getItem('pixelops_ai_sso_mode') === 'puter') {
    localStorage.removeItem('pixelops_ai_sso_mode');
  }
  window.dispatchEvent(new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: active ? 'puter' : null } }));
}

/**
 * 1-Click Puter Authentication
 * Opens Puter auth dialog, saves state, and sets Puter as active SSO provider
 */
export async function signInWithPuter(): Promise<{ ok: boolean; user?: PuterUser; error?: string }> {
  try {
    const puter = await ensurePuterLoaded();
    const user = await puter.auth.signIn();
    if (user) {
      localStorage.setItem('pixelops_ai_sso_mode', 'puter');
      localStorage.setItem('pixelops_puter_signed_in', 'true');
      if (user.username) {
        localStorage.setItem('pixelops_puter_username', user.username);
      }
      window.dispatchEvent(
        new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: 'puter', user } })
      );
      return { ok: true, user };
    }
    return { ok: false, error: 'Sign-in window closed or returned no user.' };
  } catch (err: any) {
    console.error('[PuterAuth] signInWithPuter error:', err);
    return { ok: false, error: err?.message || 'Puter 1-click authentication failed.' };
  }
}

/**
 * Signs out of Puter.js
 */
export async function signOutPuter(): Promise<void> {
  try {
    const puter = await ensurePuterLoaded();
    await puter.auth?.signOut?.();
  } catch (err) {
    console.warn('[PuterAuth] signOut error:', err);
  }
  localStorage.removeItem('pixelops_puter_signed_in');
  localStorage.removeItem('pixelops_puter_username');
  if (localStorage.getItem('pixelops_ai_sso_mode') === 'puter') {
    localStorage.removeItem('pixelops_ai_sso_mode');
  }
  window.dispatchEvent(new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: null } }));
}

/**
 * Puter.js Model Inference Helper
 * Directly calls window.puter.ai.chat with requested model and messages
 */
export async function callPuterModel(
  model?: string,
  systemPrompt: string = '',
  messages: any[] = []
): Promise<string> {
  const puter = await ensurePuterLoaded();
  const targetModel = model || 'google/gemini-2.5-flash';

  const formattedMessages: any[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    formattedMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const m of messages) {
    const role = m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user';
    const content = typeof m === 'string' ? m : m.content || '';
    formattedMessages.push({ role, content });
  }

  const response = await puter.ai.chat(
    formattedMessages,
    { model: targetModel }
  );

  return response?.message?.content || response?.toString() || '';
}

export default {
  ensurePuterLoaded,
  isPuterSignedIn,
  getPuterUser,
  isPuterActive,
  setPuterActive,
  signInWithPuter,
  signOutPuter,
  callPuterModel,
};
