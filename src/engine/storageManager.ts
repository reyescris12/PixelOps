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
  category: 'reports' | 'logs' | 'config' | 'archive' | 'data' | string;
  format: 'markdown' | 'json' | 'text' | 'csv' | string;
  content: string;
  sizeBytes: number;
  updatedAt: string;
  previewSnippet?: string;
}

const VFS_KEY = 'pixelops_vfs_files_v1';

// In-memory fallback cache for headless or sandboxed runs
const memoryFileMap = new Map<string, WorkspaceFileRecord>();

/**
 * Resolves category from path prefix or explicitly provided category.
 */
export function resolveCategoryFromPath(path: string, explicitCategory?: string): string {
  if (explicitCategory) return explicitCategory;
  const clean = path.replace(/^[\\/]+/, '').toLowerCase();
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

  let fileList = Array.from(mergedMap.values());

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
    return memoryFileMap.get(norm)!;
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

  return record;
}

/**
 * Deletes a workspace file from IndexedDB, LocalStorage VFS, and memory.
 */
export async function deleteWorkspaceFile(rawPath: string): Promise<boolean> {
  const norm = normalizeFilePath(rawPath);
  let deleted = false;

  // 1. Delete from Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (existing && existing.id !== undefined) {
        await ledgerDb.workspace_files.delete(existing.id);
        deleted = true;
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
        if (vfs[norm]) {
          delete vfs[norm];
          localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
          deleted = true;
        }
      }
    } catch {}
  }

  // 3. Remove from in-memory cache
  if (memoryFileMap.has(norm)) {
    memoryFileMap.delete(norm);
    deleted = true;
  }

  return deleted;
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
 * Returns available categories dynamically based on stored files.
 */
export async function getWorkspaceCategories(): Promise<string[]> {
  const files = await listWorkspaceFiles();
  const set = new Set<string>(['reports', 'logs', 'config']);
  for (const f of files) {
    if (f.category) set.add(f.category);
  }
  return Array.from(set);
}
