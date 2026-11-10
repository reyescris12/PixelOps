/**
 * src/services/OpenRouterAuth.ts
 * OpenRouter 1-Click OAuth PKCE SSO Service
 * Manages PKCE code generation, exchange, credentials caching, and Cloudflare D1 profile sync
 * for OpenRouter (300+ models, including free tiers & flagships).
 */

import { getActiveSession } from './AuthService';
import { pushToCloud } from './SyncService';

export interface OpenRouterModelOption {
  id: string;
  name: string;
  tag: 'FREE' | 'FLAGSHIP' | 'COMMUNITY';
  context: string;
}

export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';

/**
 * Official verified free models on OpenRouter (https://openrouter.ai/models?variant=free)
 */
export const OPENROUTER_FREE_MODELS: OpenRouterModelOption[] = [
  {
    id: 'openrouter/free',
    name: 'Free Models Router',
    tag: 'FREE',
    context: '200K tokens · Smart auto-router across all live free models',
  },
  {
    id: 'thinkingmachines/inkling-2-small:free',
    name: 'Thinking Machines Inkling 2 Small',
    tag: 'FREE',
    context: '1M tokens · 17B active / 594B total multimodal MoE reasoning',
  },
  {
    id: 'liquid/lfm-3-1.7b:free',
    name: 'LiquidAI LFM3 1.7B',
    tag: 'FREE',
    context: '256K tokens · Post-trained for agent tool calling & structured JSON',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google Gemma 4 31B',
    tag: 'FREE',
    context: '256K tokens · Multimodal text/vision · DeepMind thinking model',
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Google Gemma 4 26B A4B',
    tag: 'FREE',
    context: '256K tokens · DeepMind 3.8B active MoE architecture',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA Nemotron 3 Ultra',
    tag: 'FREE',
    context: '1M tokens · 55B active / 550B total MoE frontier reasoning',
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA Nemotron 3.5 Lightning',
    tag: 'FREE',
    context: '1M tokens · Ultra high-throughput agentic MoE',
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA Nemotron 3.5 Super VL',
    tag: 'FREE',
    context: '1M tokens · Multimodal vision, video, doc & GUI analysis',
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA Nemotron 3 Nano Omni',
    tag: 'FREE',
    context: '256K tokens · 30B MoE perception & context sub-agent',
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code',
    tag: 'FREE',
    context: '256K tokens · Cohere agentic coding specialist MoE',
  },
  {
    id: 'recursive/flint-v1.0:free',
    name: 'Recursive Flint',
    tag: 'FREE',
    context: '262K tokens · Autoresearch 40B MoE for coding agents',
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots Studio Dots3-Note Preview',
    tag: 'FREE',
    context: '512K tokens · 280B MoE note analysis preview',
  },
  {
    id: 'xingchen-agi/xing4.0-29b-a4b:free',
    name: 'XingChen Xing4.0 29B A4B',
    tag: 'FREE',
    context: '262K tokens · 29B MoE with 4B active per token',
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'LiquidAI LFM 2.5 2.6B',
    tag: 'FREE',
    context: '65K tokens · Fast compact RAG & data extraction',
  },
];

export const OPENROUTER_FLAGSHIP_MODELS: OpenRouterModelOption[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    tag: 'FLAGSHIP',
    context: '200K tokens · Premier reasoning & coding',
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI GPT-4o',
    tag: 'FLAGSHIP',
    context: '128K tokens · Multimodal flagship intelligence',
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'OpenAI GPT-4o Mini',
    tag: 'FLAGSHIP',
    context: '128K tokens · Fast cost-effective reasoning',
  },
  {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1 (Paid)',
    tag: 'FLAGSHIP',
    context: 'Dedicated high-throughput reasoning tier',
  },
];

export const OPENROUTER_SUPPORTED_MODELS: OpenRouterModelOption[] = [
  ...OPENROUTER_FREE_MODELS,
  ...OPENROUTER_FLAGSHIP_MODELS,
];

/**
 * Returns all free-tier OpenRouter models
 */
export function getOpenRouterFreeModels(): OpenRouterModelOption[] {
  return OPENROUTER_FREE_MODELS;
}

/**
 * Fetches live list of free models from OpenRouter API if online, falling back to curated list
 */
export async function fetchLiveOpenRouterModels(): Promise<OpenRouterModelOption[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return OPENROUTER_SUPPORTED_MODELS;
    const data = await res.json();
    if (!Array.isArray(data?.data)) return OPENROUTER_SUPPORTED_MODELS;

    const liveFree: OpenRouterModelOption[] = [];
    for (const item of data.data) {
      const isFree =
        String(item.id).endsWith(':free') ||
        (item.pricing && (item.pricing.prompt === '0' || item.pricing.prompt === 0) && (item.pricing.completion === '0' || item.pricing.completion === 0));
      if (isFree && !liveFree.some((m) => m.id === item.id)) {
        liveFree.push({
          id: item.id,
          name: item.name || item.id.replace(':free', ''),
          tag: 'FREE',
          context: `${item.context_length ? `${Math.round(item.context_length / 1000)}K tokens` : 'Free Tier'} · Zero-cost inference`,
        });
      }
    }

    if (liveFree.length > 0) {
      return [...liveFree, ...OPENROUTER_FLAGSHIP_MODELS];
    }
  } catch {
    // Network offline or endpoint unreachable, gracefully return offline curated catalog
  }
  return OPENROUTER_SUPPORTED_MODELS;
}

const STORAGE_KEY = 'pixelops_openrouter_key';
const STORAGE_MODEL = 'pixelops_openrouter_model';
const VERIFIER_KEY = 'or_code_verifier';

/**
 * Generates high-entropy random string for PKCE code_verifier
 */
function generateCodeVerifier(length: number = 64): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomValues[i] % charset.length];
  }
  return result;
}

/**
 * Computes SHA-256 hash using Web Crypto API
 */
async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
}

/**
 * Base64-URL encodes ArrayBuffer (RFC 7636)
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates PKCE code_verifier and code_challenge pair
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateCodeVerifier(64);
  const hash = await sha256(verifier);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

/**
 * Initiates OpenRouter 1-Click OAuth PKCE flow
 * Generates verifier/challenge, caches verifier in sessionStorage, and redirects to OpenRouter Auth
 */
export async function startOpenRouterOAuth(): Promise<void> {
  if (typeof window === 'undefined') return;

  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem('or_oauth_in_progress', '1');

  // Callback URL points back to safehouse origin
  const callbackUrl = window.location.origin;
  const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(
    callbackUrl
  )}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;

  window.location.href = authUrl;
}

/**
 * Handles OAuth callback upon return from OpenRouter (?code= in URL)
 * Exchanges code for API key and persists credentials
 */
export async function handleOpenRouterCallback(): Promise<{ ok: boolean; key?: string; error?: string } | null> {
  if (typeof window === 'undefined') return null;

  const search = window.location.search || '';
  if (!search.includes('code=')) return null;

  const params = new URLSearchParams(search);
  const code = params.get('code');
  if (!code) return null;

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) {
    // No verifier saved; may be another OAuth flow
    return null;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        code_verifier: verifier,
        code_challenge_method: 'S256',
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.error?.message || errJson?.message || `HTTP ${res.status}`;
      throw new Error(`OpenRouter key exchange failed: ${msg}`);
    }

    const data = await res.json();
    const apiKey = data?.key;
    if (!apiKey) {
      throw new Error('OpenRouter response contained no API key.');
    }

    // Persist key to localStorage
    localStorage.setItem(STORAGE_KEY, apiKey);
    localStorage.setItem('pixelops_ai_sso_mode', 'openrouter');

    // Clean up temporary PKCE verifier
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem('or_oauth_in_progress');

    // Clean URL query params without reloading
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);

    // Sync to user's Cloudflare D1 user_data profile if logged in
    try {
      const session = getActiveSession();
      if (session) {
        await pushToCloud();
      }
    } catch (syncErr) {
      console.warn('[OpenRouterAuth] Cloudflare D1 sync notice:', syncErr);
    }

    window.dispatchEvent(
      new CustomEvent('pixelops:ai-sso-changed', {
        detail: { mode: 'openrouter', key: apiKey },
      })
    );

    return { ok: true, key: apiKey };
  } catch (err: any) {
    console.error('[OpenRouterAuth] Callback handling error:', err);
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem('or_oauth_in_progress');
    return { ok: false, error: err?.message || 'Failed to exchange OpenRouter OAuth code.' };
  }
}

/**
 * Retrieves the stored OpenRouter API key
 */
export function getOpenRouterKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return (localStorage.getItem(STORAGE_KEY) || '').trim();
}

/**
 * Saves OpenRouter API key manually
 */
export function setOpenRouterKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = key.trim();
  if (clean) {
    localStorage.setItem(STORAGE_KEY, clean);
    localStorage.setItem('pixelops_ai_sso_mode', 'openrouter');
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: clean ? 'openrouter' : null } }));
}

/**
 * Checks if OpenRouter is configured with an active key
 */
export function isOpenRouterConnected(): boolean {
  return Boolean(getOpenRouterKey());
}

/**
 * Checks whether OpenRouter is the active AI SSO mode
 */
export function isOpenRouterActive(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return (
    localStorage.getItem('pixelops_ai_sso_mode') === 'openrouter' ||
    (Boolean(getOpenRouterKey()) && localStorage.getItem('pixelops_ai_sso_mode') !== 'puter')
  );
}

/**
 * Sets OpenRouter as the active AI SSO mode
 */
export function setOpenRouterActive(active: boolean = true): void {
  if (typeof localStorage === 'undefined') return;
  if (active) {
    localStorage.setItem('pixelops_ai_sso_mode', 'openrouter');
  } else if (localStorage.getItem('pixelops_ai_sso_mode') === 'openrouter') {
    localStorage.removeItem('pixelops_ai_sso_mode');
  }
  window.dispatchEvent(new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: active ? 'openrouter' : null } }));
}

/**
 * Gets selected OpenRouter model
 */
export function getOpenRouterSelectedModel(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_OPENROUTER_MODEL;
  const stored = localStorage.getItem(STORAGE_MODEL);
  if (stored) {
    // If user has old model stored that is no longer free, seamlessly migrate to DEFAULT_OPENROUTER_MODEL
    const isKnown = OPENROUTER_SUPPORTED_MODELS.some((m) => m.id === stored);
    if (isKnown) return stored;
    if (
      stored.includes('gemini-2.5-flash') ||
      stored.includes('llama-3.3-70b-instruct:free') ||
      stored.includes('deepseek-r1:free')
    ) {
      localStorage.setItem(STORAGE_MODEL, DEFAULT_OPENROUTER_MODEL);
      return DEFAULT_OPENROUTER_MODEL;
    }
    return stored;
  }
  return DEFAULT_OPENROUTER_MODEL;
}

/**
 * Sets selected OpenRouter model
 */
export function setOpenRouterSelectedModel(model: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_MODEL, model);
}

/**
 * Disconnects OpenRouter credentials
 */
export async function disconnectOpenRouter(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  if (localStorage.getItem('pixelops_ai_sso_mode') === 'openrouter') {
    localStorage.removeItem('pixelops_ai_sso_mode');
  }
  try {
    const session = getActiveSession();
    if (session) {
      await pushToCloud();
    }
  } catch {}
  window.dispatchEvent(new CustomEvent('pixelops:ai-sso-changed', { detail: { mode: null } }));
}

/**
 * Tests live connection to OpenRouter API
 */
export async function testOpenRouterConnection(
  modelOverride?: string,
  keyOverride?: string
): Promise<{ ok: boolean; message?: string; error?: string; model?: string }> {
  const key = (keyOverride || getOpenRouterKey()).trim();
  if (!key) {
    return { ok: false, error: 'OpenRouter API key is missing. Connect via 1-Click Power SSO.' };
  }

  const model = modelOverride || getOpenRouterSelectedModel();

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://pixelops.app',
        'X-Title': 'PixelOps Command Center',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Respond with a 6-word tactical readiness confirmation.' }],
        max_tokens: 30,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg, model };
    }

    const reply = data?.choices?.[0]?.message?.content?.trim() || 'OpenRouter tactical link verified.';
    return { ok: true, message: reply, model };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'OpenRouter connection failed', model };
  }
}

export default {
  startOpenRouterOAuth,
  handleOpenRouterCallback,
  getOpenRouterKey,
  setOpenRouterKey,
  isOpenRouterConnected,
  isOpenRouterActive,
  setOpenRouterActive,
  getOpenRouterSelectedModel,
  setOpenRouterSelectedModel,
  disconnectOpenRouter,
  testOpenRouterConnection,
  OPENROUTER_SUPPORTED_MODELS,
};
