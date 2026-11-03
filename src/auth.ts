/**
 * src/auth.ts
 * Frontend authentication & cloud synchronization client for PixelOps.
 * Compatible with Cloudflare D1 SQL, Cloudflare KV, and PixelOps Command Server.
 */

import {
  registerAccount,
  loginAccount,
  logoutAccount,
  getActiveSession,
  validateActiveSession,
  getLinkedDevices,
  unlinkDevice,
  exportSatellitePairingToken,
  importSatellitePairingToken,
  AuthSession,
  DeviceInfo,
} from './services/AuthService';

import {
  performFullSync,
  pushToCloud,
  pullFromCloud,
  getSyncStats,
  subscribeSyncStatus,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  SyncStats,
  SyncPackage,
} from './services/SyncService';

export {
  registerAccount as register,
  loginAccount as login,
  logoutAccount as logout,
  validateActiveSession as getMe,
  getActiveSession as getSession,
  performFullSync as sync,
  pushToCloud as pushSync,
  pullFromCloud as pullSync,
  getLinkedDevices as getDevices,
  unlinkDevice,
  exportSatellitePairingToken,
  importSatellitePairingToken,
  getSyncStats,
  subscribeSyncStatus,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
};

export type { AuthSession, DeviceInfo, SyncStats, SyncPackage };
