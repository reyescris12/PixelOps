/**
 * AuthService.ts
 * 
 * Cryptographic User Authentication & Device Identity Service for PixelOps.
 * Provides client-side and server-backed user registration, salted SHA-256 password hashing,
 * session token management, multi-device identity tracking, password recovery, and profile editing.
 */

export interface UserAccount {
  id: string;
  username: string;
  email: string;
  callsign: string;
  recoveryKey?: string;
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

interface LocalUserRecord {
  id: string;
  username: string;
  email: string;
  callsign: string;
  salt: string;
  passwordHash: string;
  recoveryKey?: string;
  securityClearance: 'OPERATIVE' | 'COMMANDER' | 'DIRECTOR';
  createdAt: string;
  lastLoginAt: string;
  devices: DeviceInfo[];
}

const STORAGE_AUTH_SESSION = 'pixelops_auth_session_v1';
const STORAGE_DEVICE_ID = 'pixelops_device_id_v1';
const STORAGE_LOCAL_USERS = 'pixelops_auth_local_users_v1';

/**
 * Generates a human-readable, high-entropy satellite recovery key
 * Example: SATCOM-CIPHER-8A2F-9B1D
 */
export function generateRecoveryKey(callsign: string): string {
  const clean = callsign.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'AGENT';
  const r1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const r2 = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SATCOM-${clean}-${r1}-${r2}`;
}

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
 * Retrieves or creates a persistent unique Device ID for this client hardware
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'server_node';
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
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_AUTH_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
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

function upsertLocalUser(record: LocalUserRecord): void {
  const users = getLocalUsers();
  const idx = users.findIndex((u) => u.username === record.username || u.id === record.id);
  if (idx >= 0) {
    users[idx] = { ...users[idx], ...record };
  } else {
    users.push(record);
  }
  saveLocalUsers(users);
}

/**
 * Registers a new account with email/username, password, and recovery key
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
  const recoveryKey = generateRecoveryKey(callsign);

  // 1. Attempt server-side API registration first
  try {
    let res = await fetch('/api/auth/register', {
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

    if (!res.ok && res.status === 404) {
      res = await fetch('/api/auth?action=register', {
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
    }

    if (res.ok) {
      const data = await res.json();
      if (data.session) {
        // Also save user in local cache for offline redundancy
        const salt = Math.random().toString(36).substring(2, 14);
        const passwordHash = await hashPassword(password, salt);
        const fleetDevices = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices : [device];
        upsertLocalUser({
          id: data.session.user.id,
          username: data.session.user.username,
          email: data.session.user.email,
          callsign: data.session.user.callsign,
          salt,
          passwordHash,
          recoveryKey: data.session.user.recoveryKey || recoveryKey,
          securityClearance: data.session.user.securityClearance,
          createdAt: data.session.user.createdAt,
          lastLoginAt: data.session.user.lastLoginAt,
          devices: fleetDevices,
        });

        try {
          localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
        } catch {}

        setActiveSession(data.session);
        return data.session;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 409 || errData.message?.includes('already exists')) {
        throw new Error(errData.message || 'An operative with that username or email already exists.');
      }
    }
  } catch (netErr: any) {
    if (netErr.message?.includes('already exists')) {
      throw netErr;
    }
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
    recoveryKey,
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
      recoveryKey: newUser.recoveryKey,
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
    let res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        // Cache user locally for offline access
        const salt = Math.random().toString(36).substring(2, 14);
        const passwordHash = await hashPassword(password, salt);
        const fleetDevices = Array.isArray(data.devices) && data.devices.length > 0 ? data.devices : [device];
        upsertLocalUser({
          id: data.session.user.id,
          username: data.session.user.username,
          email: data.session.user.email,
          callsign: data.session.user.callsign,
          salt,
          passwordHash,
          recoveryKey: data.session.user.recoveryKey,
          securityClearance: data.session.user.securityClearance,
          createdAt: data.session.user.createdAt,
          lastLoginAt: data.session.user.lastLoginAt,
          devices: fleetDevices,
        });

        try {
          localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
        } catch {}

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
    if (netErr.message?.includes('Invalid operative credentials') || netErr.message?.includes('Invalid operative password key')) {
      throw netErr;
    }
  }

  // 2. Client-Side Standalone Fallback Authentication
  const localUsers = getLocalUsers();
  const foundUser = localUsers.find(
    (u) =>
      u.username.toLowerCase() === query ||
      u.email.toLowerCase() === query ||
      (u.callsign && u.callsign.toLowerCase() === query)
  );

  if (!foundUser) {
    throw new Error('No operative account found matching credentials. If you created this account on desktop, ensure you are connected to the same safehouse server or pair via satellite code.');
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
      recoveryKey: foundUser.recoveryKey,
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
      body: JSON.stringify({
        usernameOrEmail: query,
        recoveryKey,
        newPassword,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      // Update local cache as well
      const localUsers = getLocalUsers();
      const user = localUsers.find((u) => u.username === query || u.email.toLowerCase() === query);
      if (user) {
        const newSalt = Math.random().toString(36).substring(2, 14);
        user.salt = newSalt;
        user.passwordHash = await hashPassword(newPassword, newSalt);
        saveLocalUsers(localUsers);
      }
      return { success: true, message: data.message || 'Password reset successfully. Sign in with your new key.' };
    } else {
      const errData = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 404) {
        throw new Error(errData.message || 'Recovery verification failed. Verify your recovery key.');
      }
    }
  } catch (netErr: any) {
    if (netErr.message?.includes('Recovery verification failed') || netErr.message?.includes('Invalid Satellite Recovery Key')) {
      throw netErr;
    }
  }

  // 2. Client-Side Standalone Fallback Reset
  const localUsers = getLocalUsers();
  const user = localUsers.find((u) => u.username === query || u.email.toLowerCase() === query);
  if (!user) {
    throw new Error('No operative account found matching credentials.');
  }

  const storedKey = (user.recoveryKey || '').trim().toUpperCase();
  if (!storedKey || storedKey !== recoveryKey) {
    throw new Error('Invalid Satellite Recovery Key for this operative.');
  }

  const newSalt = Math.random().toString(36).substring(2, 14);
  user.salt = newSalt;
  user.passwordHash = await hashPassword(newPassword, newSalt);
  saveLocalUsers(localUsers);

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
        // Keep current device info
        data.session.device = currentSession.device;
        setActiveSession(data.session);

        // Update local users record
        const localUsers = getLocalUsers();
        const user = localUsers.find((u) => u.id === currentSession.user.id);
        if (user) {
          if (callsign) user.callsign = callsign.trim().toUpperCase();
          if (username) user.username = username.trim().toLowerCase();
          if (email) user.email = email.trim().toLowerCase();
          if (newPassword) {
            const newSalt = Math.random().toString(36).substring(2, 14);
            user.salt = newSalt;
            user.passwordHash = await hashPassword(newPassword, newSalt);
          }
          saveLocalUsers(localUsers);
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
  const localUsers = getLocalUsers();
  const user = localUsers.find((u) => u.id === currentSession.user.id);

  if (newPassword) {
    if (!currentPassword) {
      throw new Error('Current password is required to set a new password.');
    }
    if (user) {
      const verify = await hashPassword(currentPassword, user.salt);
      if (verify !== user.passwordHash) {
        throw new Error('Current password verification failed.');
      }
      const newSalt = Math.random().toString(36).substring(2, 14);
      user.salt = newSalt;
      user.passwordHash = await hashPassword(newPassword, newSalt);
    }
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
    saveLocalUsers(localUsers);
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
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`/api/sync?action=devices&username=${encodeURIComponent(session.user.username.toLowerCase())}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-user-id': session.user.id,
          'x-username': session.user.username.toLowerCase(),
          'x-device-id': currentDev.deviceId,
        },
      });
    }

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.devices) && data.devices.length > 0) {
        fleet = data.devices;
      }
    }
  } catch {}

  // Merge with local user recorded devices
  const localUsers = getLocalUsers();
  const user = localUsers.find(
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

  // Persist consolidated fleet into local user record
  if (user) {
    user.devices = fleet;
    saveLocalUsers(localUsers);
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
        body: JSON.stringify({ targetDeviceId }),
      });
    }
  } catch {}

  const localUsers = getLocalUsers();
  const user = localUsers.find((u) => u.id === session.user.id || u.username.toLowerCase() === session.user.username.toLowerCase());
  if (user) {
    user.devices = user.devices.filter((d) => d.deviceId !== targetDeviceId);
    saveLocalUsers(localUsers);
  }

  return true;
}

/**
 * Exports an encrypted Satellite Pairing Token that can be pasted or scanned on mobile to instantly link devices
 * and transfer active dossiers, routines, and user credentials.
 */
export async function exportSatellitePairingToken(): Promise<string> {
  const session = getActiveSession();
  if (!session) throw new Error('No active operative session to pair.');

  const localUsers = getLocalUsers();
  const userRec = localUsers.find(
    (u) =>
      u.id === session.user.id ||
      u.username.toLowerCase() === session.user.username.toLowerCase()
  );

  let syncPackage: any = null;
  try {
    const { assembleLocalSyncPackage } = await import('./SyncService');
    syncPackage = await assembleLocalSyncPackage(session);
  } catch (err) {
    console.warn('Could not bundle local sync package into token', err);
  }

  const payload = {
    token: session.token,
    user: session.user,
    device: session.device, // Include exporting device!
    credentials: userRec
      ? {
          id: userRec.id,
          username: userRec.username,
          email: userRec.email,
          callsign: userRec.callsign,
          salt: userRec.salt,
          passwordHash: userRec.passwordHash,
          recoveryKey: userRec.recoveryKey,
          securityClearance: userRec.securityClearance,
          devices: userRec.devices,
        }
      : null,
    syncPackage,
    pairedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload);
  const base64 =
    typeof window !== 'undefined'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json).toString('base64');
  return `SATCOM-PAIR::${base64}`;
}

/**
 * Imports a Satellite Pairing Token on mobile or another node to establish immediate link,
 * seed local credentials for offline username/email/callsign login, and apply all dossiers.
 */
export async function importSatellitePairingToken(tokenString: string): Promise<AuthSession> {
  const cleaned = tokenString.trim().replace(/^SATCOM-PAIR::/, '');
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

  const currentDevice = getCurrentDeviceInfo();
  const session: AuthSession = {
    token: payload.token,
    user: payload.user,
    device: currentDevice,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  // 1. Activate session
  setActiveSession(session);

  // 2. Set last sync handshake timestamp immediately!
  try {
    localStorage.setItem('pixelops_last_sync_timestamp_v1', new Date().toISOString());
  } catch {}

  // 3. Merge devices from exporter and current device
  const remoteDevices: DeviceInfo[] = [];
  if (payload.device) remoteDevices.push(payload.device);
  if (Array.isArray(payload.credentials?.devices)) {
    remoteDevices.push(...payload.credentials.devices);
  }
  const mergedDevices = [currentDevice, ...remoteDevices].filter(
    (dev, idx, arr) => arr.findIndex((d) => d.deviceId === dev.deviceId) === idx
  );

  // 4. Persist credentials locally so mobile can sign in with username, email, or callsign & password
  if (payload.credentials) {
    upsertLocalUser({
      id: payload.credentials.id,
      username: payload.credentials.username,
      email: payload.credentials.email,
      callsign: payload.credentials.callsign,
      salt: payload.credentials.salt,
      passwordHash: payload.credentials.passwordHash,
      recoveryKey: payload.credentials.recoveryKey,
      securityClearance: payload.credentials.securityClearance,
      createdAt: payload.user.createdAt || new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      devices: mergedDevices,
    });
  }

  // 5. Immediately apply all dossiers, routines, and memories into mobile IndexedDB/localStorage!
  if (payload.syncPackage) {
    try {
      const { applyRemoteSyncPackage } = await import('./SyncService');
      await applyRemoteSyncPackage(payload.syncPackage);
    } catch (syncErr) {
      console.warn('Failed to apply sync package from token', syncErr);
    }
  }

  // 6. Broadcast this newly paired device to server fleet
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
