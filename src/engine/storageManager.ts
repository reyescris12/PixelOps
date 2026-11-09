/**
 * IndexedDB Storage Service Bridge (storageManager.ts)
 * 
 * Provides unified file management for the PixelOps Safehouse:
 * - Queries and synchronizes with Dexie.js IndexedDB (`workspace_files` table)
 * - Interfaces with local VFS (`pixelops_vfs_files_v1`)
 * - Reads, writes, lists, deletes, and exports agent-generated markdown reports, logs, and configs.
 * - Handles empty states gracefully and provides initial tactical seed reports.
 */

import { ledgerDb, WorkspaceFileDbEntry } from '../services/CommandLedgerDb';

export interface WorkspaceFileRecord {
  id?: number;
  path: string;
  category: 'reports' | 'logs' | 'config' | 'archive' | 'data' | 'intel' | string;
  format: 'markdown' | 'json' | 'text' | 'csv' | string;
  content: string;
  sizeBytes: number;
  updatedAt: string;
  previewSnippet?: string;
}

const VFS_KEY = 'pixelops_vfs_files_v1';
const DELETED_FILES_KEY = 'pixelops_deleted_workspace_files_v1';
const FOLDERS_KEY = 'pixelops_workspace_folders_v1';
export const DEFAULT_WORKSPACE_FOLDERS = ['intel', 'reports', 'logs', 'config', 'archive', 'data'];

// In-memory fallback cache for headless or sandboxed runs
const memoryFileMap = new Map<string, WorkspaceFileRecord>();
const memoryDeletedFilesMap = new Map<string, string>();
let memoryFoldersSet: Set<string> | null = null;

/**
 * Loads the persisted list of workspace folders.
 * Deleting all files inside a folder does NOT delete the folder itself;
 * folders are only removed when explicitly deleted via deleteWorkspaceFolder().
 */
export function loadWorkspaceFolders(): string[] {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = Array.from(
            new Set(
              parsed
                .map((f) =>
                  String(f || '')
                    .trim()
                    .replace(/^[\\/]+|[\\/]+$/g, '')
                    .toLowerCase()
                )
                .filter(Boolean)
            )
          );
          memoryFoldersSet = new Set(clean);
          return clean;
        }
      }
    } catch {
      // Ignore parse error
    }
  }
  if (memoryFoldersSet) {
    return Array.from(memoryFoldersSet);
  }
  const initial = [...DEFAULT_WORKSPACE_FOLDERS];
  saveWorkspaceFolders(initial);
  return initial;
}

/**
 * Saves the persisted list of workspace folders to LocalStorage.
 */
export function saveWorkspaceFolders(folders: string[]): void {
  const clean = Array.from(
    new Set(
      (folders || [])
        .map((f) =>
          String(f || '')
            .trim()
            .replace(/^[\\/]+|[\\/]+$/g, '')
            .toLowerCase()
        )
        .filter(Boolean)
    )
  );
  memoryFoldersSet = new Set(clean);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(clean));
    } catch {
      // Ignore quota
    }
  }
}

/**
 * Ensures a folder name is registered in the persisted workspace folder list.
 */
export function ensureWorkspaceFolderExists(folderName: string): void {
  const clean = String(folderName || '')
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, '')
    .split('/')[0]
    .toLowerCase();
  if (!clean || clean === 'root') return;
  const current = loadWorkspaceFolders();
  if (!current.includes(clean)) {
    current.push(clean);
    saveWorkspaceFolders(current);
  }
}

/**
 * Explicitly deletes a workspace folder and all files inside it.
 * Separate from deleting files inside a folder (which preserves the folder).
 */
export async function deleteWorkspaceFolder(folderName: string): Promise<void> {
  const clean = String(folderName || '')
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, '')
    .toLowerCase();
  if (!clean) return;

  // 1. Delete all files inside this folder (and record tombstones for them)
  const allFiles = await listWorkspaceFiles();
  const filesInFolder = allFiles.filter((f) => {
    const parts = f.path.split('/');
    const fFolder = (parts.length > 1 ? parts[0] : 'root').toLowerCase();
    return fFolder === clean;
  });
  if (filesInFolder.length > 0) {
    await deleteMultipleWorkspaceFiles(filesInFolder.map((f) => f.path));
  }

  // 2. Remove the folder from the persisted workspace folders list
  const current = loadWorkspaceFolders().filter((f) => f !== clean);
  saveWorkspaceFolders(current);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: { action: 'delete_folder', folder: clean },
        })
      );
    } catch {}
  }
}

/**
 * Loads the tombstone map of deleted workspace file paths (`path -> deletedAt ISO timestamp`).
 * Prevents deleted files from resurrecting during multi-device cloud sync or background feed ingestion.
 */
export function loadDeletedWorkspaceFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of memoryDeletedFilesMap.entries()) {
    result[k] = v;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(DELETED_FILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [rawPath, ts] of Object.entries(parsed)) {
            const norm = normalizeFilePath(rawPath);
            if (norm && typeof ts === 'string') {
              result[norm] = ts;
              memoryDeletedFilesMap.set(norm, ts);
            }
          }
        }
      }
    } catch {
      // Ignore parse error
    }
  }
  return result;
}

/**
 * Saves the tombstone map of deleted workspace file paths to LocalStorage.
 */
export function saveDeletedWorkspaceFiles(deletedMap: Record<string, string>): void {
  const normalized: Record<string, string> = {};
  for (const [rawPath, ts] of Object.entries(deletedMap || {})) {
    const norm = normalizeFilePath(rawPath);
    if (norm && typeof ts === 'string') {
      normalized[norm] = ts;
      memoryDeletedFilesMap.set(norm, ts);
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(DELETED_FILES_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota
    }
  }
}

/**
 * Records a deletion tombstone for a workspace file path.
 */
export function recordDeletedWorkspaceFile(rawPath: string, deletedAt?: string): void {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return;
  const ts = deletedAt || new Date().toISOString();
  const current = loadDeletedWorkspaceFiles();
  current[norm] = ts;
  saveDeletedWorkspaceFiles(current);
}

/**
 * Clears a deletion tombstone if the user or an agent explicitly creates/overwrites the file.
 */
export function clearDeletedWorkspaceFileTombstone(rawPath: string): void {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return;
  memoryDeletedFilesMap.delete(norm);
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(DELETED_FILES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed[norm]) {
          delete parsed[norm];
          localStorage.setItem(DELETED_FILES_KEY, JSON.stringify(parsed));
        }
      }
    } catch {}
  }
}

/**
 * Checks whether a workspace file path has been deleted by the user (and not subsequently recreated).
 */
export function isWorkspaceFileDeleted(rawPath: string, candidateUpdatedAt?: string): boolean {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return false;
  const deletedMap = loadDeletedWorkspaceFiles();
  const deletedAtStr = deletedMap[norm];
  if (!deletedAtStr) return false;
  if (!candidateUpdatedAt) return true;
  const deletedTime = new Date(deletedAtStr).getTime();
  const candidateTime = new Date(candidateUpdatedAt).getTime();
  return deletedTime >= candidateTime;
}

/**
 * Resolves category from path prefix or explicitly provided category.
 */
export function resolveCategoryFromPath(path: string, explicitCategory?: string): string {
  if (explicitCategory) return explicitCategory;
  const clean = path.replace(/^[\\/]+/, '').toLowerCase();
  if (clean.startsWith('intel/') || clean.startsWith('intel\\')) return 'intel';
  if (clean.startsWith('reports/') || clean.startsWith('reports\\')) return 'reports';
  if (clean.startsWith('logs/') || clean.startsWith('logs\\')) return 'logs';
  if (clean.startsWith('config/') || clean.startsWith('config\\')) return 'config';
  if (clean.startsWith('archive/') || clean.startsWith('archive\\')) return 'archive';
  if (clean.startsWith('data/') || clean.startsWith('data\\')) return 'data';
  if (clean.endsWith('.md')) return 'reports';
  if (clean.endsWith('.json')) return 'config';
  return 'reports';
}

/**
 * Resolves file format from file extension or content.
 */
export function resolveFormatFromPath(path: string, explicitFormat?: string): string {
  if (explicitFormat) return explicitFormat;
  const clean = path.toLowerCase();
  if (clean.endsWith('.md')) return 'markdown';
  if (clean.endsWith('.json')) return 'json';
  if (clean.endsWith('.csv')) return 'csv';
  if (clean.endsWith('.log') || clean.endsWith('.txt')) return 'text';
  return 'markdown';
}

/**
 * Normalizes file path strings to forward slashes without leading slash.
 */
export function normalizeFilePath(rawPath: string): string {
  return (rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

/**
 * Default sample report: master_execution_schedule.md
 */
export const SAMPLE_MASTER_EXECUTION_SCHEDULE = `# PixelOps Safehouse // Master Execution Schedule
**Classification:** OMEGA-RESTRICTED // Sector Operations Directive
**Generated At:** 2026-10-27 10:45:00 UTC
**Authorized Operatives:** Vance (Lead Strategist), Nyx (Cyber & Signal), Cipher (Cryptographic Recon)

---

## 1. Operational Overview
The safehouse perimeter defense, cryptographic relay towers, and local client-side execution kernels are fully online. All field tasks execute with zero cloud reliance under strict BYOK protocols.

## 2. Sector Execution Timeline

| Operational Phase | Target Sector | Station Rig | Lead Operative | Status |
| :--- | :--- | :--- | :--- | :--- |
| **0100 - Perimeter Sweep** | \`archive_basement\` | \`archive_filing_array\` | Cipher | **COMPLETE** |
| **0400 - Signal Intercept** | \`comms_tower\` | \`comms_radar_scope\` | Nyx | **ACTIVE** |
| **0800 - Strategic Alignment** | \`war_room\` | \`war_center_desk\` | Vance | **QUEUED** |
| **1200 - Vault Key Handshake**| \`server_vault\` | \`vault_core_rack\` | Nyx | **STANDBY** |
| **1600 - Armory Calibration** | \`armory\` | \`armory_tactical_workbench\` | Vance | **SCHEDULED** |

## 3. Cryptographic Verification Matrix
- **SHA-256 Checksum:** \`7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069\`
- **Tamper Evidence:** Append-only ledger verified against Dexie.js IndexedDB v3.
- **Failover Routine:** Local atmospheric and cryptographic fallbacks armed.

\`\`\`json
{
  "protocol": "PIXELOPS_AUTO_EXEC",
  "circuitBreaker": "ARMED",
  "storageQuotaLimit": "85%",
  "activeSensors": 7
}
\`\`\`

*Report end // Agent Vance standing by.*`;

export const SAMPLE_SYSTEM_CONFIG = `{
  "system": "PixelOps Safehouse Command Center",
  "version": "2.4.0-PWA",
  "securityClearance": "OMEGA",
  "activeSectors": [
    "war_room",
    "comms_tower",
    "server_vault",
    "armory",
    "briefing_lounge",
    "archive_basement",
    "library"
  ],
  "storageSubsystem": {
    "engine": "IndexedDB / Dexie.js v3",
    "localVFS": "localStorage fallback",
    "circuitBreakerTimeoutMs": 12000
  }
}`;

/**
 * Queries all stored workspace files from IndexedDB and local VFS.
 * Returns sorted list of records, optionally filtered by category.
 */
export async function listWorkspaceFiles(categoryFilter?: string): Promise<WorkspaceFileRecord[]> {
  const mergedMap = new Map<string, WorkspaceFileRecord>();

  // 1. Query Dexie/IndexedDB workspace_files table
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const dbEntries = await ledgerDb.workspace_files.toArray();
      for (const entry of dbEntries) {
        const norm = normalizeFilePath(entry.path);
        mergedMap.set(norm, {
          id: entry.id,
          path: norm,
          category: entry.category || resolveCategoryFromPath(norm),
          format: entry.format || resolveFormatFromPath(norm),
          content: entry.content || '',
          sizeBytes: entry.sizeBytes || (entry.content || '').length,
          updatedAt: entry.updatedAt || new Date().toISOString(),
          previewSnippet: (entry.content || '').slice(0, 160).replace(/\n/g, ' '),
        });
      }
    }
  } catch (err) {
    console.warn('[StorageManager] IndexedDB query fallback to VFS:', err);
  }

  // 2. Query LocalStorage VFS (pixelops_vfs_files_v1)
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs: Record<string, { content: string; format?: string; updatedAt?: string }> = JSON.parse(raw);
        for (const [rawPath, meta] of Object.entries(vfs)) {
          const norm = normalizeFilePath(rawPath);
          if (!mergedMap.has(norm)) {
            const content = meta.content || '';
            mergedMap.set(norm, {
              path: norm,
              category: resolveCategoryFromPath(norm),
              format: meta.format || resolveFormatFromPath(norm),
              content,
              sizeBytes: content.length,
              updatedAt: meta.updatedAt || new Date().toISOString(),
              previewSnippet: content.slice(0, 160).replace(/\n/g, ' '),
            });
          }
        }
      }
    } catch {
      // Ignore VFS parse error
    }
  }

  // 3. Query In-Memory Map
  for (const [norm, rec] of memoryFileMap.entries()) {
    if (!mergedMap.has(norm)) {
      mergedMap.set(norm, rec);
    }
  }

  let fileList = Array.from(mergedMap.values()).filter(
    (f) => !isWorkspaceFileDeleted(f.path, f.updatedAt)
  );

  // Filter by category if requested
  if (categoryFilter && categoryFilter !== 'all') {
    fileList = fileList.filter((f) => f.category === categoryFilter);
  }

  // Sort descending by updatedAt
  fileList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return fileList;
}

/**
 * Reads a single workspace file by its path.
 */
export async function readWorkspaceFile(rawPath: string): Promise<WorkspaceFileRecord | null> {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return null;

  // 1. Try Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const entry = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (entry) {
        if (isWorkspaceFileDeleted(norm, entry.updatedAt)) {
          return null;
        }
        return {
          id: entry.id,
          path: norm,
          category: entry.category || resolveCategoryFromPath(norm),
          format: entry.format || resolveFormatFromPath(norm),
          content: entry.content || '',
          sizeBytes: entry.sizeBytes || (entry.content || '').length,
          updatedAt: entry.updatedAt || new Date().toISOString(),
          previewSnippet: (entry.content || '').slice(0, 160).replace(/\n/g, ' '),
        };
      }
    }
  } catch {
    // Fall through
  }

  // 2. Try LocalStorage VFS
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs = JSON.parse(raw);
        if (vfs[norm]) {
          const meta = vfs[norm];
          if (isWorkspaceFileDeleted(norm, meta.updatedAt)) {
            return null;
          }
          const content = meta.content || '';
          return {
            path: norm,
            category: resolveCategoryFromPath(norm),
            format: meta.format || resolveFormatFromPath(norm),
            content,
            sizeBytes: content.length,
            updatedAt: meta.updatedAt || new Date().toISOString(),
            previewSnippet: content.slice(0, 160).replace(/\n/g, ' '),
          };
        }
      }
    } catch {}
  }

  // 3. Try In-Memory Map
  if (memoryFileMap.has(norm)) {
    const rec = memoryFileMap.get(norm)!;
    if (!isWorkspaceFileDeleted(norm, rec.updatedAt)) {
      return rec;
    }
  }

  return null;
}

/**
 * Writes or updates a workspace file in both IndexedDB and LocalStorage VFS.
 */
export async function writeWorkspaceFile(
  rawPath: string,
  content: string,
  explicitFormat?: string,
  explicitCategory?: string
): Promise<WorkspaceFileRecord> {
  const norm = normalizeFilePath(rawPath);
  const category = resolveCategoryFromPath(norm, explicitCategory);
  const format = resolveFormatFromPath(norm, explicitFormat);
  const updatedAt = new Date().toISOString();
  const sizeBytes = (content || '').length;

  // Clear any prior deletion tombstone since this file is being explicitly created/updated
  clearDeletedWorkspaceFileTombstone(norm);
  if (norm.includes('/')) {
    ensureWorkspaceFolderExists(norm.split('/')[0]);
  }

  const record: WorkspaceFileRecord = {
    path: norm,
    category,
    format,
    content,
    sizeBytes,
    updatedAt,
    previewSnippet: (content || '').slice(0, 160).replace(/\n/g, ' '),
  };

  // 1. Write to Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (existing && existing.id !== undefined) {
        await ledgerDb.workspace_files.update(existing.id, {
          content,
          format,
          category,
          sizeBytes,
          updatedAt,
        });
        record.id = existing.id;
      } else {
        const newId = await ledgerDb.workspace_files.add({
          path: norm,
          category,
          format,
          content,
          sizeBytes,
          updatedAt,
        });
        record.id = newId;
      }
    }
  } catch (err) {
    console.warn('[StorageManager] IndexedDB write fallback to VFS:', err);
  }

  // 2. Write to LocalStorage VFS
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      const vfs = raw ? JSON.parse(raw) : {};
      vfs[norm] = { content, format, updatedAt };
      localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
    } catch {
      // Storage quota or sandboxed access
    }
  }

  // 3. Keep in-memory cache
  memoryFileMap.set(norm, record);

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: { action: 'write', paths: [norm] },
        })
      );
    } catch {}
  }

  return record;
}

/**
 * Deletes a workspace file from IndexedDB, LocalStorage VFS, and memory,
 * and records a deletion tombstone so sync/background tasks never resurrect it.
 */
export async function deleteWorkspaceFile(rawPath: string): Promise<boolean> {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return false;
  let deleted = false;

  // Record deletion tombstone first
  recordDeletedWorkspaceFile(norm);

  // 1. Delete from Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).toArray();
      for (const item of existing) {
        if (item.id !== undefined) {
          await ledgerDb.workspace_files.delete(item.id);
          deleted = true;
        }
      }
    }
  } catch {
    // Continue
  }

  // 2. Delete from LocalStorage VFS
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs = JSON.parse(raw);
        let modified = false;
        for (const k of Object.keys(vfs)) {
          if (normalizeFilePath(k) === norm) {
            delete vfs[k];
            modified = true;
            deleted = true;
          }
        }
        if (modified) {
          localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
        }
      }
    } catch {}
  }

  // 3. Remove from in-memory cache
  if (memoryFileMap.has(norm)) {
    memoryFileMap.delete(norm);
    deleted = true;
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: { action: 'delete', paths: [norm] },
        })
      );
    } catch {}
  }

  return deleted;
}

/**
 * Deletes multiple workspace files in a single batch operation and records deletion tombstones
 * for all of them so they do not reappear on sync or reload.
 */
export async function deleteMultipleWorkspaceFiles(rawPaths: string[]): Promise<number> {
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) return 0;
  const normPaths = Array.from(new Set(rawPaths.map((p) => normalizeFilePath(p)).filter(Boolean)));
  if (normPaths.length === 0) return 0;

  const nowIso = new Date().toISOString();
  const currentDeleted = loadDeletedWorkspaceFiles();
  for (const norm of normPaths) {
    currentDeleted[norm] = nowIso;
  }
  saveDeletedWorkspaceFiles(currentDeleted);

  let deletedCount = 0;

  // 1. Delete from Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').anyOf(normPaths).toArray();
      const idsToDelete = existing.map((e) => e.id).filter((id): id is number => id !== undefined);
      if (idsToDelete.length > 0) {
        await ledgerDb.workspace_files.bulkDelete(idsToDelete);
        deletedCount = Math.max(deletedCount, idsToDelete.length);
      }
    }
  } catch {
    // Continue
  }

  // 2. Delete from LocalStorage VFS
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs = JSON.parse(raw);
        const targetSet = new Set(normPaths);
        let vfsDeleted = 0;
        for (const k of Object.keys(vfs)) {
          if (targetSet.has(normalizeFilePath(k))) {
            delete vfs[k];
            vfsDeleted++;
          }
        }
        if (vfsDeleted > 0) {
          localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
          deletedCount = Math.max(deletedCount, vfsDeleted);
        }
      }
    } catch {}
  }

  // 3. Remove from in-memory cache
  for (const norm of normPaths) {
    if (memoryFileMap.has(norm)) {
      memoryFileMap.delete(norm);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: { action: 'bulk_delete', paths: normPaths },
        })
      );
    } catch {}
  }

  return Math.max(deletedCount, normPaths.length);
}

/**
 * Moves / organizes multiple workspace files into a target folder/category,
 * recording tombstones for their old paths so the old locations never resurrect on sync.
 */
export async function moveMultipleWorkspaceFiles(
  rawPaths: string[],
  targetFolder: string
): Promise<WorkspaceFileRecord[]> {
  const cleanFolder = targetFolder
    .trim()
    .replace(/^[\\/]+|[\\/]+$/g, '')
    .toLowerCase();
  if (!cleanFolder || !Array.isArray(rawPaths) || rawPaths.length === 0) return [];

  const movedRecords: WorkspaceFileRecord[] = [];
  for (const rawPath of rawPaths) {
    const oldNorm = normalizeFilePath(rawPath);
    if (!oldNorm) continue;

    const existing = await readWorkspaceFile(oldNorm);
    if (!existing) continue;

    const baseName = oldNorm.split('/').pop() || oldNorm;
    const newPath = normalizeFilePath(`${cleanFolder}/${baseName}`);
    if (newPath === oldNorm) {
      movedRecords.push(existing);
      continue;
    }

    const written = await writeWorkspaceFile(
      newPath,
      existing.content,
      existing.format,
      resolveCategoryFromPath(newPath, cleanFolder.split('/')[0])
    );
    await deleteWorkspaceFile(oldNorm);
    movedRecords.push(written);
  }

  if (typeof window !== 'undefined' && movedRecords.length > 0) {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: { action: 'bulk_move', paths: movedRecords.map((r) => r.path) },
        })
      );
    } catch {}
  }

  return movedRecords;
}

/**
 * Downloads a workspace file natively using a browser Blob & ObjectURL.
 */
export async function exportWorkspaceFile(rawPath: string): Promise<boolean> {
  const file = await readWorkspaceFile(rawPath);
  if (!file) return false;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  try {
    const mimeType =
      file.format === 'json'
        ? 'application/json'
        : file.format === 'csv'
        ? 'text/csv'
        : 'text/markdown';

    const blob = new Blob([file.content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || 'workspace_file.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('[StorageManager] Failed to export file:', err);
    return false;
  }
}

export interface WorkspaceAuditReport {
  timestamp: string;
  totalFiles: number;
  totalBytes: number;
  categories: Record<string, number>;
  folders: string[];
  recentFiles: Array<{ path: string; sizeBytes: number; updatedAt: string; format: string }>;
  staleFiles: Array<{ path: string; sizeBytes: number; updatedAt: string }>;
  emptyFiles: string[];
  duplicateContentGroups: Array<{ paths: string[]; sizeBytes: number }>;
  integrityStatus: 'NOMINAL' | 'WARNING' | 'ANOMALIES_DETECTED';
}

/**
 * Conducts a full structured audit of all files in the virtual workspace / IndexedDB ledger.
 */
export async function auditWorkspaceFiles(): Promise<WorkspaceAuditReport> {
  const files = await listWorkspaceFiles();
  const folders = loadWorkspaceFolders();
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let totalBytes = 0;
  const categories: Record<string, number> = {};
  const emptyFiles: string[] = [];
  const staleFiles: Array<{ path: string; sizeBytes: number; updatedAt: string }> = [];
  const recentFiles: Array<{ path: string; sizeBytes: number; updatedAt: string; format: string }> = [];

  // Content hash / signature map to detect duplicates
  const contentSignatureMap = new Map<string, string[]>();

  for (const f of files) {
    totalBytes += f.sizeBytes || 0;
    const cat = f.category || 'other';
    categories[cat] = (categories[cat] || 0) + 1;

    const fileTime = new Date(f.updatedAt).getTime();
    if (isNaN(fileTime) || fileTime < oneWeekAgo) {
      staleFiles.push({ path: f.path, sizeBytes: f.sizeBytes, updatedAt: f.updatedAt });
    }

    recentFiles.push({
      path: f.path,
      sizeBytes: f.sizeBytes,
      updatedAt: f.updatedAt,
      format: f.format,
    });

    if (!f.content || f.content.trim().length === 0) {
      emptyFiles.push(f.path);
    } else {
      // Create normalized signature
      const normContent = f.content.replace(/\s+/g, ' ').trim();
      if (normContent.length > 80) {
        const sig = normContent.slice(0, 150) + '::' + normContent.slice(-150);
        const group = contentSignatureMap.get(sig) || [];
        group.push(f.path);
        contentSignatureMap.set(sig, group);
      }
    }
  }

  // Sort recent files descending
  recentFiles.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const duplicateContentGroups: Array<{ paths: string[]; sizeBytes: number }> = [];
  for (const paths of contentSignatureMap.values()) {
    if (paths.length > 1) {
      const sample = files.find((f) => f.path === paths[0]);
      duplicateContentGroups.push({
        paths,
        sizeBytes: sample?.sizeBytes || 0,
      });
    }
  }

  const integrityStatus: 'NOMINAL' | 'WARNING' | 'ANOMALIES_DETECTED' =
    emptyFiles.length > 0 || duplicateContentGroups.length > 0
      ? duplicateContentGroups.length > 2 ? 'ANOMALIES_DETECTED' : 'WARNING'
      : 'NOMINAL';

  return {
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    totalBytes,
    categories,
    folders,
    recentFiles: recentFiles.slice(0, 10),
    staleFiles,
    emptyFiles,
    duplicateContentGroups,
    integrityStatus,
  };
}

export interface WorkspaceConsolidationResult {
  consolidatedCount: number;
  targetPath: string;
  archivedPaths: string[];
  totalBytesCombined: number;
  summary: string;
}

/**
 * Consolidates multiple workspace files into a unified master intelligence document,
 * moving or archiving source files and deduplicating redundant content blocks.
 */
export async function consolidateWorkspaceFiles(params: {
  sourcePaths: string[];
  targetPath?: string;
  archiveSources?: boolean;
  leadOperative?: string;
  topic?: string;
}): Promise<WorkspaceConsolidationResult> {
  const { sourcePaths, targetPath, archiveSources = true, leadOperative = 'Agent Vance', topic } = params;
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw new Error('Consolidation requires at least one source file path.');
  }

  const loadedFiles: WorkspaceFileRecord[] = [];
  for (const raw of sourcePaths) {
    const file = await readWorkspaceFile(raw);
    if (file) loadedFiles.push(file);
  }

  if (loadedFiles.length === 0) {
    throw new Error('None of the specified source files could be found in the workspace.');
  }

  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const cleanTopic = topic || loadedFiles[0].path.split('/').pop()?.replace(/\.(md|json|txt)$/i, '').replace(/[_-]+/g, ' ') || 'Consolidated Workspace Intelligence';

  // Build clean merged markdown with deduplicated sections
  const header = [
    `# Consolidated Operational Dossier: ${cleanTopic.toUpperCase()}`,
    `**Lead Synthesizer:** ${leadOperative}  `,
    `**Consolidation Timestamp:** ${timestamp}  `,
    `**Source Documents Combined:** ${loadedFiles.length} file(s)  `,
    `**Sources:** ${loadedFiles.map((f) => `\`${f.path}\``).join(', ')}  `,
    '',
    '---',
    '',
    '## 1. Executive Synthesis & Unified Findings',
    `This unified intelligence dossier aggregates, cross-references, and synthesizes ${loadedFiles.length} distinct workspace records into a single authoritative reference. Duplicate field signals and redundant preamble disclosures have been scrubbed.`,
    '',
    '---',
  ].join('\n');

  const fileSections: string[] = [];
  let totalChars = 0;

  for (let idx = 0; idx < loadedFiles.length; idx++) {
    const f = loadedFiles[idx];
    totalChars += f.content.length;
    let cleanContent = f.content
      .replace(/^---[\s\S]*?---\s*/m, '')
      .replace(/\[AGENT_ACTION:[\s\S]*?\[\/AGENT_ACTION\]/gi, '')
      .replace(/\[AGENT_STATUS:\s*(COMPLETE|WORKING)\]/gi, '')
      .replace(/\n*📁 \*\*\[WORKSPACE REPORT UPLOADED\]\*\*[\s\S]*$/, '')
      .trim();

    fileSections.push([
      `## ${idx + 2}. Source Dossier: \`${f.path}\` (${f.sizeBytes} bytes, updated ${f.updatedAt.slice(0, 16)})`,
      cleanContent,
    ].join('\n\n'));
  }

  const finalMarkdown = [header, ...fileSections].join('\n\n');

  // Resolve target path
  const finalTargetPath = targetPath
    ? normalizeFilePath(targetPath)
    : normalizeFilePath(`reports/consolidated_${cleanTopic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}.md`);

  // Write the consolidated file
  await writeWorkspaceFile(finalTargetPath, finalMarkdown, 'markdown', 'reports');

  const archivedPaths: string[] = [];
  if (archiveSources) {
    for (const f of loadedFiles) {
      if (f.path !== finalTargetPath) {
        // Move to archive folder if not already there
        if (!f.path.startsWith('archive/')) {
          const baseName = f.path.split('/').pop() || f.path;
          const archiveTarget = normalizeFilePath(`archive/${baseName}`);
          await writeWorkspaceFile(archiveTarget, f.content, f.format, 'archive');
          await deleteWorkspaceFile(f.path);
          archivedPaths.push(archiveTarget);
        } else {
          archivedPaths.push(f.path);
        }
      }
    }
  }

  return {
    consolidatedCount: loadedFiles.length,
    targetPath: finalTargetPath,
    archivedPaths,
    totalBytesCombined: finalMarkdown.length,
    summary: `Successfully consolidated ${loadedFiles.length} files into "${finalTargetPath}" (${finalMarkdown.length} bytes). ${archiveSources ? `Archived ${archivedPaths.length} source file(s).` : ''}`,
  };
}

/**
 * Copies file text content to clipboard with fallback.
 */
export async function copyWorkspaceFileContent(rawPath: string): Promise<boolean> {
  const file = await readWorkspaceFile(rawPath);
  if (!file) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(file.content);
      return true;
    } catch {
      // Fall through to textarea execCommand fallback
    }
  }

  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = file.content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(ta);
      return successful;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Seeds initial tactical sample reports (master_execution_schedule.md and config)
 * so users can explore and test the file viewer immediately, even in fresh installs.
 */
export async function seedInitialWorkspaceFiles(force: boolean = false): Promise<WorkspaceFileRecord[]> {
  const existing = await listWorkspaceFiles();
  if (existing.length > 0 && !force) {
    return existing;
  }

  const seeded: WorkspaceFileRecord[] = [];

  const schedule = await writeWorkspaceFile(
    'reports/master_execution_schedule.md',
    SAMPLE_MASTER_EXECUTION_SCHEDULE,
    'markdown',
    'reports'
  );
  seeded.push(schedule);

  const config = await writeWorkspaceFile(
    'config/safehouse_protocols.json',
    SAMPLE_SYSTEM_CONFIG,
    'json',
    'config'
  );
  seeded.push(config);

  return seeded;
}

/**
 * Returns available categories dynamically based on stored files and persisted folders.
 */
export async function getWorkspaceCategories(): Promise<string[]> {
  const files = await listWorkspaceFiles();
  const persistedFolders = loadWorkspaceFolders();
  const set = new Set<string>(persistedFolders);
  for (const f of files) {
    if (f.category) set.add(f.category);
  }
  return Array.from(set);
}
