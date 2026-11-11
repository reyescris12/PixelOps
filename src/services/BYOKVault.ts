/**
 * src/services/BYOKVault.ts
 * Multi-Provider BYOK (Bring Your Own Key) Keychain & Vault Manager
 * Securely manages API keys and selected models across:
 * - Google Gemini (gemini-3.8-flash / gemini-3.1-flash-lite)
 * - Anthropic Claude (claude-3-5-sonnet)
 * - OpenAI (gpt-4o)
 * - Groq Cloud (llama-3.3-70b-versatile)
 * Synchronizes with IndexedDB Web Crypto vault and LocalStorage for offline-first PWA execution.
 */

import {
  LLMProviderType,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  testLLMProviderConnection,
  DEFAULT_PROVIDER_CONFIGS,
} from './LLMProviderService';
import {
  setGenericPassword,
  getGenericPassword,
  storeSecureCredential,
  getSecureCredential,
  deleteSecureCredential,
  getCachedDecryptedCredential,
} from './SecureVaultService';

export interface ProviderVaultEntry {
  providerId: 'gemini' | 'anthropic' | 'openai' | 'groq';
  name: string;
  badge: string;
  defaultModel: string;
  availableModels: string[];
  placeholderKey: string;
  apiKey: string;
  selectedModel: string;
  status: 'unconfigured' | 'testing' | 'valid' | 'invalid';
  statusMessage?: string;
  lastTestedAt?: string;
}

export const SUPPORTED_VAULT_PROVIDERS: Record<
  'gemini' | 'anthropic' | 'openai' | 'groq',
  {
    name: string;
    badge: string;
    defaultModel: string;
    availableModels: string[];
    placeholderKey: string;
    storageKey: string;
  }
> = {
  gemini: {
    name: 'Google Gemini',
    badge: 'GEMINI 3.8 / 3.1',
    defaultModel: 'gemini-3.8-flash',
    availableModels: ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
    placeholderKey: 'AIzaSy...',
    storageKey: 'pixelops_gemini_api_key',
  },
  anthropic: {
    name: 'Anthropic Claude',
    badge: 'CLAUDE 3.5 SONNET',
    defaultModel: 'claude-3-5-sonnet-20241022',
    availableModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    placeholderKey: 'sk-ant-...',
    storageKey: 'pixelops_anthropic_api_key',
  },
  openai: {
    name: 'OpenAI GPT',
    badge: 'GPT-4O / O3-MINI',
    defaultModel: 'gpt-4o',
    availableModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1'],
    placeholderKey: 'sk-...',
    storageKey: 'pixelops_openai_api_key',
  },
  groq: {
    name: 'Groq Cloud (LPU)',
    badge: 'LLAMA 3.3 70B',
    defaultModel: 'llama-3.3-70b-versatile',
    availableModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'deepseek-r1-distill-llama-70b',
    ],
    placeholderKey: 'gsk_...',
    storageKey: 'pixelops_groq_api_key',
  },
};

/**
 * Loads all provider keys and settings from LocalStorage & IndexedDB
 */
export function getBYOKVaultSnapshot(): Record<'gemini' | 'anthropic' | 'openai' | 'groq', ProviderVaultEntry> {
  const result = {} as Record<'gemini' | 'anthropic' | 'openai' | 'groq', ProviderVaultEntry>;
  const activeConfig = loadLLMProviderConfig();

  for (const [pId, meta] of Object.entries(SUPPORTED_VAULT_PROVIDERS) as [
    'gemini' | 'anthropic' | 'openai' | 'groq',
    (typeof SUPPORTED_VAULT_PROVIDERS)['gemini'],
  ][]) {
    let key = '';
    try {
      key =
        getCachedDecryptedCredential(meta.storageKey) ||
        getCachedDecryptedCredential(`byok::${pId}`) ||
        '';
      if (!key && pId === activeConfig.providerId && activeConfig.apiKey && !activeConfig.apiKey.startsWith('••••')) {
        key = activeConfig.apiKey;
      }
      if (!key) {
        key = (localStorage.getItem(meta.storageKey) || '').trim();
      }
      if (!key && pId === 'gemini') {
        key = (localStorage.getItem('gemini_api_key') || '').trim();
      }
    } catch {}

    let selectedModel = meta.defaultModel;
    try {
      const storedModel = localStorage.getItem(`pixelops_${pId}_model`);
      if (storedModel && meta.availableModels.includes(storedModel)) {
        selectedModel = storedModel;
      } else if (pId === activeConfig.providerId && activeConfig.modelName) {
        selectedModel = activeConfig.modelName;
      }
    } catch {}

    const status = key.trim() ? 'unconfigured' : 'unconfigured';

    result[pId] = {
      providerId: pId,
      name: meta.name,
      badge: meta.badge,
      defaultModel: meta.defaultModel,
      availableModels: meta.availableModels,
      placeholderKey: meta.placeholderKey,
      apiKey: key.trim(),
      selectedModel,
      status,
    };
  }

  return result;
}

/**
 * Persists an API key and model selection for a provider into IndexedDB and LocalStorage
 */
export async function saveBYOKVaultEntry(
  provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
  apiKey: string,
  model?: string
): Promise<void> {
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  if (!meta) return;

  const cleanKey = apiKey.trim();
  const cleanModel = model || meta.defaultModel;

  // 1. Encrypt and write to IndexedDB (encrypted_credentials) using non-extractable master key
  try {
    if (cleanKey) {
      await storeSecureCredential(meta.storageKey, cleanKey);
      await storeSecureCredential(`byok::${provider}`, cleanKey);
    } else {
      await deleteSecureCredential(meta.storageKey);
      await deleteSecureCredential(`byok::${provider}`);
    }
  } catch (idbErr) {
    console.warn('[BYOKVault] IndexedDB keychain encryption error:', idbErr);
  }

  // 2. Remove plaintext keys from LocalStorage (security compliance)
  try {
    localStorage.removeItem(meta.storageKey);
    if (provider === 'gemini') {
      localStorage.removeItem('gemini_api_key');
    } else if (provider === 'openai') {
      localStorage.removeItem('openai_api_key');
    } else if (provider === 'anthropic') {
      localStorage.removeItem('anthropic_api_key');
    } else if (provider === 'groq') {
      localStorage.removeItem('groq_api_key');
    }
    localStorage.setItem(`pixelops_${provider}_model`, cleanModel);
  } catch {}

  // 3. If this provider is currently active in LLMProviderConfig, update it as well
  const activeConfig = loadLLMProviderConfig();
  if (activeConfig.providerId === provider || (!activeConfig.apiKey && cleanKey)) {
    saveLLMProviderConfig({
      ...activeConfig,
      providerId: activeConfig.providerId === provider ? provider : activeConfig.providerId,
      authMode: 'apikey',
      apiKey: cleanKey || activeConfig.apiKey,
      modelName: activeConfig.providerId === provider ? cleanModel : activeConfig.modelName,
    });
  }
}

/**
 * Tests connection health for a specific BYOK provider
 */
export async function testBYOKConnection(
  provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
  apiKey?: string,
  model?: string
): Promise<{ ok: boolean; message: string; model: string }> {
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  const targetKey = (apiKey || getProviderApiKey(provider) || '').trim();
  const targetModel = model || localStorage.getItem(`pixelops_${provider}_model`) || meta.defaultModel;

  if (!targetKey) {
    return {
      ok: false,
      message: `API Key is missing for ${meta.name}. Enter a valid key to test link.`,
      model: targetModel,
    };
  }

  const testConfig = {
    providerId: provider as LLMProviderType,
    authMode: 'apikey' as const,
    apiKey: targetKey,
    endpoint:
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1'
        : provider === 'anthropic'
        ? 'https://api.anthropic.com'
        : provider === 'openai'
        ? 'https://api.openai.com/v1'
        : '',
    modelName: targetModel,
  };

  const res = await testLLMProviderConnection(testConfig, 'green', 'apikey');
  return {
    ok: res.ok,
    message: res.ok ? res.message || 'Connection verified' : res.error || 'Connection failed',
    model: res.model || targetModel,
  };
}

/**
 * Sets a specific provider from the vault as the active intelligence engine
 */
export function setActiveVaultProvider(
  provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
  model?: string
): void {
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  if (!meta) return;

  const key = getProviderApiKey(provider);
  const targetModel = model || localStorage.getItem(`pixelops_${provider}_model`) || meta.defaultModel;

  const current = loadLLMProviderConfig();
  const updated = {
    ...current,
    providerId: provider as LLMProviderType,
    authMode: 'apikey' as const,
    apiKey: key,
    modelName: targetModel,
    endpoint:
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1'
        : provider === 'anthropic'
        ? 'https://api.anthropic.com'
        : provider === 'openai'
        ? 'https://api.openai.com/v1'
        : DEFAULT_PROVIDER_CONFIGS.gemini.defaultEndpoint,
  };
  saveLLMProviderConfig(updated);
}

/**
 * Returns the stored API key or active subscription token for a given provider.
 * Exhaustively checks all canonical and alias storage keys across localStorage,
 * active configuration, connected accounts, and environment variables.
 */
export function getProviderApiKey(provider: 'gemini' | 'anthropic' | 'openai' | 'groq'): string {
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  if (!meta) return '';

  try {
    // 0. Check in-memory decrypted credentials cache (session-bound)
    const inMem =
      getCachedDecryptedCredential(meta.storageKey) ||
      getCachedDecryptedCredential(`byok::${provider}`);
    if (inMem) return inMem;

    // 1. Primary storage key from SUPPORTED_VAULT_PROVIDERS (e.g. pixelops_gemini_api_key)
    let key = (localStorage.getItem(meta.storageKey) || '').trim();
    if (key && key !== 'MY_GEMINI_API_KEY') return key;

    // 2. Provider-specific fallback storage aliases
    if (provider === 'gemini') {
      key = (
        localStorage.getItem('gemini_api_key') ||
        localStorage.getItem('apiKey') ||
        localStorage.getItem('pixelops_api_key') ||
        localStorage.getItem('GOOGLE_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.GEMINI_API_KEY) ||
        ''
      ).trim();
      if (key && key !== 'MY_GEMINI_API_KEY') return key;

      // Check Google OAuth access token (starts with ya29. or AIzaSy)
      const subToken = (localStorage.getItem('pixelops_google_access_token') || '').trim();
      if (subToken && (subToken.startsWith('ya29.') || subToken.startsWith('AIzaSy'))) {
        return subToken;
      }
    } else if (provider === 'openai') {
      key = (
        localStorage.getItem('openai_api_key') ||
        localStorage.getItem('pixelops_openai_key') ||
        localStorage.getItem('OPENAI_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_OPENAI_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.OPENAI_API_KEY) ||
        ''
      ).trim();
      if (key) return key;
    } else if (provider === 'anthropic') {
      key = (
        localStorage.getItem('anthropic_api_key') ||
        localStorage.getItem('claude_api_key') ||
        localStorage.getItem('pixelops_claude_api_key') ||
        localStorage.getItem('ANTHROPIC_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ANTHROPIC_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.ANTHROPIC_API_KEY) ||
        ''
      ).trim();
      if (key) return key;
    } else if (provider === 'groq') {
      key = (
        localStorage.getItem('groq_api_key') ||
        localStorage.getItem('pixelops_groq_key') ||
        localStorage.getItem('GROQ_API_KEY') ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GROQ_API_KEY) ||
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.GROQ_API_KEY) ||
        ''
      ).trim();
      if (key) return key;
    }

    // 3. Check LLMProviderConfig connectedAccounts
    const active = loadLLMProviderConfig();
    const connToken = active.connectedAccounts?.[provider]?.accessToken?.trim();
    if (connToken && !connToken.includes('google_ai_pro_') && !connToken.startsWith('eyJ')) {
      return connToken;
    }

    // 4. Check active config apiKey if provider matches
    if (active.providerId === provider && active.apiKey) {
      const activeKey = active.apiKey.trim();
      if (activeKey && activeKey !== 'MY_GEMINI_API_KEY') {
        return activeKey;
      }
    }

    // 5. If provider is gemini and active config has any valid key starting with AIzaSy
    if (provider === 'gemini' && active.apiKey && active.apiKey.startsWith('AIzaSy')) {
      return active.apiKey.trim();
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Asynchronously retrieves the provider API key, reading from encrypted IndexedDB if not cached.
 */
export async function getProviderApiKeyAsync(
  provider: 'gemini' | 'anthropic' | 'openai' | 'groq'
): Promise<string> {
  const meta = SUPPORTED_VAULT_PROVIDERS[provider];
  if (!meta) return '';

  const inMem =
    getCachedDecryptedCredential(meta.storageKey) ||
    getCachedDecryptedCredential(`byok::${provider}`);
  if (inMem) return inMem;

  try {
    const secure =
      (await getSecureCredential(meta.storageKey)) ||
      (await getSecureCredential(`byok::${provider}`));
    if (secure) return secure;
  } catch {}

  return getProviderApiKey(provider);
}

/**
 * Checks if a valid API key or credential exists for a specific provider
 */
export function hasProviderApiKey(provider: string): boolean {
  if (provider === 'puter') {
    return true; // Puter.js is zero-key SSO
  }
  if (provider === 'openrouter') {
    const key = typeof localStorage !== 'undefined' ? (localStorage.getItem('pixelops_openrouter_key') || '').trim() : '';
    return key.length > 5;
  }
  const key = getProviderApiKey(provider as any);
  if (!key) return false;
  if (provider === 'gemini') {
    return key !== 'MY_GEMINI_API_KEY' && key.length > 5;
  }
  return key.length > 5;
}

/**
 * Returns user-friendly provider display name
 */
export function getProviderDisplayName(provider: string): string {
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'puter') return 'Puter.js (Zero-Key)';
  return SUPPORTED_VAULT_PROVIDERS[provider as keyof typeof SUPPORTED_VAULT_PROVIDERS]?.name || provider;
}

