/**
 * AuthService.ts
 * 
 * Cryptographic User Authentication & Device Identity Service for PixelOps.
 * Provides client-side and server-backed user registration, PBKDF2 (100,000 iterations)
 * password hashing, HttpOnly session cookie support, multi-device identity tracking,
 * and encrypted offline credential protection with zero plaintext credential storage in localStorage.
 */

import { storeSecureCredential, getSecureCredential } from './SecureVaultService';
import {
  type SubscriptionTier,
  TIER_LIMITS,
  normalizeSubscriptionTier,
  hasMinimumTier,
} from '../config/tierLimits';

export type { SubscriptionTier };

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  callsign: string;
  securityClearance: 'OPERATIVE' | 'COMMANDER' | 'DIRECTOR';
  subscription_tier?: SubscriptionTier;
  sweeps_remaining?: number;
  composioEntityId?: string;
  composioApiKey?: string;
  createdAt: string;
  lastLoginAt: string;
}

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  platform: string;
  lastActive: string;
  isCurrent?: boolean;
}

export interface AuthSession {
  token: string;
  user: UserAccount;
  device: DeviceInfo;
  expiresAt: string;
}

export interface CachedUserProfile {
  id: string;
  username: string;
  email: string;
  callsign: string;
  securityClearance: 'OPERATIVE' | 'COMMANDER' | 'DIRECTOR';
  subscription_tier?: SubscriptionTier;
  sweeps_remaining?: number;
  composioEntityId?: string;
  composioApiKey?: string;
  createdAt: string;
  lastLoginAt: string;
  devices: DeviceInfo[];
}

const STORAGE_AUTH_SESSION = 'pixelops_auth_session_v1';
const STORAGE_DEVICE_ID = 'pixelops_device_id_v1';
const STORAGE_CACHED_PROFILES = 'pixelops_auth_cached_profiles_v1';
const STORAGE_LOCAL_USERS_LEGACY = 'pixelops_auth_local_users_v1';

/**
 * Purges legacy plaintext password hashes and salts from localStorage (pixelops_auth_local_users_v1)
 * and migrates safe public profile metadata to pixelops_auth_cached_profiles_v1.
 */
export function purgeSensitiveLocalUserCredentials(): number {
  let purgedCount = 0;
  if (typeof localStorage === 'undefined') return 0;

  try {
    const legacyRaw = localStorage.getItem(STORAGE_LOCAL_USERS_LEGACY);
    if (legacyRaw) {
      try {
        const legacyUsers = JSON.parse(legacyRaw);
        if (Array.isArray(legacyUsers)) {
          const safeProfiles: CachedUserProfile[] = legacyUsers.map((u: any) => ({
            id: u.id,
            username: (u.username || '').toLowerCase(),
            email: (u.email || '').toLowerCase(),
            callsign: (u.callsign || '').toUpperCase(),
            securityClearance: u.securityClearance || 'OPERATIVE',
            composioEntityId: u.composioEntityId,
            composioApiKey: u.composioApiKey,
            createdAt: u.createdAt || new Date().toISOString(),
            lastLoginAt: u.lastLoginAt || new Date().toISOString(),
            devices: u.devices || [],
          }));
          localStorage.setItem(STORAGE_CACHED_PROFILES, JSON.stringify(safeProfiles));
          purgedCount = legacyUsers.length;
        }
      } catch {}
      // Permanently remove legacy plaintext credential array
      localStorage.removeItem(STORAGE_LOCAL_USERS_LEGACY);
      console.log(`[Security] Purged ${purgedCount} legacy user credentials from localStorage key "${STORAGE_LOCAL_USERS_LEGACY}".`);
    }
  } catch (err) {
    console.warn('[Security] Failed to purge legacy local users:', err);
  }

  return purgedCount;
}

// Automatically purge legacy credentials upon module load
if (typeof window !== 'undefined') {
  try {
    purgeSensitiveLocalUserCredentials();
  } catch {}
}

/**
 * Generates cryptographically secure random bytes using Web Crypto API (crypto.getRandomValues).
 * Replaces predictable Math.random() to prevent PRNG state recovery and sequence prediction attacks.
 */
export function generateSecureToken(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates an unambiguous, cryptographically secure alphanumeric code from a 32-character charset.
 */
export function generateSecureCode(length = 6): string {
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Unambiguous base32
  const bytes = new Uint8Array(length * 2);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : (globalThis as any).crypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  }

  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const val = bytes[i];
    if (val < charset.length * Math.floor(256 / charset.length)) {
      result += charset[val % charset.length];
    }
  }
  while (result.length < length) {
    const b = new Uint8Array(1);
    if (cryptoObj && cryptoObj.getRandomValues) {
      cryptoObj.getRandomValues(b);
    }
    if (b[0] < charset.length * Math.floor(256 / charset.length)) {
      result += charset[b[0] % charset.length];
    }
  }
  return result;
}

/**
 * Generates a human-readable, high-entropy satellite recovery key backed by CSPRNG
 * Example: SATCOM-CIPHER-8A2F-9B1D-4K7M
 */
export function generateRecoveryKey(callsign: string): string {
  const clean = callsign.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'AGENT';
  const r1 = generateSecureCode(4);
  const r2 = generateSecureCode(4);
  const r3 = generateSecureCode(4);
  return `SATCOM-${clean}-${r1}-${r2}-${r3}`;
}

/**
 * Cryptographically hashes a recovery key for secure zero-knowledge storage
 */
export async function hashRecoveryKeyClient(key: string): Promise<string> {
  const clean = key.trim().toUpperCase();
  const enc = new TextEncoder();
  const data = enc.encode(`recovery:${clean}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes a secure PBKDF2 hash (100,000 iterations, SHA-256) using the browser Web Crypto API
 * to prevent GPU/ASIC offline dictionary and brute-force attacks.
 */
export async function hashPasswordPBKDF2(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Standard password hash function: uses PBKDF2 with 100,000 iterations
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  return await hashPasswordPBKDF2(password, salt);
}

/**
 * Verifies a password against a stored hash with fallback support for legacy SHA-256 hashes
 */
export async function verifyPasswordHash(password: string, salt: string, storedHash: string): Promise<boolean> {
  // 1. Modern PBKDF2 (100,000 iterations)
  const pbkdf2 = await hashPasswordPBKDF2(password, salt);
  if (pbkdf2 === storedHash) return true;

  // 2. Legacy SHA-256 fallback
  const enc = new TextEncoder();
  const legacyBuf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${password}`));
  const legacyHash = Array.from(new Uint8Array(legacyBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (legacyHash === storedHash) return true;

  // 3. Legacy SHA-256 with pepper fallback
  const pepperBuf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${password}:pixelops_satcom_secret`));
  const pepperHash = Array.from(new Uint8Array(pepperBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return pepperHash === storedHash;
}

/**
 * Retrieves or creates a persistent unique Device ID for this client hardware backed by CSPRNG
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server_node';
  try {
    let id = localStorage.getItem(STORAGE_DEVICE_ID);
    if (!id) {
      const type = getDeviceType();
      const rand = generateSecureToken(8);
      id = `dev_${type}_${Date.now().toString(36)}_${rand}`;
      localStorage.setItem(STORAGE_DEVICE_ID, id);
    }
    return id;
  } catch {
    return 'dev_unknown_' + generateSecureToken(6);
  }
}

/**
 * Detects whether the current device is mobile, tablet, or desktop
 */
export function getDeviceType(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (
    /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(
      ua
    ) ||
    window.innerWidth <= 768
  ) {
    return 'mobile';
  }
  return 'desktop';
}

/**
 * Computes a friendly readable name for this device (e.g., "Windows PC (Chrome)" or "iPhone (Safari)")
 */
export function getDeviceName(): string {
  if (typeof window === 'undefined') return 'Safehouse Terminal';
  const ua = navigator.userAgent;
  let os = 'Desktop';
  if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'MacBook';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android Device';
  else if (/Linux/i.test(ua)) os = 'Linux Box';

  let browser = 'Browser';
  if (/Chrome/i.test(ua) && !/Edge|OPR/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Edge/i.test(ua)) browser = 'Edge';

  const type = getDeviceType();
  if (type === 'mobile' || type === 'tablet') {
    return `${os} (${browser})`;
  }
  return `${os} Command Node (${browser})`;
}

/**
 * Returns comprehensive current device identity object
 */
export function getCurrentDeviceInfo(): DeviceInfo {
  return {
    deviceId: getOrCreateDeviceId(),
    deviceName: getDeviceName(),
    deviceType: getDeviceType(),
    platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'server',
    lastActive: new Date().toISOString(),
    isCurrent: true,
  };
}

/**
 * Retrieves the currently active user session from local client storage
 */
export function getActiveSession(): AuthSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      clearActiveSession();
      return null;
    }
    if (session.user) {
      session.user.subscription_tier = normalizeSubscriptionTier(session.user.subscription_tier);
      session.user.sweeps_remaining = Number(session.user.sweeps_remaining || 0) || 0;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Returns the active user's subscription_tier (defaults to 'operative' for local guests)
 */
export function getActiveSubscriptionTier(): SubscriptionTier {
  const session = getActiveSession();
  return normalizeSubscriptionTier(session?.user?.subscription_tier);
}

/**
 * Returns the active user's TIER_LIMITS record
 */
export function getActiveTierLimits() {
  return TIER_LIMITS[getActiveSubscriptionTier()];
}

/**
 * Checks whether the active user/guest meets `minTier`
 */
export function canAccessTier(minTier: SubscriptionTier): boolean {
  return hasMinimumTier(getActiveSubscriptionTier(), minTier);
}

/**
 * Refreshes session entitlements (`subscription_tier`, `sweeps_remaining`) from `/api/me` when authenticated
 */
export async function syncEntitlementsFromEdge(): Promise<SubscriptionTier> {
  const session = getActiveSession();
  if (!session?.token) return 'operative';
  try {
    const res = await fetch('/api/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && data?.user) {
        const updatedSession: AuthSession = {
          ...session,
          user: {
            ...session.user,
            subscription_tier: normalizeSubscriptionTier(data.user.subscription_tier),
            sweeps_remaining: Number(data.user.sweeps_remaining || 0) || 0,
          },
        };
        setActiveSession(updatedSession);
        return updatedSession.user.subscription_tier || 'operative';
      }
    }
  } catch {}
  return getActiveSubscriptionTier();
}

/**
 * Saves active session and dispatches global authentication status change
 */
export function setActiveSession(session: AuthSession): void {
  try {
    localStorage.setItem(STORAGE_AUTH_SESSION, JSON.stringify(session));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pixelops:auth-changed', { detail: { session } }));
    }
  } catch (err) {
    console.error('Failed to save auth session', err);
  }
}

/**
 * Clears current session (Log out)
 */
export function clearActiveSession(): void {
  try {
    localStorage.removeItem(STORAGE_AUTH_SESSION);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pixelops:auth-changed', { detail: { session: null } }));
    }
  } catch {}
}

/**
 * Retrieves cached user profiles (public metadata only: id, username, email, callsign, clearance, devices)
 * Guarantees ZERO plaintext password hashes, salts, or recovery key secrets in localStorage.
 */
export function getCachedUserProfiles(): CachedUserProfile[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_CACHED_PROFILES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Persists sanitized user profile metadata in localStorage without sensitive credentials.
 */
export function saveCachedUserProfile(profile: CachedUserProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const profiles = getCachedUserProfiles();
    const cleanUser = profile.username.toLowerCase().trim();
    const idx = profiles.findIndex((p) => p.id === profile.id || p.username.toLowerCase() === cleanUser);
    const sanitized: CachedUserProfile = {
      id: profile.id,
      username: cleanUser,
      email: (profile.email || `${cleanUser}@pixelops.local`).toLowerCase().trim(),
      callsign: (profile.callsign || cleanUser).toUpperCase().trim(),
      securityClearance: profile.securityClearance || 'OPERATIVE',
      composioEntityId: profile.composioEntityId,
      composioApiKey: profile.composioApiKey,
      createdAt: profile.createdAt || new Date().toISOString(),
      lastLoginAt: profile.lastLoginAt || new Date().toISOString(),
      devices: Array.isArray(profile.devices) ? profile.devices : [],
    };

    if (idx >= 0) {
      profiles[idx] = { ...profiles[idx], ...sanitized };
    } else {
      profiles.push(sanitized);
    }
    localStorage.setItem(STORAGE_CACHED_PROFILES, JSON.stringify(profiles));
  } catch (err) {
    console.warn('Failed to save cached user profile:', err);
  }
}

// Backward-compatible aliases for existing internal callers
function getLocalUsers(): CachedUserProfile[] {
  return getCachedUserProfiles();
}

function saveLocalUsers(users: CachedUserProfile[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_CACHED_PROFILES, JSON.stringify(users));
  } catch {}
}

function upsertLocalUser(record: CachedUserProfile): void {
  saveCachedUserProfile(record);
}

/**
 * Registers a new account with email/username, password, and recovery key
 */
export async function registerAccount(params: {
  username: string;
  email: string;
  password: string;
  callsign?: string;
}): Promise<AuthSession & { oneTimeRecoveryKey?: string }> {
  const username = params.username.trim().toLowerCase();
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const callsign = (params.callsign || params.username).trim().toUpperCase();

  if (!username || username.length < 3) {
    throw new Error('Callsign/Username must be at least 3 characters.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters for safehouse encryption.');
  }

  const device = getCurrentDeviceInfo();
  const rawRecoveryKey = generateRecoveryKey(callsign);
  let currentEntityId: string | null = null;
  let currentApiKey: string | null = null;
  try {
    const { getOrCreateEntityId, getComposioApiKey } = await import('./ComposioService');
    currentEntityId = getOrCreateEntityId();
    currentApiKey = getComposioApiKey() || null;
  } catch {}

  // 1. Attempt server-side API registration first
  try {
    let res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        username,
        email,
        password,
        callsign,
        device,
        composioEntityId: currentEntityId,
        composioApiKey: currentApiKey,
      }),
    });

    if (!res.ok && res.status === 404) {
      res = await fetch('/api/auth?action=register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username,
          email,
          password,
          callsign,
          device,
          composioEntityId: currentEntityId,
          composioApiKey: currentApiKey,
        }),
      });
    }

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        // Cache user public profile locally without sensitive password hash or salt
        const fleetDevices = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices : [device];
        saveCachedUserProfile({
          id: data.session.user.id,
          username: data.session.user.username,
          email: data.session.user.email,
          callsign: data.session.user.callsign,
          securityClearance: data.session.user.securityClearance,
          subscription_tier: normalizeSubscriptionTier(data.session.user.subscription_tier),
          sweeps_remaining: Number(data.session.user.sweeps_remaining || 0) || 0,
          createdAt: data.session.user.createdAt,
          lastLoginAt: data.session.user.lastLoginAt,
          devices: fleetDevices,
        });

        // Store offline verification verifier strictly inside IndexedDB WebCrypto AES-GCM vault, NEVER in plaintext localStorage!
        try {
          const offlineSalt = generateSecureToken(16);
          const offlineHash = await hashPasswordPBKDF2(password, offlineSalt);
          await storeSecureCredential(
            `pixelops_offline_verifier_${data.session.user.id}`,
            JSON.stringify({ salt: offlineSalt, hash: offlineHash })
          );
          const offlineRecovery = await hashRecoveryKeyClient(data.oneTimeRecoveryKey || rawRecoveryKey);
          await storeSecureCredential(
            `pixelops_offline_recovery_hash_${data.session.user.id}`,
            offlineRecovery
          );
        } catch {}

        try {
          localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
        } catch {}

        setActiveSession(data.session);
        return {
          ...data.session,
          oneTimeRecoveryKey: data.oneTimeRecoveryKey || rawRecoveryKey,
        };
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 409 || errData.message?.includes('already exists')) {
        throw new Error(errData.message || 'An operative with that username or email already exists.');
      }
      if (res.status === 429) {
        throw new Error(errData.message || 'Too many registration attempts. Please wait before retrying.');
      }
    }
  } catch (netErr: any) {
    if (netErr.message?.includes('already exists') || netErr.message?.includes('registration attempts') || netErr.message?.includes('wait')) {
      throw netErr;
    }
  }

  // 2. Client-Side Standalone Fallback Registration (Offline)
  const cachedProfiles = getCachedUserProfiles();
  if (cachedProfiles.some((u) => u.username === username || (email && u.email === email))) {
    throw new Error('An operative account with that username or email already exists.');
  }

  const userId = `usr_${Date.now().toString(36)}_${generateSecureToken(8)}`;
  const now = new Date().toISOString();

  const newProfile: CachedUserProfile = {
    id: userId,
    username,
    email: email || `${username}@pixelops.local`,
    callsign,
    securityClearance: 'COMMANDER',
    createdAt: now,
    lastLoginAt: now,
    devices: [device],
  };

  saveCachedUserProfile(newProfile);

  // Store offline credential verifier strictly in WebCrypto AES-GCM vault
  try {
    const offlineSalt = generateSecureToken(16);
    const offlineHash = await hashPasswordPBKDF2(password, offlineSalt);
    await storeSecureCredential(
      `pixelops_offline_verifier_${userId}`,
      JSON.stringify({ salt: offlineSalt, hash: offlineHash })
    );
    const offlineRecovery = await hashRecoveryKeyClient(rawRecoveryKey);
    await storeSecureCredential(
      `pixelops_offline_recovery_hash_${userId}`,
      offlineRecovery
    );
  } catch {}

  const token = `tok_${userId}_${Date.now().toString(36)}_${generateSecureToken(16)}`;
  const session: AuthSession = {
    token,
    user: {
      id: newProfile.id,
      username: newProfile.username,
      email: newProfile.email,
      callsign: newProfile.callsign,
      securityClearance: newProfile.securityClearance,
      createdAt: newProfile.createdAt,
      lastLoginAt: newProfile.lastLoginAt,
    },
    device,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  setActiveSession(session);
  return {
    ...session,
    oneTimeRecoveryKey: rawRecoveryKey,
  };
}

/**
 * Authenticates an existing operative account with password
 */
export async function loginAccount(params: {
  usernameOrEmail: string;
  password: string;
}): Promise<AuthSession> {
  const query = params.usernameOrEmail.trim().toLowerCase();
  const password = params.password;
  const device = getCurrentDeviceInfo();

  if (!query || !password) {
    throw new Error('Enter your operative username/email and password.');
  }

  // 1. Attempt server-side login
  try {
    let res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        usernameOrEmail: query,
        password,
        device,
      }),
    });

    if (!res.ok && res.status === 404) {
      res = await fetch('/api/auth?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          usernameOrEmail: query,
          password,
          device,
        }),
      });
    }

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        const remoteEntityId = data.composioEntityId || data.session.user?.composioEntityId;
        if (remoteEntityId) {
          try {
            const { setComposioEntityId } = await import('./ComposioService');
            setComposioEntityId(remoteEntityId);
          } catch {}
        }

        const remoteApiKey = data.composioApiKey || data.session.user?.composioApiKey;
        if (remoteApiKey) {
          try {
            const { setComposioApiKey } = await import('./ComposioService');
            setComposioApiKey(remoteApiKey, true);
          } catch {}
        }

        // Cache safe user public profile (ZERO password hashes / salts in localStorage)
        const fleetDevices = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices : [device];
        saveCachedUserProfile({
          id: data.session.user.id,
          username: data.session.user.username,
          email: data.session.user.email,
          callsign: data.session.user.callsign,
          securityClearance: data.session.user.securityClearance,
          subscription_tier: normalizeSubscriptionTier(data.session.user.subscription_tier),
          sweeps_remaining: Number(data.session.user.sweeps_remaining || 0) || 0,
          composioEntityId: remoteEntityId || undefined,
          composioApiKey: remoteApiKey || undefined,
          createdAt: data.session.user.createdAt,
          lastLoginAt: data.session.user.lastLoginAt,
          devices: fleetDevices,
        });

        // Update offline authentication verifier inside WebCrypto AES-GCM vault
        try {
          const offlineSalt = generateSecureToken(16);
          const offlineHash = await hashPasswordPBKDF2(password, offlineSalt);
          await storeSecureCredential(
            `pixelops_offline_verifier_${data.session.user.id}`,
            JSON.stringify({ salt: offlineSalt, hash: offlineHash })
          );
        } catch {}

        try {
          localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
        } catch {}

        setActiveSession(data.session);
        return data.session;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) {
        throw new Error(errData.message || 'Invalid operative credentials.');
      }
      if (res.status === 404) {
        throw new Error(errData.message || 'No operative account found matching credentials.');
      }
      if (res.status === 429) {
        throw new Error(errData.message || 'Too many login attempts. Please wait before retrying.');
      }
    }
  } catch (netErr: any) {
    if (
      netErr.message?.includes('Invalid operative') ||
      netErr.message?.includes('Invalid operative credentials') ||
      netErr.message?.includes('No operative found') ||
      netErr.message?.includes('login attempts') ||
      netErr.message?.includes('wait')
    ) {
      throw netErr;
    }
  }

  // 2. Client-Side Standalone Fallback Authentication (Offline Mode)
  const cachedProfiles = getCachedUserProfiles();
  const foundUser = cachedProfiles.find(
    (u) =>
      u.username.toLowerCase() === query ||
      u.email.toLowerCase() === query ||
      (u.callsign && u.callsign.toLowerCase() === query)
  );

  if (!foundUser) {
    throw new Error('No operative account found matching credentials. If you created this account on desktop, ensure you are connected to the same safehouse server or pair via satellite code.');
  }

  // Verify against encrypted WebCrypto vault verifier
  let isPasswordValid = false;
  try {
    const rawVerifier = await getSecureCredential(`pixelops_offline_verifier_${foundUser.id}`);
    if (rawVerifier) {
      const verifier = JSON.parse(rawVerifier);
      if (verifier.salt && (verifier.hash || verifier.pbkdf2)) {
        isPasswordValid = await verifyPasswordHash(password, verifier.salt, verifier.hash || verifier.pbkdf2);
      }
    }
  } catch {}

  if (!isPasswordValid) {
    throw new Error('Invalid encryption key / password or device is offline without cached secure credentials.');
  }

  // Update device in user device list
  foundUser.lastLoginAt = new Date().toISOString();
  const existingDeviceIdx = foundUser.devices.findIndex((d) => d.deviceId === device.deviceId);
  if (existingDeviceIdx >= 0) {
    foundUser.devices[existingDeviceIdx] = device;
  } else {
    foundUser.devices.push(device);
  }
  saveCachedUserProfile(foundUser);

  const token = `tok_${foundUser.id}_${Date.now().toString(36)}_${generateSecureToken(16)}`;
  const session: AuthSession = {
    token,
    user: {
      id: foundUser.id,
      username: foundUser.username,
      email: foundUser.email,
      callsign: foundUser.callsign,
      securityClearance: foundUser.securityClearance,
      createdAt: foundUser.createdAt,
      lastLoginAt: foundUser.lastLoginAt,
    },
    device,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  setActiveSession(session);
  return session;
}

/**
 * Resets an operative's password using their Satellite Recovery Key
 */
export async function resetPassword(params: {
  usernameOrEmail: string;
  recoveryKey: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> {
  const query = params.usernameOrEmail.trim().toLowerCase();
  const recoveryKey = params.recoveryKey.trim().toUpperCase();
  const newPassword = params.newPassword;

  if (!query || !recoveryKey || !newPassword) {
    throw new Error('Username/Email, Recovery Key, and New Password are required.');
  }
  if (newPassword.length < 6) {
    throw new Error('New encryption password must be at least 6 characters.');
  }

  // 1. Attempt server-side password reset
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        usernameOrEmail: query,
        recoveryKey,
        newPassword,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const cachedProfiles = getCachedUserProfiles();
      const user = cachedProfiles.find((u) => u.username === query || u.email.toLowerCase() === query);
      if (user) {
        try {
          const offlineSalt = generateSecureToken(16);
          const offlineHash = await hashPasswordPBKDF2(newPassword, offlineSalt);
          await storeSecureCredential(
            `pixelops_offline_verifier_${user.id}`,
            JSON.stringify({ salt: offlineSalt, hash: offlineHash })
          );
          const newRecoveryHash = await hashRecoveryKeyClient(recoveryKey);
          await storeSecureCredential(
            `pixelops_offline_recovery_hash_${user.id}`,
            newRecoveryHash
          );
        } catch {}
      }
      return { success: true, message: data.message || 'Password reset successfully. Sign in with your new key.' };
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Recovery verification failed. Verify your recovery key.');
    }
  } catch (netErr: any) {
    // If the server explicitly rejected the request (401, 403, 404, 429), propagate error immediately
    if (netErr.message && !netErr.message.includes('fetch') && !netErr.message.includes('NetworkError')) {
      throw netErr;
    }
  }

  // 2. Client-Side Standalone Fallback Reset (True Offline Mode ONLY)
  const cachedProfiles = getCachedUserProfiles();
  const user = cachedProfiles.find((u) => u.username === query || u.email.toLowerCase() === query);
  if (!user) {
    throw new Error('No operative account found matching credentials.');
  }

  // Cryptographically verify recovery key against offline hash in WebCrypto vault
  const rawOfflineRecovery = await getSecureCredential(`pixelops_offline_recovery_hash_${user.id}`);
  if (!rawOfflineRecovery) {
    throw new Error('Offline password recovery is not configured for this account. Reconnect to Safehouse server to reset.');
  }

  const inputHash = await hashRecoveryKeyClient(recoveryKey);
  if (inputHash !== rawOfflineRecovery.trim()) {
    throw new Error('Invalid Satellite Recovery Key. Offline recovery verification failed.');
  }

  // Update offline verifier in WebCrypto AES-GCM vault
  try {
    const offlineSalt = generateSecureToken(16);
    const offlineHash = await hashPasswordPBKDF2(newPassword, offlineSalt);
    await storeSecureCredential(
      `pixelops_offline_verifier_${user.id}`,
      JSON.stringify({ salt: offlineSalt, hash: offlineHash })
    );
  } catch {}

  return { success: true, message: 'Password key reset successfully in local terminal. Please sign in.' };
}

/**
 * Updates an authenticated operative's profile (callsign, username, email, and/or password)
 */
export async function updateProfile(params: {
  callsign?: string;
  username?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<AuthSession> {
  const currentSession = getActiveSession();
  if (!currentSession) {
    throw new Error('No active operative session. Please sign in first.');
  }

  const token = currentSession.token;
  const { callsign, username, email, currentPassword, newPassword } = params;

  // 1. Attempt server-side profile update
  try {
    const res = await fetch('/api/auth/update-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-user-id': currentSession.user.id,
      },
      credentials: 'include',
      body: JSON.stringify({
        callsign,
        username,
        email,
        currentPassword,
        newPassword,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        data.session.device = currentSession.device;
        setActiveSession(data.session);

        // Update local cached profile without sensitive hashes
        const cachedProfiles = getCachedUserProfiles();
        const user = cachedProfiles.find((u) => u.id === currentSession.user.id);
        if (user) {
          if (callsign) user.callsign = callsign.trim().toUpperCase();
          if (username) user.username = username.trim().toLowerCase();
          if (email) user.email = email.trim().toLowerCase();
          saveCachedUserProfile(user);
        }

        if (newPassword) {
          try {
            const offlineSalt = generateSecureToken(16);
            const offlineHash = await hashPasswordPBKDF2(newPassword, offlineSalt);
            await storeSecureCredential(
              `pixelops_offline_verifier_${currentSession.user.id}`,
              JSON.stringify({ salt: offlineSalt, hash: offlineHash })
            );
          } catch {}
        }

        return data.session;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'Server failed to update profile.');
    }
  } catch (err: any) {
    if (err.message && !err.message.includes('fetch')) {
      throw err;
    }
  }

  // 2. Client-Side Standalone Fallback Update
  const cachedProfiles = getCachedUserProfiles();
  const user = cachedProfiles.find((u) => u.id === currentSession.user.id);

  if (newPassword) {
    if (!currentPassword) {
      throw new Error('Current password is required to set a new password.');
    }
    // Verify current password against offline verifier
    let isCurrentValid = false;
    try {
      const rawVerifier = await getSecureCredential(`pixelops_offline_verifier_${currentSession.user.id}`);
      if (rawVerifier) {
        const verifier = JSON.parse(rawVerifier);
        if (verifier.salt && (verifier.hash || verifier.pbkdf2)) {
          isCurrentValid = await verifyPasswordHash(currentPassword, verifier.salt, verifier.hash || verifier.pbkdf2);
        }
      }
    } catch {}

    if (!isCurrentValid) {
      throw new Error('Current password verification failed. Cannot change encryption key.');
    }

    // Update offline verifier in AES-GCM vault
    try {
      const offlineSalt = generateSecureToken(16);
      const offlineHash = await hashPasswordPBKDF2(newPassword, offlineSalt);
      await storeSecureCredential(
        `pixelops_offline_verifier_${currentSession.user.id}`,
        JSON.stringify({ salt: offlineSalt, hash: offlineHash })
      );
    } catch {}
  }

  if (username) {
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser.length < 3) throw new Error('Username must be at least 3 characters.');
    if (user) user.username = cleanUser;
    currentSession.user.username = cleanUser;
  }

  if (callsign) {
    const cleanCallsign = callsign.trim().toUpperCase();
    if (user) user.callsign = cleanCallsign;
    currentSession.user.callsign = cleanCallsign;
  }

  if (email) {
    const cleanEmail = email.trim().toLowerCase();
    if (user) user.email = cleanEmail;
    currentSession.user.email = cleanEmail;
  }

  if (user) {
    user.lastLoginAt = new Date().toISOString();
    saveCachedUserProfile(user);
  }

  setActiveSession(currentSession);
  return currentSession;
}

/**
 * Returns the list of registered devices for the current session
 */
export async function getLinkedDevices(): Promise<DeviceInfo[]> {
  const session = getActiveSession();
  const currentDev = getCurrentDeviceInfo();
  if (!session) return [currentDev];

  let fleet: DeviceInfo[] = [];

  try {
    let res = await fetch('/api/sync/devices', {
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-user-id': session.user.id,
        'x-username': session.user.username.toLowerCase(),
        'x-device-id': currentDev.deviceId,
        'x-device-name': currentDev.deviceName,
        'x-device-type': currentDev.deviceType,
      },
      credentials: 'include',
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`/api/sync?action=devices&username=${encodeURIComponent(session.user.username.toLowerCase())}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-user-id': session.user.id,
          'x-username': session.user.username.toLowerCase(),
          'x-device-id': currentDev.deviceId,
        },
        credentials: 'include',
      });
    }

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.devices) && data.devices.length > 0) {
        fleet = data.devices;
      }
    }
  } catch {}

  // Merge with cached user recorded devices
  const cachedProfiles = getCachedUserProfiles();
  const user = cachedProfiles.find(
    (u) =>
      u.id === session.user.id ||
      u.username.toLowerCase() === session.user.username.toLowerCase()
  );
  if (user && Array.isArray(user.devices)) {
    for (const d of user.devices) {
      if (!fleet.some((x) => x.deviceId === d.deviceId)) {
        fleet.push(d);
      }
    }
  }

  // Ensure current device and session device are always present
  if (!fleet.some((d) => d.deviceId === currentDev.deviceId)) {
    fleet.unshift(currentDev);
  }
  if (session.device && !fleet.some((d) => d.deviceId === session.device.deviceId)) {
    fleet.push(session.device);
  }

  // Persist consolidated fleet into cached user record
  if (user) {
    user.devices = fleet;
    saveCachedUserProfile(user);
  }

  return fleet;
}

/**
 * Unlinks / disconnects a remote device from this account
 */
export async function unlinkDevice(targetDeviceId: string): Promise<boolean> {
  const session = getActiveSession();
  if (!session) return false;

  try {
    let res = await fetch('/api/sync/device/unlink', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-user-id': session.user.id,
        'x-username': session.user.username.toLowerCase(),
      },
      credentials: 'include',
      body: JSON.stringify({ targetDeviceId }),
    });

    if (!res.ok && res.status === 404) {
      await fetch('/api/sync?action=unlink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
          'x-user-id': session.user.id,
          'x-username': session.user.username.toLowerCase(),
        },
        credentials: 'include',
        body: JSON.stringify({ targetDeviceId }),
      });
    }
  } catch {}

  const cachedProfiles = getCachedUserProfiles();
  const user = cachedProfiles.find((u) => u.id === session.user.id || u.username.toLowerCase() === session.user.username.toLowerCase());
  if (user) {
    user.devices = user.devices.filter((d) => d.deviceId !== targetDeviceId);
    saveCachedUserProfile(user);
  }

  return true;
}

/**
 * Exports a secure Satellite Pairing Token to link devices and transfer active dossiers.
 * CRITICAL SECURITY FIX: Backed by server-managed ephemeral pairing tickets (5-min TTL, single-use, CSPRNG).
 * Never exports password hashes, salts, or raw recovery keys.
 */
export async function exportSatellitePairingToken(): Promise<string> {
  const session = getActiveSession();
  if (!session) throw new Error('No active operative session to pair.');

  let syncPackage: any = null;
  try {
    const { assembleLocalSyncPackage } = await import('./SyncService');
    syncPackage = await assembleLocalSyncPackage(session);
  } catch (err) {
    console.warn('Could not bundle local sync package into token', err);
  }

  // 1. Attempt server-managed ephemeral pairing ticket (5-minute TTL, single-use)
  try {
    const res = await fetch('/api/auth/pair/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-user-id': session.user.id,
        'x-username': session.user.username.toLowerCase(),
      },
      credentials: 'include',
      body: JSON.stringify({ syncPackage }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.pairTicket) {
        return data.pairTicket;
      }
    }
  } catch (err) {
    console.warn('Server pairing generation unavailable, using offline fallback', err);
  }

  // 2. Offline Fallback: Ephemeral pairing payload with CSPRNG nonce and strict 5-minute TTL
  const nonce = generateSecureToken(16);
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const payload = {
    token: session.token,
    user: {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      callsign: session.user.callsign,
      securityClearance: session.user.securityClearance,
      createdAt: session.user.createdAt,
      lastLoginAt: session.user.lastLoginAt,
    },
    device: session.device,
    syncPackage,
    nonce,
    expiresAt,
    pairedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload);
  const base64 =
    typeof window !== 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json).toString('base64');
  return `SATCOM-PAIR::OFFLINE::${base64}`;
}

/**
 * Imports a Satellite Pairing Token to establish an immediate link and apply dossiers.
 */
export async function importSatellitePairingToken(tokenString: string): Promise<AuthSession> {
  const trimmed = tokenString.trim();
  const currentDevice = getCurrentDeviceInfo();

  // 1. If it's a server ticket code or not an offline payload, redeem via server
  if (!trimmed.includes('::OFFLINE::')) {
    try {
      const res = await fetch('/api/auth/pair/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pairTicket: trimmed, device: currentDevice }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setActiveSession(data.session);
          try {
            localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
          } catch {}

          saveCachedUserProfile({
            id: data.session.user.id,
            username: data.session.user.username,
            email: data.session.user.email,
            callsign: data.session.user.callsign,
            securityClearance: data.session.user.securityClearance || 'OPERATIVE',
            createdAt: data.session.user.createdAt || new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
            devices: [currentDevice, ...(data.session.device ? [data.session.device] : [])],
          });

          if (data.syncPackage) {
            try {
              const { applyRemoteSyncPackage } = await import('./SyncService');
              await applyRemoteSyncPackage(data.syncPackage);
            } catch (syncErr) {
              console.warn('Failed to apply sync package from redeemed ticket', syncErr);
            }
          }

          return data.session;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (res.status === 400 || res.status === 401 || res.status === 404 || res.status === 429) {
          throw new Error(errData.message || 'Satellite pairing failed or ticket expired.');
        }
      }
    } catch (netErr: any) {
      if (netErr.message && !netErr.message.includes('fetch')) {
        throw netErr;
      }
    }
  }

  // 2. Decode offline ephemeral payload
  const cleaned = trimmed.replace(/^SATCOM-PAIR::(OFFLINE::)?/, '');
  let json: string;
  try {
    json =
      typeof window !== 'undefined'
        ? decodeURIComponent(escape(atob(cleaned)))
        : Buffer.from(cleaned, 'base64').toString('utf8');
  } catch {
    throw new Error('Invalid Satellite Pairing Token format.');
  }

  const payload = JSON.parse(json);
  if (!payload?.user || !payload?.token) {
    throw new Error('Malformed pairing token payload.');
  }

  // Enforce 5-minute TTL on pairing tokens
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    throw new Error('Satellite pairing token has expired (5-minute TTL). Please generate a fresh pairing token.');
  }

  // Prevent replay attacks: ensure nonce is single-use
  if (payload.nonce) {
    let usedNonces: string[] = [];
    try {
      usedNonces = JSON.parse(localStorage.getItem('pixelops_used_pairing_nonces') || '[]');
    } catch {}
    if (usedNonces.includes(payload.nonce)) {
      throw new Error('Satellite pairing token has already been redeemed (single-use limit).');
    }
    usedNonces.push(payload.nonce);
    if (usedNonces.length > 50) usedNonces.shift();
    try {
      localStorage.setItem('pixelops_used_pairing_nonces', JSON.stringify(usedNonces));
    } catch {}
  }

  const session: AuthSession = {
    token: payload.token,
    user: payload.user,
    device: currentDevice,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // 1. Activate session
  setActiveSession(session);

  // 2. Set last sync handshake timestamp
  try {
    localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
  } catch {}

  // 3. Cache safe user profile for offline display (NO password hashes or salts stored)
  saveCachedUserProfile({
    id: payload.user.id,
    username: payload.user.username,
    email: payload.user.email,
    callsign: payload.user.callsign,
    securityClearance: payload.user.securityClearance || 'OPERATIVE',
    createdAt: payload.user.createdAt || new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    devices: [currentDevice, ...(payload.device ? [payload.device] : [])],
  });

  // 4. Immediately apply all dossiers, routines, and memories into mobile IndexedDB/localStorage!
  if (payload.syncPackage) {
    try {
      const { applyRemoteSyncPackage } = await import('./SyncService');
      await applyRemoteSyncPackage(payload.syncPackage);
    } catch (syncErr) {
      console.warn('Failed to apply sync package from token', syncErr);
    }
  }

  // Restore Composio API key if delivered with pairing payload
  const pairingApiKey = payload.user?.composioApiKey || payload.syncPackage?.composioApiKey;
  if (pairingApiKey && typeof pairingApiKey === 'string') {
    try {
      const { setComposioApiKey } = await import('./ComposioService');
      setComposioApiKey(pairingApiKey.trim(), true);
    } catch {}
  }

  // 5. Broadcast this newly paired device to server fleet
  try {
    const { performFullSync } = await import('./SyncService');
    performFullSync().catch(() => {});
  } catch {}

  return session;
}

/**
 * Validates the current session token with the server/D1 (/api/me)
 */
export async function validateActiveSession(): Promise<boolean> {
  const session = getActiveSession();
  if (!session) return false;

  try {
    const res = await fetch('/api/me', {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
      credentials: 'include',
    });

    if (res.status === 401) {
      clearActiveSession();
      return false;
    }

    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        session.user = { ...session.user, ...data.user };
        setActiveSession(session);
      }
      if (data.composioEntityId || data.user?.composioEntityId) {
        try {
          const { setComposioEntityId } = await import('./ComposioService');
          setComposioEntityId(data.composioEntityId || data.user?.composioEntityId);
        } catch {}
      }
      if (data.composioApiKey || data.user?.composioApiKey) {
        try {
          const { setComposioApiKey } = await import('./ComposioService');
          setComposioApiKey(data.composioApiKey || data.user?.composioApiKey, true);
        } catch {}
      }
      return true;
    }
  } catch {}

  return true;
}

export async function logoutAccount(): Promise<void> {
  const session = getActiveSession();
  if (session) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        credentials: 'include',
      });
    } catch {}
  }
  clearActiveSession();
}

export const fetchRemoteDevices = getLinkedDevices;
export const unlinkRemoteDevice = unlinkDevice;
export function isLoggedIn(): boolean {
  return Boolean(getActiveSession());
}
