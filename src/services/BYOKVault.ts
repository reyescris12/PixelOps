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

import { LLMProviderType, loadLLMProviderConfig, saveLLMProviderConfig, testLLMProviderConnection } from './LLMProviderService';
import { setGenericPassword, getGenericPassword } from './SecureVaultService';

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
      key = localStorage.getItem(meta.storageKey) || '';
      if (!key && pId === activeConfig.providerId) {
        key = activeConfig.apiKey || '';
      }
      if (!key && pId === 'gemini') {
        key = localStorage.getItem('gemini_api_key') || '';
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

  // 1. Write to LocalStorage for fast synchronous retrieval
  try {
    if (cleanKey) {
      localStorage.setItem(meta.storageKey, cleanKey);
      if (provider === 'gemini') {
        localStorage.setItem('gemini_api_key', cleanKey);
      }
    } else {
      localStorage.removeItem(meta.storageKey);
      if (provider === 'gemini') {
        localStorage.removeItem('gemini_api_key');
      }
    }
    localStorage.setItem(`pixelops_${provider}_model`, cleanModel);
  } catch {}

  // 2. Encrypt & write to IndexedDB Web Crypto keychain
  try {
    if (cleanKey) {
      await setGenericPassword('byok_user', cleanKey, {
        service: `byok::${provider}`,
      });
    }
  } catch (idbErr) {
    console.warn('[BYOKVault] IndexedDB keychain encryption skipped:', idbErr);
  }

  // 3. If this provider is currently active in LLMProviderConfig, update it as well
  const activeConfig = loadLLMProviderConfig();
  if (activeConfig.providerId === provider) {
    saveLLMProviderConfig({
      ...activeConfig,
      apiKey: cleanKey,
      modelName: cleanModel,
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
  const targetKey = (apiKey || localStorage.getItem(meta.storageKey) || '').trim();
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
    endpoint: provider === 'groq' ? 'https://api.groq.com/openai/v1' : '',
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

  const key = (localStorage.getItem(meta.storageKey) || '').trim();
  const targetModel = model || localStorage.getItem(`pixelops_${provider}_model`) || meta.defaultModel;

  const current = loadLLMProviderConfig();
  const updated = {
    ...current,
    providerId: provider as LLMProviderType,
    authMode: 'apikey' as const,
    apiKey: key,
    modelName: targetModel,
  };
  saveLLMProviderConfig(updated);
}
