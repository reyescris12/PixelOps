/**
 * Local BYOK Plugin Authentication & Credential Storage Manager
 * (src/engine/pluginAuthManager.js)
 */

const STORAGE_PREFIX = 'plugin_auth_';
const ALT_STORAGE_PREFIX = 'pixelops_plugin_auth_';
const REGISTRY_INDEX_KEY = 'pixelops_plugin_auth_registry_v1';

const memoryAuthStore = new Map();
const listeners = new Set();

export function normalizePluginId(rawId) {
  if (!rawId) return '';
  return String(rawId)
    .trim()
    .toLowerCase()
    .replace(/^plugin_auth_/, '')
    .replace(/^pixelops_plugin_auth_/, '');
}

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Access denied or sandboxed
  }
  return null;
}

export function maskCredential(secret) {
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

export function getPluginCredential(pluginId) {
  const normId = normalizePluginId(pluginId);
  if (!normId) return null;

  if (memoryAuthStore.has(normId)) {
    return memoryAuthStore.get(normId) || null;
  }

  const storage = getStorage();
  if (storage) {
    const candidates = [
      `${STORAGE_PREFIX}${pluginId}`,
      `${STORAGE_PREFIX}${normId}`,
      `${ALT_STORAGE_PREFIX}${pluginId}`,
      `${ALT_STORAGE_PREFIX}${normId}`,
      pluginId,
    ];

    for (const key of candidates) {
      try {
        const raw = storage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const cred = {
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
        }
      } catch {
        // Skip unparseable entry
      }
    }
  }

  return null;
}

export function isPluginAuthenticated(pluginId) {
  const cred = getPluginCredential(pluginId);
  if (!cred) return false;
  return Boolean((cred.apiKey && cred.apiKey.trim().length > 0) || (cred.accessToken && cred.accessToken.trim().length > 0));
}

export function savePluginCredential(pluginId, credentialInput) {
  const normId = normalizePluginId(pluginId);
  if (!normId) {
    throw new Error('Plugin ID is required to save credentials.');
  }

  let finalApiKey = '';
  let finalAccessToken = undefined;
  let finalSecret = undefined;
  let finalEndpointUrl = undefined;
  let finalAccountHandle = 'BYOK Local Token';
  let metadata = {};

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

  const credential = {
    pluginId: normId,
    apiKey: finalApiKey,
    accessToken: finalAccessToken,
    secret: finalSecret,
    endpointUrl: finalEndpointUrl,
    accountHandle: finalAccountHandle || 'BYOK Local Token',
    updatedAt: new Date().toISOString(),
    metadata,
  };

  memoryAuthStore.set(normId, credential);

  const storage = getStorage();
  if (storage) {
    try {
      const serialized = JSON.stringify(credential);
      storage.setItem(`${STORAGE_PREFIX}${normId}`, serialized);
      storage.setItem(`${ALT_STORAGE_PREFIX}${normId}`, serialized);
      updateRegistryIndex(normId, true);
    } catch (err) {
      console.warn('[PluginAuthManager] Failed to persist to localStorage:', err);
    }
  }

  notifyChange(normId, credential);
  return credential;
}

export function clearPluginCredential(pluginId) {
  const normId = normalizePluginId(pluginId);
  if (!normId) return false;

  memoryAuthStore.delete(normId);

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

export function getAllPluginCredentials() {
  const result = {};

  for (const [id, cred] of memoryAuthStore.entries()) {
    result[id] = cred;
  }

  const storage = getStorage();
  if (storage) {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key) continue;

        if (key.startsWith(STORAGE_PREFIX) || key.startsWith(ALT_STORAGE_PREFIX)) {
          const raw = storage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              const pid = normalizePluginId(parsed.pluginId || key);
              if (pid && !result[pid]) {
                result[pid] = {
                  pluginId: pid,
                  apiKey: String(parsed.apiKey || parsed.token || ''),
                  accessToken: parsed.accessToken,
                  secret: parsed.secret,
                  endpointUrl: parsed.endpointUrl,
                  accountHandle: parsed.accountHandle || 'BYOK Local Token',
                  updatedAt: parsed.updatedAt || new Date().toISOString(),
                  metadata: parsed.metadata || {},
                };
              }
            }
          } catch {
            // ignore bad JSON
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return result;
}

export function exportPluginCredentials(includeSensitive = false) {
  const creds = getAllPluginCredentials();
  if (!includeSensitive) {
    const sanitized = {};
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

export function importPluginCredentials(jsonString) {
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
  } catch (err) {
    return { importedCount: 0, error: err?.message || 'Failed to parse JSON' };
  }
}

export function subscribeToPluginAuth(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function updateRegistryIndex(pluginId, add) {
  const storage = getStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(REGISTRY_INDEX_KEY);
    let index = raw ? JSON.parse(raw) : [];
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

function notifyChange(pluginId, credential) {
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
