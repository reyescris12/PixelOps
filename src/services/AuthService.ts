/**
 * AuthService.ts
 * 
 * Cryptographic User Authentication & Device Identity Service for PixelOps.
 * Provides client-side and server-backed user registration, salted SHA-256 password hashing,
 * session token management, and multi-device identity tracking.
 */

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  callsign: string;
  securityClearance: 'OPERATIVE' | 'COMMANDER' | 'DIRECTOR';
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

const STORAGE_AUTH_SESSION = 'pixelops_auth_session_v1';
const STORAGE_DEVICE_ID = 'pixelops_device_id_v1';
const STORAGE_LOCAL_USERS = 'pixelops_auth_local_users_v1';

/**
 * Computes a secure SHA-256 hash with user salt using the browser Web Crypto API
 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}:pixelops_satcom_secret`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a stable unique device identifier for this browser instance
 */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_DEVICE_ID);
    if (!id) {
      const type = getDeviceType();
      const rand = Math.random().toString(36).substring(2, 10);
      id = `dev_${type}_${Date.now().toString(36)}_${rand}`;
      localStorage.setItem(STORAGE_DEVICE_ID, id);
    }
    return id;
  } catch {
    return 'dev_unknown_' + Math.random().toString(36).substring(2, 8);
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
  const typeLabel = type === 'mobile' ? 'Mobile' : type === 'tablet' ? 'Tablet' : 'Desktop';
  return `${os} (${browser}) • ${typeLabel}`;
}

/**
 * Returns complete metadata for the current device
 */
export function getCurrentDeviceInfo(): DeviceInfo {
  return {
    deviceId: getOrCreateDeviceId(),
    deviceName: getDeviceName(),
    deviceType: getDeviceType(),
    platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'web',
    lastActive: new Date().toISOString(),
    isCurrent: true,
  };
}

/**
 * Loads the currently authenticated session from storage
 */
export function getActiveSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (!session || !session.token || !session.user) return null;

    // Check expiration (30 days default)
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      clearActiveSession();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Stores the active authenticated session
 */
export function setActiveSession(session: AuthSession): void {
  try {
    localStorage.setItem(STORAGE_AUTH_SESSION, JSON.stringify(session));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pixelops:auth-changed', { detail: { session, isAuthenticated: true } })
      );
    }
  } catch {}
}

/**
 * Clears the active session (Logout)
 */
export function clearActiveSession(): void {
  try {
    localStorage.removeItem(STORAGE_AUTH_SESSION);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pixelops:auth-changed', { detail: { session: null, isAuthenticated: false } })
      );
    }
  } catch {}
}

/**
 * Helper to get local stored users when in offline / standalone mode
 */
interface LocalUserRecord {
  id: string;
  username: string;
  email: string;
  callsign: string;
  salt: string;
  passwordHash: string;
  securityClearance: 'OPERATIVE' | 'COMMANDER' | 'DIRECTOR';
  createdAt: string;
  lastLoginAt: string;
  devices: DeviceInfo[];
}

function getLocalUsers(): LocalUserRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_LOCAL_USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalUsers(users: LocalUserRecord[]): void {
  try {
    localStorage.setItem(STORAGE_LOCAL_USERS, JSON.stringify(users));
  } catch {}
}

/**
 * Registers a new account with email/username and password
 */
export async function registerAccount(params: {
  username: string;
  email: string;
  password: string;
  callsign?: string;
}): Promise<AuthSession> {
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

  // 1. Attempt server-side API registration first
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        callsign,
        device,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        return data.session;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 409 || errData.message?.includes('already exists')) {
        throw new Error(errData.message || 'An operative with that username or email already exists.');
      }
      // If server returns other error, fall back to robust local client authentication
    }
  } catch (netErr: any) {
    if (netErr.message?.includes('already exists')) {
      throw netErr;
    }
    // Network offline or serverless fallback
  }

  // 2. Client-Side Standalone Fallback Registration
  const localUsers = getLocalUsers();
  if (localUsers.some((u) => u.username === username || (email && u.email === email))) {
    throw new Error('An operative account with that username or email already exists.');
  }

  const salt = Math.random().toString(36).substring(2, 14);
  const passwordHash = await hashPassword(password, salt);
  const userId = `usr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();

  const newUser: LocalUserRecord = {
    id: userId,
    username,
    email: email || `${username}@pixelops.local`,
    callsign,
    salt,
    passwordHash,
    securityClearance: 'COMMANDER',
    createdAt: now,
    lastLoginAt: now,
    devices: [device],
  };

  localUsers.push(newUser);
  saveLocalUsers(localUsers);

  const token = `tok_${userId}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
  const session: AuthSession = {
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      callsign: newUser.callsign,
      securityClearance: newUser.securityClearance,
      createdAt: newUser.createdAt,
      lastLoginAt: newUser.lastLoginAt,
    },
    device,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  setActiveSession(session);
  return session;
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
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernameOrEmail: query,
        password,
        device,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        setActiveSession(data.session);
        return data.session;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401) {
        throw new Error(errData.message || 'Invalid operative credentials or password.');
      }
    }
  } catch (netErr: any) {
    if (netErr.message?.includes('Invalid operative credentials')) {
      throw netErr;
    }
    // Network offline or fallback to local database
  }

  // 2. Client-Side Standalone Fallback Authentication
  const localUsers = getLocalUsers();
  const foundUser = localUsers.find(
    (u) => u.username === query || u.email.toLowerCase() === query
  );

  if (!foundUser) {
    throw new Error('No operative account found matching those credentials.');
  }

  const computedHash = await hashPassword(password, foundUser.salt);
  if (computedHash !== foundUser.passwordHash) {
    throw new Error('Invalid encryption key / password.');
  }

  // Update device in user device list
  foundUser.lastLoginAt = new Date().toISOString();
  const existingDeviceIdx = foundUser.devices.findIndex((d) => d.deviceId === device.deviceId);
  if (existingDeviceIdx >= 0) {
    foundUser.devices[existingDeviceIdx] = device;
  } else {
    foundUser.devices.push(device);
  }
  saveLocalUsers(localUsers);

  const token = `tok_${foundUser.id}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 12)}`;
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
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  setActiveSession(session);
  return session;
}

/**
 * Returns the list of registered devices for the current session
 */
export async function getLinkedDevices(): Promise<DeviceInfo[]> {
  const session = getActiveSession();
  if (!session) return [getCurrentDeviceInfo()];

  try {
    const res = await fetch('/api/sync/devices', {
      headers: {
        Authorization: `Bearer ${session.token}`,
        'x-user-id': session.user.id,
        'x-device-id': session.device.deviceId,
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.devices)) {
        return data.devices.map((d: DeviceInfo) => ({
          ...d,
          isCurrent: d.deviceId === session.device.deviceId,
        }));
      }
    }
  } catch {}

  // Fallback to local users registry
  const localUsers = getLocalUsers();
  const user = localUsers.find((u) => u.id === session.user.id);
  if (user && Array.isArray(user.devices)) {
    return user.devices.map((d) => ({
      ...d,
      isCurrent: d.deviceId === session.device.deviceId,
    }));
  }

  return [session.device];
}

/**
 * Unlinks / disconnects a remote device from this account
 */
export async function unlinkDevice(targetDeviceId: string): Promise<boolean> {
  const session = getActiveSession();
  if (!session) return false;

  try {
    await fetch('/api/sync/device/unlink', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        'x-user-id': session.user.id,
      },
      body: JSON.stringify({ targetDeviceId }),
    });
  } catch {}

  const localUsers = getLocalUsers();
  const user = localUsers.find((u) => u.id === session.user.id);
  if (user) {
    user.devices = user.devices.filter((d) => d.deviceId !== targetDeviceId);
    saveLocalUsers(localUsers);
  }

  return true;
}

export const logoutAccount = clearActiveSession;
export const fetchRemoteDevices = getLinkedDevices;
export const unlinkRemoteDevice = unlinkDevice;
export function isLoggedIn(): boolean {
  return Boolean(getActiveSession());
}
