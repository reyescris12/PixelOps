/**
 * Local BYOK Plugin Authentication & Credential Storage Manager
 * (src/engine/pluginAuthManager.ts)
 * 
 * Provides client-side encrypted credential storage for PixelOps plugins,
 * tools, and API connectors:
 * - Encrypts credentials at rest with Web Crypto AES-GCM inside IndexedDB (encrypted_credentials)
 * - Queries secure IndexedDB for installed plugin auth discovery instead of plaintext localStorage
 * - Provides synchronous in-memory caching and reactive update events across components
 * - Automatically purges unencrypted legacy plaintext keys from localStorage on startup
 */

import {
  storeSecureCredential,
  getSecureCredential,
  deleteSecureCredential,
  getCachedDecryptedCredential,
  listSecureCredentials,
} from '../services/SecureVaultService';
import { db } from '../services/CommandLedgerDb';

export interface PluginAuthCredential {
  pluginId: string;
  apiKey: string;
  accessToken?: string;
  secret?: string;
  endpointUrl?: string;
  accountHandle?: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

export type PluginAuthChangeListener = (
  pluginId: string,
  credential: PluginAuthCredential | null
) => void;

const STORAGE_PREFIX = 'plugin_auth_';
const ALT_STORAGE_PREFIX = 'pixelops_plugin_auth_';
const REGISTRY_INDEX_KEY = 'pixelops_plugin_auth_registry_v1';

// In-memory fallback map for headless, sandbox, or SSR contexts
const memoryAuthStore = new Map<string, PluginAuthCredential>();
const listeners = new Set<PluginAuthChangeListener>();

/**
 * Normalizes plugin ID string for consistent lookup.
 */
export function normalizePluginId(rawId: string): string {
  if (!rawId) return '';
  return String(rawId)
    .trim()
    .toLowerCase()
    .replace(/^plugin_auth_/, '')
    .replace(/^pixelops_plugin_auth_/, '');
}

/**
 * Safely accesses localStorage if available in runtime context.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access denied or sandboxed
  }
  return null;
}

/**
 * Masks a secret string for safe display in retro terminal interfaces.
 */
export function maskCredential(secret?: string): string {
  if (!secret || typeof secret !== 'string' || secret.trim() === '') {
    return '[NO TOKEN CONFIGURED]';
  }
  const clean = secret.trim();
  if (clean.length <= 8) {
    return '••••••••';
  }
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Encrypts plugin credentials at rest using Web Crypto AES-GCM inside IndexedDB
 * and ensures legacy plaintext keys are purged from localStorage.
 */
export async function savePluginAuth(pluginId: string, credentials: any): Promise<void> {
  if (!credentials) return;
  const normId = normalizePluginId(pluginId);
  const storageKey = `pixelops_plugin_auth_${normId}`;

  // Encrypt the entire credential object as a JSON string inside IndexedDB
  await storeSecureCredential(storageKey, JSON.stringify(credentials));

  // Update in-memory cache for fast synchronous access
  const cred: PluginAuthCredential = {
    pluginId: normId,
    apiKey: String(credentials.apiKey || credentials.token || credentials.accessToken || '').trim(),
    accessToken: credentials.accessToken ? String(credentials.accessToken).trim() : undefined,
    secret: credentials.secret ? String(credentials.secret).trim() : undefined,
    endpointUrl: credentials.endpointUrl ? String(credentials.endpointUrl).trim() : undefined,
    accountHandle: credentials.accountHandle || 'BYOK Local Token',
    updatedAt: credentials.updatedAt || new Date().toISOString(),
    metadata: credentials.metadata || {},
  };
  memoryAuthStore.set(normId, cred);

  // Ensure legacy plaintext version is purged from localStorage
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`plugin_auth_${pluginId}`);
    localStorage.removeItem(`plugin_auth_${normId}`);
    localStorage.removeItem(`pixelops_plugin_auth_${pluginId}`);
  }

  notifyChange(normId, cred);
}

/**
 * Retrieves and decrypts stored plugin credentials from the secure IndexedDB vault.
 */
export async function getPluginAuth(pluginId: string): Promise<any> {
  const normId = normalizePluginId(pluginId);
  const storageKey = `pixelops_plugin_auth_${normId}`;
  const rawDecrypted = await getSecureCredential(storageKey);
  if (!rawDecrypted) return null;

  try {
    const parsed = JSON.parse(rawDecrypted);
    if (parsed && typeof parsed === 'object') {
      const cred: PluginAuthCredential = {
        pluginId: normId,
        apiKey: String(parsed.apiKey || parsed.token || parsed.accessToken || '').trim(),
        accessToken: parsed.accessToken ? String(parsed.accessToken).trim() : undefined,
        secret: parsed.secret ? String(parsed.secret).trim() : undefined,
        endpointUrl: parsed.endpointUrl ? String(parsed.endpointUrl).trim() : undefined,
        accountHandle: parsed.accountHandle || 'BYOK Local Token',
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        metadata: parsed.metadata || {},
      };
      memoryAuthStore.set(normId, cred);
      return parsed;
    }
    return parsed;
  } catch {
    const cred: PluginAuthCredential = {
      pluginId: normId,
      apiKey: rawDecrypted,
      accessToken: rawDecrypted,
      accountHandle: 'BYOK Local Token',
      updatedAt: new Date().toISOString(),
    };
    memoryAuthStore.set(normId, cred);
    return { accessToken: rawDecrypted }; // Fallback for legacy string tokens
  }
}

/**
 * Discovers installed plugin auth credentials by querying the secure
 * IndexedDB encrypted_credentials store instead of scanning localStorage for plaintext keys.
 */
export async function discoverInstalledPluginAuths(): Promise<string[]> {
  if (typeof indexedDB !== 'undefined' && db && db.encrypted_credentials) {
    try {
      const encryptedRecords = await db.encrypted_credentials
        .where('key')
        .startsWith('pixelops_plugin_auth_')
        .toArray();

      return encryptedRecords.map((record) => record.key.replace('pixelops_plugin_auth_', ''));
    } catch (err) {
      console.warn('[PluginAuthManager] Error querying encrypted_credentials store:', err);
    }
  }

  // Fallback for headless, sandbox, or test environments without native IndexedDB
  try {
    const allSecKeys = await listSecureCredentials();
    return allSecKeys
      .filter((r) => r.key.startsWith('pixelops_plugin_auth_'))
      .map((r) => r.key.replace('pixelops_plugin_auth_', ''));
  } catch {
    return [];
  }
}

/**
 * Purges legacy unencrypted plaintext plugin_auth_* keys from localStorage.
 */
export function purgeLegacyPluginAuthStorage(): void {
  if (typeof localStorage === 'undefined') return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('plugin_auth_') || key.startsWith('pixelops_plugin_auth_'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => {
    localStorage.removeItem(key);
    console.warn(`[SECURITY] Purged plaintext plugin auth key from localStorage: ${key}`);
  });
}

/**
 * Migrates any legacy unencrypted plugin credentials from localStorage into the secure vault
 * and then purges the plaintext keys from localStorage.
 */
export async function migrateAndPurgeLegacyPluginAuthStorage(): Promise<string[]> {
  if (typeof localStorage === 'undefined') return [];
  const keysToMigrate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('plugin_auth_') || key.startsWith('pixelops_plugin_auth_'))) {
      keysToMigrate.push(key);
    }
  }

  const migrated: string[] = [];
  for (const key of keysToMigrate) {
    try {
      const raw = localStorage.getItem(key);
      if (raw && raw.trim()) {
        const normId = normalizePluginId(key);
        const existing = await getPluginAuth(normId);
        if (!existing) {
          try {
            const parsed = JSON.parse(raw);
            await savePluginAuth(normId, parsed);
          } catch {
            await savePluginAuth(normId, { accessToken: raw });
          }
        }
        migrated.push(key);
      }
    } catch {}
    localStorage.removeItem(key);
    console.warn(`[SECURITY] Purged plaintext plugin auth key from localStorage: ${key}`);
  }
  return migrated;
}

/**
 * Retrieves stored authentication credentials for a specific plugin ID.
 * Returns synchronously from in-memory store or transient memory cache.
 */
export function getPluginCredential(pluginId: string): PluginAuthCredential | null {
  const normId = normalizePluginId(pluginId);
  if (!normId) return null;

  // 1. Check in-memory store
  if (memoryAuthStore.has(normId)) {
    return memoryAuthStore.get(normId) || null;
  }

  // 2. Check transient decrypted cache in memory from SecureVaultService
  const cachedDecrypted = getCachedDecryptedCredential(`pixelops_plugin_auth_${normId}`);
  if (cachedDecrypted) {
    try {
      const parsed = JSON.parse(cachedDecrypted);
      if (parsed && typeof parsed === 'object') {
        const cred: PluginAuthCredential = {
          pluginId: parsed.pluginId || normId,
          apiKey: String(parsed.apiKey || parsed.token || parsed.accessToken || ''),
          accessToken: parsed.accessToken ? String(parsed.accessToken) : undefined,
          secret: parsed.secret ? String(parsed.secret) : undefined,
          endpointUrl: parsed.endpointUrl ? String(parsed.endpointUrl) : undefined,
          accountHandle: parsed.accountHandle || 'BYOK Local Token',
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          metadata: parsed.metadata || {},
        };
        memoryAuthStore.set(normId, cred);
        return cred;
      }
    } catch {}
  }

  // 3. Trigger async fetch into memory in background for subsequent calls
  getPluginAuth(normId).catch(() => {});

  return null;
}

/**
 * Checks if a specific plugin currently has valid authenticated credentials.
 */
export function isPluginAuthenticated(pluginId: string): boolean {
  const cred = getPluginCredential(pluginId);
  if (!cred) return false;
  return Boolean((cred.apiKey && cred.apiKey.trim().length > 0) || (cred.accessToken && cred.accessToken.trim().length > 0));
}

/**
 * Saves or updates authentication credentials for a plugin.
 * Encrypts into IndexedDB encrypted_credentials and avoids writing plaintext to localStorage.
 */
export function savePluginCredential(
  pluginId: string,
  credentialInput: Partial<PluginAuthCredential> | string
): PluginAuthCredential {
  const normId = normalizePluginId(pluginId);
  if (!normId) {
    throw new Error('Plugin ID is required to save credentials.');
  }

  let finalApiKey = '';
  let finalAccessToken: string | undefined = undefined;
  let finalSecret: string | undefined = undefined;
  let finalEndpointUrl: string | undefined = undefined;
  let finalAccountHandle = 'BYOK Local Token';
  let metadata: Record<string, any> = {};

  if (typeof credentialInput === 'string') {
    finalApiKey = credentialInput.trim();
  } else if (credentialInput && typeof credentialInput === 'object') {
    finalApiKey = String(credentialInput.apiKey || credentialInput.accessToken || '').trim();
    if (credentialInput.accessToken) finalAccessToken = String(credentialInput.accessToken).trim();
    if (credentialInput.secret) finalSecret = String(credentialInput.secret).trim();
    if (credentialInput.endpointUrl) finalEndpointUrl = String(credentialInput.endpointUrl).trim();
    if (credentialInput.accountHandle) finalAccountHandle = String(credentialInput.accountHandle).trim();
    if (credentialInput.metadata) metadata = credentialInput.metadata;
  }

  const credential: PluginAuthCredential = {
    pluginId: normId,
    apiKey: finalApiKey,
    accessToken: finalAccessToken,
    secret: finalSecret,
    endpointUrl: finalEndpointUrl,
    accountHandle: finalAccountHandle || 'BYOK Local Token',
    updatedAt: new Date().toISOString(),
    metadata,
  };

  // Update in-memory store immediately
  memoryAuthStore.set(normId, credential);

  // Asynchronously encrypt into IndexedDB AES-GCM vault
  savePluginAuth(normId, credential).catch((err) => {
    console.warn('[PluginAuthManager] Error saving plugin auth to secure vault:', err);
  });

  // Purge any legacy plaintext keys from localStorage
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(`${STORAGE_PREFIX}${pluginId}`);
      storage.removeItem(`${STORAGE_PREFIX}${normId}`);
      storage.removeItem(`${ALT_STORAGE_PREFIX}${pluginId}`);
      storage.removeItem(`${ALT_STORAGE_PREFIX}${normId}`);
      updateRegistryIndex(normId, true);
    } catch {}
  }

  // Notify listeners and window custom event
  notifyChange(normId, credential);

  return credential;
}

/**
 * Clears/revokes authentication credentials for a plugin from memory,
 * the encrypted vault, and legacy storage.
 */
export function clearPluginCredential(pluginId: string): boolean {
  const normId = normalizePluginId(pluginId);
  if (!normId) return false;

  memoryAuthStore.delete(normId);

  // Delete from secure vault
  deleteSecureCredential(`pixelops_plugin_auth_${normId}`).catch(() => {});
  deleteSecureCredential(`pixelops_plugin_auth_${pluginId}`).catch(() => {});

  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(`${STORAGE_PREFIX}${pluginId}`);
      storage.removeItem(`${STORAGE_PREFIX}${normId}`);
      storage.removeItem(`${ALT_STORAGE_PREFIX}${pluginId}`);
      storage.removeItem(`${ALT_STORAGE_PREFIX}${normId}`);
      updateRegistryIndex(normId, false);
    } catch (err) {
      console.warn('[PluginAuthManager] Failed to remove credential from localStorage:', err);
    }
  }

  notifyChange(normId, null);
  return true;
}

/**
 * Returns all configured plugin credentials currently stored in memory.
 */
export function getAllPluginCredentials(): Record<string, PluginAuthCredential> {
  const result: Record<string, PluginAuthCredential> = {};
  for (const [id, cred] of memoryAuthStore.entries()) {
    result[id] = cred;
  }
  return result;
}

/**
 * Asynchronously discovers and decrypts all installed plugin credentials from the secure vault.
 */
export async function getAllPluginCredentialsAsync(): Promise<Record<string, PluginAuthCredential>> {
  const pluginIds = await discoverInstalledPluginAuths();
  for (const pid of pluginIds) {
    if (!memoryAuthStore.has(pid)) {
      await getPluginAuth(pid);
    }
  }
  return getAllPluginCredentials();
}

/**
 * Exports all credentials as a JSON string (for safe local backup).
 */
export function exportPluginCredentials(includeSensitive = false): string {
  const creds = getAllPluginCredentials();
  if (!includeSensitive) {
    const sanitized: Record<string, any> = {};
    for (const [id, cred] of Object.entries(creds)) {
      sanitized[id] = {
        ...cred,
        apiKey: maskCredential(cred.apiKey),
        accessToken: cred.accessToken ? maskCredential(cred.accessToken) : undefined,
        secret: cred.secret ? '••••••••' : undefined,
      };
    }
    return JSON.stringify(sanitized, null, 2);
  }
  return JSON.stringify(creds, null, 2);
}

/**
 * Imports credentials from a JSON string.
 */
export function importPluginCredentials(jsonString: string): { importedCount: number; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { importedCount: 0, error: 'Invalid JSON payload' };
    }

    let count = 0;
    const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);

    for (const entry of entries) {
      if (entry && typeof entry === 'object' && entry.pluginId && (entry.apiKey || entry.accessToken)) {
        savePluginCredential(entry.pluginId, entry);
        count++;
      }
    }

    return { importedCount: count };
  } catch (err: any) {
    return { importedCount: 0, error: err?.message || 'Failed to parse JSON' };
  }
}

/**
 * Subscribes to credential updates.
 */
export function subscribeToPluginAuth(listener: PluginAuthChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Helper to update registry index in localStorage.
 */
function updateRegistryIndex(pluginId: string, add: boolean) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(REGISTRY_INDEX_KEY);
    let index: string[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(index)) index = [];

    if (add) {
      if (!index.includes(pluginId)) index.push(pluginId);
    } else {
      index = index.filter((id) => id !== pluginId);
    }

    storage.setItem(REGISTRY_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Ignore
  }
}

/**
 * Dispatches change event to memory listeners and DOM window.
 */
function notifyChange(pluginId: string, credential: PluginAuthCredential | null) {
  for (const listener of listeners) {
    try {
      listener(pluginId, credential);
    } catch (err) {
      console.warn('[PluginAuthManager] Listener error:', err);
    }
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:plugin-auth-change', {
          detail: { pluginId, credential },
        })
      );
    } catch {
      // Ignore
    }
  }
}
