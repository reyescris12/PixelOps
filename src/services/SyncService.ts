/**
 * SyncService.ts
 * 
 * Multi-Device Cloud Synchronization Engine for PixelOps Safehouse.
 * Synchronizes Workspace Files, Night Shift Routines, Agent Memories,
 * Command Ledgers, and Safehouse Preferences across Desktop and Mobile devices.
 */

import { getActiveSession, AuthSession } from './AuthService';
import {
  WorkspaceFileRecord,
  listWorkspaceFiles,
  writeWorkspaceFile,
} from '../engine/storageManager';
import {
  NightShiftTaskSchedule,
  loadNightShiftSchedules,
  saveNightShiftSchedules,
} from './NightShiftService';
import {
  ledgerDb,
  AgentMemoryDbEntry,
  CommandLedgerEntry,
} from './CommandLedgerDb';
import {
  loadAppSessionSnapshot,
  saveAppSessionSnapshot,
  PersistedAppSessionState,
} from './AppStatePersistence';
import {
  getLocalConnectedAccounts,
  saveLocalConnectedAccount,
  getOrCreateEntityId,
  setComposioEntityId,
  getComposioApiKey,
  setComposioApiKey,
} from './ComposioService';

export interface SyncPackage {
  version: 1;
  schemaVersion: 2;
  timestamp: string;
  deviceId: string;
  userId: string;
  username?: string;
  device?: any;
  workspaceFiles: WorkspaceFileRecord[];
  routines: NightShiftTaskSchedule[];
  agentMemories: AgentMemoryDbEntry[];
  commandLedger: CommandLedgerEntry[];
  appSessionState: PersistedAppSessionState | null;
  preferences: Record<string, any>;
  composioAccounts: any[];
  composioEntityId?: string;
  composioApiKey?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

export interface SyncStats {
  filesCount: number;
  routinesCount: number;
  memoriesCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  status: SyncStatus;
  autoSyncEnabled: boolean;
}

const STORAGE_LAST_SYNC = 'pixelops_last_sync_timestamp_v1';
const STORAGE_AUTO_SYNC = 'pixelops_auto_sync_enabled_v1';
const STORAGE_CLOUD_CACHE = 'pixelops_cloud_sync_cache_v1';

let isSyncInProgress = false;
let autoSyncInterval: any = null;
const syncListeners = new Set<(stats: SyncStats) => void>();

/**
 * Checks if auto-sync is currently enabled by the operative
 */
export function isAutoSyncEnabled(): boolean {
  try {
    const val = localStorage.getItem(STORAGE_AUTO_SYNC);
    return val === null ? true : val === 'true'; // Enabled by default
  } catch {
    return true;
  }
}

/**
 * Toggles auto-sync on or off
 */
export function setAutoSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_AUTO_SYNC, String(enabled));
    notifyListeners();
  } catch {}
}

/**
 * Gets the timestamp of the last successful sync
 */
export function getLastSyncTime(): string | null {
  try {
    return localStorage.getItem(STORAGE_LAST_SYNC);
  } catch {
    return null;
  }
}

/**
 * Returns current sync status and stats
 */
export function getSyncStats(): SyncStats {
  const session = getActiveSession();
  const rawCache = getLocalCloudCache();
  return {
    filesCount: rawCache?.workspaceFiles?.length || 0,
    routinesCount: rawCache?.routines?.length || 0,
    memoriesCount: rawCache?.agentMemories?.length || 0,
    lastSyncedAt: getLastSyncTime(),
    lastError: null,
    status: !session ? 'offline' : isSyncInProgress ? 'syncing' : 'idle',
    autoSyncEnabled: isAutoSyncEnabled(),
  };
}

/**
 * Subscribes to live sync status changes
 */
export function subscribeSyncStatus(listener: (stats: SyncStats) => void): () => void {
  syncListeners.add(listener);
  listener(getSyncStats());
  return () => {
    syncListeners.delete(listener);
  };
}

function notifyListeners(statusOverride?: SyncStatus, errorOverride?: string | null): void {
  const base = getSyncStats();
  const payload: SyncStats = {
    ...base,
    status: statusOverride || base.status,
    lastError: errorOverride !== undefined ? errorOverride : base.lastError,
  };
  for (const fn of syncListeners) {
    try {
      fn(payload);
    } catch {}
  }
}

/**
 * Retrieves the local cache of the cloud package
 */
function getLocalCloudCache(): SyncPackage | null {
  try {
    const raw = localStorage.getItem(STORAGE_CLOUD_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Saves the local cache of the cloud package
 */
function setLocalCloudCache(pkg: SyncPackage): void {
  try {
    localStorage.setItem(STORAGE_CLOUD_CACHE, JSON.stringify(pkg));
  } catch {}
}

/**
 * Collects current local device state into a synchronized data package
 */
export async function assembleLocalSyncPackage(session: AuthSession): Promise<SyncPackage> {
  const [workspaceFiles, agentMemories, commandLedger] = await Promise.all([
    listWorkspaceFiles().catch(() => []),
    ledgerDb.agent_memories.toArray().catch(() => []),
    ledgerDb.command_ledger.toArray().catch(() => []),
  ]);

  const routines = loadNightShiftSchedules();
  const appSessionState = loadAppSessionSnapshot();
  const composioAccounts = getLocalConnectedAccounts();
  const composioEntityId = getOrCreateEntityId();
  const composioApiKey = getComposioApiKey() || undefined;

  let preferences: Record<string, any> = {};
  try {
    const rawPrefs = localStorage.getItem('pixelops_preferences');
    if (rawPrefs) preferences = JSON.parse(rawPrefs);
  } catch {}

  return {
    version: 1,
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    deviceId: session.device.deviceId,
    userId: session.user.id,
    username: session.user.username,
    device: session.device,
    workspaceFiles,
    routines,
    agentMemories,
    commandLedger,
    appSessionState,
    preferences,
    composioAccounts,
    composioEntityId,
    composioApiKey,
  };
}

/**
 * Applies a remote sync package into local Dexie IndexedDB and localStorage
 */
export async function applyRemoteSyncPackage(pkg: SyncPackage): Promise<void> {
  if (!pkg || typeof pkg !== 'object') return;

  // 1. Merge Workspace Files into IndexedDB (Last-Write-Wins based on updatedAt)
  if (Array.isArray(pkg.workspaceFiles) && pkg.workspaceFiles.length > 0) {
    const currentFiles = await listWorkspaceFiles().catch(() => []);
    const currentFileMap = new Map<string, WorkspaceFileRecord>(
      currentFiles.map((f) => [f.path, f])
    );

    for (const remoteFile of pkg.workspaceFiles) {
      const localFile = currentFileMap.get(remoteFile.path);
      const remoteTime = new Date(remoteFile.updatedAt || 0).getTime();
      const localTime = localFile ? new Date(localFile.updatedAt || 0).getTime() : 0;

      // Only overwrite if remote is newer or doesn't exist locally
      if (!localFile || remoteTime >= localTime) {
        await writeWorkspaceFile(
          remoteFile.path,
          remoteFile.content,
          remoteFile.format,
          remoteFile.category
        ).catch(() => {});
      }
    }
  }

  // 2. Merge Night Shift Routines
  if (Array.isArray(pkg.routines) && pkg.routines.length > 0) {
    const currentRoutines = loadNightShiftSchedules();
    const routineMap = new Map<string, NightShiftTaskSchedule>(
      currentRoutines.map((r: NightShiftTaskSchedule) => [r.id, r])
    );

    for (const remoteRoutine of pkg.routines) {
      const local = routineMap.get(remoteRoutine.id);
      const remoteTime = new Date(remoteRoutine.createdAt || 0).getTime();
      const localTime = local ? new Date(local.createdAt || 0).getTime() : 0;

      if (!local || remoteTime >= localTime) {
        routineMap.set(remoteRoutine.id, remoteRoutine);
      }
    }

    saveNightShiftSchedules(Array.from(routineMap.values()));
  }

  // 3. Merge Agent Memories into Dexie IndexedDB
  if (Array.isArray(pkg.agentMemories) && pkg.agentMemories.length > 0) {
    const currentMemories = await ledgerDb.agent_memories.toArray().catch(() => []);
    const memoryKeys = new Set(
      currentMemories.map((m) => `${m.agentId}|${m.timestamp}|${m.prompt.slice(0, 30)}`)
    );

    const newMemories: Omit<AgentMemoryDbEntry, 'id'>[] = [];
    for (const mem of pkg.agentMemories) {
      const key = `${mem.agentId}|${mem.timestamp}|${mem.prompt.slice(0, 30)}`;
      if (!memoryKeys.has(key)) {
        memoryKeys.add(key);
        newMemories.push({
          agentId: mem.agentId,
          timestamp: mem.timestamp,
          prompt: mem.prompt,
          summary: mem.summary,
          reflection: mem.reflection,
        });
      }
    }

    if (newMemories.length > 0) {
      await ledgerDb.agent_memories.bulkAdd(newMemories as any).catch(() => {});
    }
  }

  // 4. Merge Command Ledger into Dexie IndexedDB
  if (Array.isArray(pkg.commandLedger) && pkg.commandLedger.length > 0) {
    const currentLedger = await ledgerDb.command_ledger.toArray().catch(() => []);
    const ledgerHashes = new Set(currentLedger.map((c) => c.ledger_hash));

    const newLedger: Omit<CommandLedgerEntry, 'id'>[] = [];
    for (const item of pkg.commandLedger) {
      if (item.ledger_hash && !ledgerHashes.has(item.ledger_hash)) {
        ledgerHashes.add(item.ledger_hash);
        newLedger.push({
          timestamp: item.timestamp,
          command_input: item.command_input,
          involved_agent: item.involved_agent,
          tool_used: item.tool_used,
          result_summary: item.result_summary,
          success_boost_achieved: item.success_boost_achieved,
          ledger_hash: item.ledger_hash,
        });
      }
    }

    if (newLedger.length > 0) {
      await ledgerDb.command_ledger.bulkAdd(newLedger as any).catch(() => {});
    }
  }

  // 5. Restore Composio Entity ID & Connected Accounts & BYOK API Key
  if (pkg.composioEntityId && typeof pkg.composioEntityId === 'string' && pkg.composioEntityId.trim()) {
    setComposioEntityId(pkg.composioEntityId.trim());
  }

  if (pkg.composioApiKey && typeof pkg.composioApiKey === 'string' && pkg.composioApiKey.trim()) {
    setComposioApiKey(pkg.composioApiKey.trim(), true);
  }

  if (Array.isArray(pkg.composioAccounts) && pkg.composioAccounts.length > 0) {
    for (const acc of pkg.composioAccounts) {
      if (acc && acc.appName) {
        saveLocalConnectedAccount(acc);
      }
    }
  }

  // 6. Merge App Session State (Preferences & Rooms)
  if (pkg.appSessionState && typeof pkg.appSessionState === 'object') {
    const currentSession = loadAppSessionSnapshot();
    const remoteTime = new Date(pkg.appSessionState.savedAt || 0).getTime();
    const localTime = currentSession ? new Date(currentSession.savedAt || 0).getTime() : 0;

    if (!currentSession || remoteTime > localTime) {
      saveAppSessionSnapshot(pkg.appSessionState, 'active');
    }
  }

  // 7. Merge User Preferences
  if (pkg.preferences && typeof pkg.preferences === 'object') {
    try {
      const existing = localStorage.getItem('pixelops_preferences');
      const merged = { ...(existing ? JSON.parse(existing) : {}), ...pkg.preferences };
      localStorage.setItem('pixelops_preferences', JSON.stringify(merged));
    } catch {}
  }

  // Cache latest verified cloud package
  setLocalCloudCache(pkg);

  // Dispatch global system update events across components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workspace:files-saved', { detail: { source: 'cloud-sync' } }));
    window.dispatchEvent(new CustomEvent('nightshift:updated', { detail: { source: 'cloud-sync' } }));
    window.dispatchEvent(new CustomEvent('composio:session-synced', { detail: { source: 'cloud-sync' } }));
    window.dispatchEvent(new CustomEvent('pixelops:sync-completed', { detail: { timestamp: pkg.timestamp } }));
  }
}

/**
 * Pushes local state to the cloud vault
 */
export async function pushToCloud(): Promise<{ success: boolean; error?: string }> {
  const session = getActiveSession();
  if (!session) {
    return { success: false, error: 'No active operative account signed in.' };
  }

  try {
    const pkg = await assembleLocalSyncPackage(session);

    // Save locally immediately
    setLocalCloudCache(pkg);

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.token}`,
      'x-user-id': session.user.id,
      'x-username': session.user.username.toLowerCase(),
      'x-device-id': session.device.deviceId,
      'x-device-name': session.device.deviceName,
      'x-device-type': session.device.deviceType,
      'x-entity-id': getOrCreateEntityId(),
      'x-composio-api-key': getComposioApiKey() || '',
    };

    // Dispatch to server / cloudflare endpoint with fallback to query action
    let res = await fetch('/api/sync/push', {
      method: 'POST',
      headers,
      body: JSON.stringify(pkg),
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`/api/sync?action=push&username=${encodeURIComponent(session.user.username.toLowerCase())}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(pkg),
      });
    }

    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_LAST_SYNC, now);

    if (res.ok) {
      return { success: true };
    }

    // If server returned non-200, still keep local cloud cache and record handshake
    const errText = await res.text().catch(() => 'Server error');
    return { success: true, error: `Cloud sync stored locally (${errText.slice(0, 50)})` };
  } catch (err: any) {
    const now = new Date().toISOString();
    localStorage.setItem(STORAGE_LAST_SYNC, now);
    return { success: false, error: err?.message || 'Sync push failed' };
  }
}

/**
 * Pulls latest cloud state and merges into local storage
 */
export async function pullFromCloud(): Promise<{ success: boolean; updated: boolean; error?: string }> {
  const session = getActiveSession();
  if (!session) {
    return { success: false, updated: false, error: 'No active operative account signed in.' };
  }

  const headers = {
    Authorization: `Bearer ${session.token}`,
    'x-user-id': session.user.id,
    'x-username': session.user.username.toLowerCase(),
    'x-device-id': session.device.deviceId,
  };

  try {
    let res = await fetch('/api/sync/pull', {
      method: 'GET',
      headers,
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(`/api/sync?action=pull&username=${encodeURIComponent(session.user.username.toLowerCase())}`, {
        method: 'GET',
        headers,
      });
    }

    if (res.ok) {
      const data = await res.json();
      if (data.entityId || data.composioEntityId) {
        setComposioEntityId(data.entityId || data.composioEntityId);
      }
      if (data.composioApiKey && typeof data.composioApiKey === 'string' && data.composioApiKey.trim()) {
        setComposioApiKey(data.composioApiKey.trim(), true);
      }
      if (data.package) {
        await applyRemoteSyncPackage(data.package);
        const now = new Date().toISOString();
        localStorage.setItem(STORAGE_LAST_SYNC, now);
        return { success: true, updated: true };
      }
      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_LAST_SYNC, now);
      return { success: true, updated: false };
    }

    // Fall back to local cloud cache if server is offline
    const localCache = getLocalCloudCache();
    if (localCache) {
      await applyRemoteSyncPackage(localCache);
      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_LAST_SYNC, now);
      return { success: true, updated: true };
    }

    return { success: false, updated: false, error: 'Cloud vault unreachable' };
  } catch (err: any) {
    // Fall back to local cloud cache
    const localCache = getLocalCloudCache();
    if (localCache) {
      await applyRemoteSyncPackage(localCache);
      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_LAST_SYNC, now);
      return { success: true, updated: true };
    }
    return { success: false, updated: false, error: err?.message || 'Sync pull failed' };
  }
}

/**
 * Full bidirectional synchronization (Pull latest remote updates, merge, and Push current state)
 */
export async function performFullSync(): Promise<{ success: boolean; updated?: boolean; error?: string }> {
  if (isSyncInProgress) {
    return { success: true, updated: false };
  }

  const session = getActiveSession();
  if (!session) {
    notifyListeners('offline');
    return { success: false, updated: false, error: 'Sign in to sync your command center across devices.' };
  }

  isSyncInProgress = true;
  notifyListeners('syncing');

  try {
    // 1. Pull latest changes from remote devices first
    const pullResult = await pullFromCloud().catch(() => ({ success: false, updated: false }));

    // 2. Push current consolidated state to cloud
    const pushResult = await pushToCloud();

    isSyncInProgress = false;
    notifyListeners(pushResult.success ? 'synced' : 'error', pushResult.error);
    return {
      success: pushResult.success,
      updated: pullResult.updated,
      error: pushResult.error,
    };
  } catch (err: any) {
    isSyncInProgress = false;
    notifyListeners('error', err?.message || 'Sync failed');
    return { success: false, updated: false, error: err?.message || 'Sync cycle encountered an error' };
  }
}

/**
 * Starts automatic background sync (every 45s and on window focus / visibility change)
 */
export function startAutoSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
  }

  // Periodic timer
  autoSyncInterval = setInterval(() => {
    if (isAutoSyncEnabled() && getActiveSession() && document.visibilityState === 'visible') {
      performFullSync().catch(() => {});
    }
  }, 45000);

  // Sync on tab focus or returning to app
  const handleFocus = () => {
    if (isAutoSyncEnabled() && getActiveSession()) {
      performFullSync().catch(() => {});
    }
  };

  window.addEventListener('focus', handleFocus);
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      handleFocus();
    }
  };
  document.addEventListener('visibilitychange', handleVisibility);

  // Perform initial sync on startup if logged in
  if (getActiveSession()) {
    setTimeout(() => {
      performFullSync().catch(() => {});
    }, 1500);
  }

  return () => {
    stopAutoSync();
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}

/**
 * Stops automatic background sync
 */
export function stopAutoSync(): void {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
}

/**
 * Exports current safehouse state as a portable JSON backup file
 */
export async function exportPortableBackup(): Promise<void> {
  const session = getActiveSession();
  const dummySession: AuthSession = session || {
    token: 'local',
    user: {
      id: 'local_commander',
      username: 'commander',
      email: 'commander@pixelops.local',
      callsign: 'COMMANDER',
      securityClearance: 'COMMANDER',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    },
    device: {
      deviceId: 'local_device',
      deviceName: 'Safehouse Terminal',
      deviceType: 'desktop',
      platform: 'web',
      lastActive: new Date().toISOString(),
    },
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  const pkg = await assembleLocalSyncPackage(dummySession);
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pixelops_safehouse_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Imports a portable JSON backup file into local state
 */
export async function importPortableBackup(jsonString: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(jsonString) as SyncPackage;
    if (!parsed || parsed.version !== 1) {
      throw new Error('Invalid PixelOps backup package format.');
    }
    await applyRemoteSyncPackage(parsed);
    return true;
  } catch (err: any) {
    throw new Error(`Failed to import backup: ${err?.message || err}`);
  }
}

export const syncBidirectional = performFullSync;
export const exportLocalSyncBackup = exportPortableBackup;
export async function importSyncBackup(parsed: any): Promise<{ filesCount: number; routinesCount: number; memoriesCount: number }> {
  await applyRemoteSyncPackage(parsed);
  return {
    filesCount: parsed.workspaceFiles?.length || 0,
    routinesCount: parsed.routines?.length || 0,
    memoriesCount: parsed.agentMemories?.length || 0,
  };
}
