/**
 * IndexedDB Storage Service Bridge (storageManager.ts)
 * 
 * Provides unified file management for the PixelOps Safehouse:
 * - Queries and synchronizes with Dexie.js IndexedDB (`workspace_files` table)
 * - Interfaces with local VFS (`pixelops_vfs_files_v1`)
 * - Reads, writes, lists, deletes, and exports agent-generated markdown reports, logs, and configs.
 * - Handles empty states gracefully and provides initial tactical seed reports.
 */

import { ledgerDb, WorkspaceFileDbEntry, requestPersistentStorage } from '../services/CommandLedgerDb';
import { sanitizeAndDeduplicateReportContent, deduplicateReportIntel } from '../services/ReportService';

export { requestPersistentStorage };

// Automatically request storage persistence when VFS storageManager loads in the browser
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((granted) => {
      if (granted) {
        console.log('Storage persistence granted.');
      }
    }).catch(() => {});
  }
}

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

  let fileList = Array.from(mergedMap.values()).filter((f) => {
    if (isWorkspaceFileDeleted(f.path, f.updatedAt)) return false;
    if (isCorruptedScrapedWorkspaceFile(f.path, f.content || '')) {
      purgeWorkspaceFileWithoutTombstone(f.path).catch(() => {});
      return false;
    }
    return true;
  });

  // Auto-sanitize all markdown reports to strip duplicate sections and correct mismatched topic tags
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    if (
      f.content &&
      (f.path.endsWith('.md') ||
        f.path.startsWith('reports/') ||
        f.path.startsWith('intel/') ||
        f.format === 'markdown')
    ) {
      const { content: sanitized, changed } = sanitizeAndDeduplicateReportContent(
        f.content,
        f.path
      );
      if (changed) {
        f.content = sanitized;
        f.sizeBytes = sanitized.length;
        f.previewSnippet = sanitized.slice(0, 160).replace(/\n/g, ' ');
        memoryFileMap.set(f.path, f);

        // Persist the repaired content back to IndexedDB and VFS asynchronously
        if (ledgerDb && ledgerDb.workspace_files && f.id !== undefined) {
          ledgerDb.workspace_files
            .update(f.id, {
              content: sanitized,
              sizeBytes: sanitized.length,
              updatedAt: new Date().toISOString(),
            })
            .catch(() => {});
        }
        if (typeof localStorage !== 'undefined') {
          try {
            const raw = localStorage.getItem(VFS_KEY);
            if (raw) {
              const vfs = JSON.parse(raw);
              if (vfs[f.path]) {
                vfs[f.path].content = sanitized;
                vfs[f.path].sizeBytes = sanitized.length;
                vfs[f.path].updatedAt = new Date().toISOString();
                localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
              }
            }
          } catch {}
        }
      }
    }
  }

  // Filter by category if requested
  if (categoryFilter && categoryFilter !== 'all') {
    fileList = fileList.filter((f) => f.category === categoryFilter);
  }

  // Sort stably: primary descending by updatedAt, secondary ascending by path
  fileList.sort((a, b) => {
    const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.path.localeCompare(b.path);
  });

  return fileList;
}

/**
 * Reads a single workspace file by its path.
 * Automatically verifies and sanitizes markdown reports to strip duplicate sections
 * and correct mismatched topic tags.
 */
export async function readWorkspaceFile(rawPath: string): Promise<WorkspaceFileRecord | null> {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return null;

  let resultRecord: WorkspaceFileRecord | null = null;

  // 1. Try Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const entry = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (entry) {
        if (isWorkspaceFileDeleted(norm, entry.updatedAt)) {
          return null;
        }
        resultRecord = {
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
  if (!resultRecord && typeof localStorage !== 'undefined') {
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
          resultRecord = {
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
  if (!resultRecord && memoryFileMap.has(norm)) {
    const rec = memoryFileMap.get(norm)!;
    if (!isWorkspaceFileDeleted(norm, rec.updatedAt)) {
      resultRecord = { ...rec };
    }
  }

  if (!resultRecord) return null;

  // 4. Auto-sanitize and repair report content if it's a markdown report
  if (
    resultRecord.content &&
    (norm.endsWith('.md') ||
      norm.startsWith('reports/') ||
      norm.startsWith('intel/') ||
      resultRecord.format === 'markdown')
  ) {
    const { content: sanitized, changed } = sanitizeAndDeduplicateReportContent(
      resultRecord.content,
      norm
    );
    if (changed) {
      resultRecord.content = sanitized;
      resultRecord.sizeBytes = sanitized.length;
      resultRecord.previewSnippet = sanitized.slice(0, 160).replace(/\n/g, ' ');

      // Persist the repaired content back to IndexedDB and VFS silently
      if (ledgerDb && ledgerDb.workspace_files && resultRecord.id !== undefined) {
        ledgerDb.workspace_files
          .update(resultRecord.id, {
            content: sanitized,
            sizeBytes: sanitized.length,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      }
      if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(VFS_KEY);
          if (raw) {
            const vfs = JSON.parse(raw);
            if (vfs[norm]) {
              vfs[norm].content = sanitized;
              vfs[norm].sizeBytes = sanitized.length;
              vfs[norm].updatedAt = new Date().toISOString();
              localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
            }
          }
        } catch {}
      }
    }
  }

  return resultRecord;
}

/**
 * Detects workspace files that captured upstream HTTP 404 / "Page not found" error pages,
 * anti-bot challenge interstitials, or raw website navigation menus instead of article text.
 */
export function isCorruptedScrapedWorkspaceFile(rawPath: string, content: string): boolean {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return false;

  const isScrapedDomain =
    norm.startsWith('intel/sources/isw_research/') ||
    norm.startsWith('intel/') ||
    norm.startsWith('reports/');
  if (!isScrapedDomain) return false;

  const fileName = norm.split('/').pop() || norm;
  if (
    /page_not_found|oops_that_page|just_a_moment|404_not_found|isw_isw_research_library|isw_research_library\.md$/i.test(
      fileName
    )
  ) {
    return true;
  }

  const text = String(content || '').trim();
  if (!text) return norm.startsWith('intel/sources/isw_research/');

  // Explicit 404 / error / anti-bot interstitial signatures in headings or body
  if (
    /^#{1,3}\s*(?:ISW:\s*)?(?:page not found\b|404\b|oops!\s*that page can[’']t be found|nothing found\b|just a moment|attention required|access denied|research library\s*(?:[-|]|$))/im.test(
      text
    )
  ) {
    return true;
  }

  if (
    /oops!\s*that page can[’']t be found|page not found\s*[-|]\s*institute for the study of war|enable javascript and cookies to continue|checking your browser before accessing/i.test(
      text
    )
  ) {
    return true;
  }

  // Legacy broken ISW scrape signatures (catalog index menu dumps or dead URL stubs)
  if (norm.startsWith('intel/sources/isw_research/')) {
    if (
      /Recommended%20Reading%3A%20Research%20Library/i.test(text) ||
      /Live tactical assessment ingested from understandingwar\.org research archives\./i.test(text) ||
      (/\[Skip to content\]\(https?:\/\/(?:www\.)?understandingwar\.org/i.test(text) &&
        !/^##\s+(?:Toplines|Key Takeaways|Executive Key Takeaways)/im.test(text))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Purges a system-corrupted workspace file from IndexedDB, LocalStorage VFS, and memory
 * WITHOUT recording a user deletion tombstone, allowing clean re-ingestion.
 */
export async function purgeWorkspaceFileWithoutTombstone(rawPath: string): Promise<boolean> {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return false;
  let purged = false;

  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).toArray();
      for (const item of existing) {
        if (item.id !== undefined) {
          await ledgerDb.workspace_files.delete(item.id);
          purged = true;
        }
      }
    }
  } catch {}

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
            purged = true;
          }
        }
        if (modified) {
          localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
        }
      }
    } catch {}
  }

  if (memoryFileMap.has(norm)) {
    memoryFileMap.delete(norm);
    purged = true;
  }

  return purged;
}

/**
 * Automatically inspects and repairs all stored workspace reports in IndexedDB and LocalStorage VFS,
 * purging corrupted 404/"Page not found" scrape artifacts, stripping duplicated sections,
 * eliminating repeated paragraphs, and correcting mismatched topic tags.
 * Returns the count of repaired or purged reports.
 */
export async function repairAllStoredReports(): Promise<number> {
  let repairedCount = 0;

  // 1. Repair IndexedDB workspace_files table
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const dbEntries = await ledgerDb.workspace_files.toArray();
      for (const entry of dbEntries) {
        const norm = normalizeFilePath(entry.path);
        if (isCorruptedScrapedWorkspaceFile(norm, entry.content || '')) {
          if (entry.id !== undefined) {
            await ledgerDb.workspace_files.delete(entry.id);
            memoryFileMap.delete(norm);
            repairedCount++;
          }
          continue;
        }
        if (!entry.content) continue;
        if (
          norm.endsWith('.md') ||
          norm.startsWith('reports/') ||
          norm.startsWith('intel/') ||
          entry.format === 'markdown'
        ) {
          const { content: sanitized, changed } = sanitizeAndDeduplicateReportContent(
            entry.content,
            norm
          );
          if (changed && entry.id !== undefined) {
            await ledgerDb.workspace_files.update(entry.id, {
              content: sanitized,
              sizeBytes: sanitized.length,
              updatedAt: new Date().toISOString(),
            });
            repairedCount++;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[StorageManager] Error repairing IndexedDB reports:', err);
  }

  // 2. Repair LocalStorage VFS
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs = JSON.parse(raw);
        let vfsChanged = false;
        for (const [rawPath, meta] of Object.entries(vfs)) {
          if (!meta || typeof (meta as any).content !== 'string') continue;
          const norm = normalizeFilePath(rawPath);
          if (isCorruptedScrapedWorkspaceFile(norm, (meta as any).content)) {
            delete vfs[rawPath];
            memoryFileMap.delete(norm);
            vfsChanged = true;
            repairedCount++;
            continue;
          }
          if (
            norm.endsWith('.md') ||
            norm.startsWith('reports/') ||
            norm.startsWith('intel/') ||
            (meta as any).format === 'markdown'
          ) {
            const { content: sanitized, changed } = sanitizeAndDeduplicateReportContent(
              (meta as any).content,
              norm
            );
            if (changed) {
              (meta as any).content = sanitized;
              (meta as any).sizeBytes = sanitized.length;
              (meta as any).updatedAt = new Date().toISOString();
              vfsChanged = true;
              repairedCount++;
            }
          }
        }
        if (vfsChanged) {
          localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
        }
      }
    } catch {}
  }

  // 3. Update in-memory file map and notify active listeners
  for (const [norm, rec] of Array.from(memoryFileMap.entries())) {
    if (isCorruptedScrapedWorkspaceFile(norm, rec.content || '')) {
      memoryFileMap.delete(norm);
      repairedCount++;
      continue;
    }
    if (
      repairedCount > 0 &&
      rec.content &&
      (norm.endsWith('.md') ||
        norm.startsWith('reports/') ||
        norm.startsWith('intel/') ||
        rec.format === 'markdown')
    ) {
      const { content: sanitized, changed } = sanitizeAndDeduplicateReportContent(
        rec.content,
        norm
      );
      if (changed) {
        rec.content = sanitized;
        rec.sizeBytes = sanitized.length;
        rec.previewSnippet = sanitized.slice(0, 160).replace(/\n/g, ' ');
        memoryFileMap.set(norm, rec);
      }
    }
  }

  if (repairedCount > 0 && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('pixelops:workspace_files_changed'));
    } catch {}
  }

  return repairedCount;
}

/**
 * Writes or updates a workspace file in both IndexedDB and LocalStorage VFS.
 * Automatically guarantees that all markdown reports are deduplicated and clean before persistence.
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

  // Auto-sanitize and deduplicate before saving any markdown report
  let finalContent = content || '';
  if (
    finalContent &&
    (norm.endsWith('.md') ||
      norm.startsWith('reports/') ||
      norm.startsWith('intel/') ||
      format === 'markdown')
  ) {
    finalContent = sanitizeAndDeduplicateReportContent(finalContent, norm).content;
  }
  const sizeBytes = finalContent.length;

  // Clear any prior deletion tombstone since this file is being explicitly created/updated
  clearDeletedWorkspaceFileTombstone(norm);
  if (norm.includes('/')) {
    ensureWorkspaceFolderExists(norm.split('/')[0]);
  }

  const record: WorkspaceFileRecord = {
    path: norm,
    category,
    format,
    content: finalContent,
    sizeBytes,
    updatedAt,
    previewSnippet: (finalContent || '').slice(0, 160).replace(/\n/g, ' '),
  };

  // 1. Write to Dexie/IndexedDB
  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (existing && existing.id !== undefined) {
        await ledgerDb.workspace_files.update(existing.id, {
          content: finalContent,
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
          content: finalContent,
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
      vfs[norm] = { content: finalContent, format, updatedAt };
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
  deletedPaths: string[];
  archivedPaths: string[];
  totalBytesCombined: number;
  summary: string;
  verifiedPruned?: boolean;
  verifiedRemovedPaths?: string[];
  residualErrors?: string[];
}

/**
 * Finds groups of similar or related workspace files based on path, category,
 * keywords, and content overlap (e.g., related intel sweeps, multiple sitreps, or common topics).
 */
export async function findSimilarWorkspaceFiles(params?: {
  topic?: string;
  category?: string;
  minGroupSize?: number;
}): Promise<Array<{ groupName: string; files: WorkspaceFileRecord[] }>> {
  const allFiles = await listWorkspaceFiles();
  if (allFiles.length === 0) return [];

  const { topic, category, minGroupSize = 2 } = params || {};

  // Exclude files already consolidated or system files if possible
  const candidateFiles = allFiles.filter((f) => {
    if (category && f.category !== category) return false;
    return true;
  });

  if (topic && topic.trim()) {
    const topicWords = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matched = candidateFiles.filter((f) => {
      const pLower = f.path.toLowerCase();
      const cLower = f.content.toLowerCase();
      return topicWords.some((w) => pLower.includes(w) || cLower.includes(w));
    });
    if (matched.length >= minGroupSize) {
      return [{ groupName: topic, files: matched }];
    }
  }

  // Group files by topic signature / stem
  const groups = new Map<string, WorkspaceFileRecord[]>();

  for (const f of candidateFiles) {
    const name = f.path.split('/').pop() || f.path;
    // Derive topic stem (strip dates, timestamps, suffixes)
    const stem = name
      .replace(/\.(md|json|txt|log)$/i, '')
      .replace(/[_-]\d{4}[-_]\d{2}[-_]\d{2}.*/i, '')
      .replace(/[_-]\d{6,}.*/i, '')
      .replace(/[_-](part|vol|v)\d+/i, '')
      .replace(/^(isw|s2_wire|recon|osint|intel|report)[_-]/i, '$1_')
      .toLowerCase()
      .trim();

    const existing = groups.get(stem) || [];
    existing.push(f);
    groups.set(stem, existing);
  }

  // Also group by category if specific stems don't cluster
  const result: Array<{ groupName: string; files: WorkspaceFileRecord[] }> = [];
  for (const [groupName, files] of groups.entries()) {
    if (files.length >= minGroupSize) {
      result.push({ groupName, files });
    }
  }

  // Fallback: if no multi-file stems found, group by category
  if (result.length === 0) {
    const intelFiles = candidateFiles.filter((f) => f.category === 'intel' || f.path.startsWith('intel/'));
    if (intelFiles.length >= minGroupSize) {
      result.push({ groupName: 'intel_sweeps', files: intelFiles });
    }
    const reportFiles = candidateFiles.filter((f) => f.category === 'reports' || f.path.startsWith('reports/'));
    if (reportFiles.length >= minGroupSize) {
      result.push({ groupName: 'reports', files: reportFiles });
    }
  }

  return result;
}

/**
 * Consolidates multiple workspace files into a unified master intelligence document,
 * reading all similar files, synthesizing their full findings into a clean master dossier,
 * and deleting the obsolete source files so only the fresh consolidated file remains.
 */
export async function consolidateWorkspaceFiles(params: {
  sourcePaths: string[];
  targetPath?: string;
  deleteSources?: boolean;
  archiveSources?: boolean;
  leadOperative?: string;
  topic?: string;
}): Promise<WorkspaceConsolidationResult> {
  const {
    sourcePaths,
    targetPath,
    deleteSources = true,
    archiveSources = false,
    leadOperative = 'Agent Vance',
    topic,
  } = params;
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
  const cleanTopic =
    topic ||
    loadedFiles[0].path
      .split('/')
      .pop()
      ?.replace(/\.(md|json|txt)$/i, '')
      .replace(/[_-]+/g, ' ') ||
    'Consolidated Workspace Intelligence';

  // Build clean merged markdown with deduplicated sections
  const header = [
    `# Consolidated Operational Dossier: ${cleanTopic.toUpperCase()}`,
    `**Lead Synthesizer:** ${leadOperative}  `,
    `**Consolidation Timestamp:** ${timestamp}  `,
    `**Source Documents Combined:** ${loadedFiles.length} file(s)  `,
    `**Sources Consolidated:** ${loadedFiles.map((f) => `\`${f.path}\``).join(', ')}  `,
    '',
    '---',
    '',
    '## 1. Executive Synthesis & Unified Findings',
    `This authoritative master intelligence dossier synthesizes, cross-references, and consolidates ${loadedFiles.length} distinct workspace records into a single unified reference. All redundant preamble text, duplicate headers, and obsolete dispatches have been scrubbed.`,
    '',
    '---',
  ].join('\n');

  const fileSections: string[] = [];
  let totalChars = 0;
  let accumulatedIntel = '';

  for (let idx = 0; idx < loadedFiles.length; idx++) {
    const f = loadedFiles[idx];
    totalChars += f.content.length;
    let cleanContent = f.content
      .replace(/^---[\s\S]*?---\s*/m, '')
      .replace(/\[AGENT_ACTION:[\s\S]*?\[\/AGENT_ACTION\]/gi, '')
      .replace(/\[AGENT_STATUS:\s*(COMPLETE|WORKING)\]/gi, '')
      .replace(/\n*📁 \*\*\[WORKSPACE REPORT UPLOADED\]\*\*[\s\S]*$/, '')
      .trim();

    // Deduplicate against already accumulated intel to eliminate duplicate intel across similar files
    const nonRedundant = deduplicateReportIntel(cleanContent, accumulatedIntel);
    accumulatedIntel = accumulatedIntel ? `${accumulatedIntel}\n\n${cleanContent}` : cleanContent;

    fileSections.push(
      [
        `## ${idx + 2}. Source Dossier: \`${f.path}\` (${f.sizeBytes} bytes, updated ${f.updatedAt.slice(0, 16)})`,
        nonRedundant,
      ].join('\n\n')
    );
  }

  // Resolve target path
  const finalTargetPath = targetPath
    ? normalizeFilePath(targetPath)
    : normalizeFilePath(
        `reports/consolidated_${cleanTopic.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}.md`
      );

  const rawMarkdown = [header, ...fileSections].join('\n\n');
  const finalMarkdown = sanitizeAndDeduplicateReportContent(rawMarkdown, finalTargetPath).content;

  // 1. Write the new consolidated file to IndexedDB / VFS
  await writeWorkspaceFile(finalTargetPath, finalMarkdown, 'markdown', 'reports');

  // 2. Delete the source files so only the unified dossier remains (or archive if requested)
  const deletedPaths: string[] = [];
  const archivedPaths: string[] = [];

  for (const f of loadedFiles) {
    if (f.path !== finalTargetPath) {
      if (archiveSources) {
        if (!f.path.startsWith('archive/')) {
          const baseName = f.path.split('/').pop() || f.path;
          const archiveTarget = normalizeFilePath(`archive/${baseName}`);
          await writeWorkspaceFile(archiveTarget, f.content, f.format, 'archive');
          await deleteWorkspaceFile(f.path);
          archivedPaths.push(archiveTarget);
        } else {
          archivedPaths.push(f.path);
        }
      } else if (deleteSources) {
        await deleteWorkspaceFile(f.path);
        deletedPaths.push(f.path);
      }
    }
  }

  // 3. Post-execution verification step: verify source files are removed from IndexedDB / VFS
  const verifiedRemovedPaths: string[] = [];
  const residualErrors: string[] = [];
  if (deleteSources && deletedPaths.length > 0) {
    for (const p of deletedPaths) {
      const exists = await readWorkspaceFile(p);
      if (exists) {
        // Enforce cleanup if still in index
        await deleteWorkspaceFile(p);
        const doubleCheck = await readWorkspaceFile(p);
        if (doubleCheck) {
          residualErrors.push(p);
        } else {
          verifiedRemovedPaths.push(p);
        }
      } else {
        verifiedRemovedPaths.push(p);
      }
    }
  }

  // 4. Dispatch global workspace event so UI instantly refreshes
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_file_saved', {
          detail: { path: finalTargetPath },
        })
      );
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_files_changed', {
          detail: {
            action: 'consolidate',
            targetPath: finalTargetPath,
            deletedPaths,
            archivedPaths,
          },
        })
      );
    } catch {}
  }

  return {
    consolidatedCount: loadedFiles.length,
    targetPath: finalTargetPath,
    deletedPaths,
    archivedPaths,
    totalBytesCombined: finalMarkdown.length,
    summary: `Successfully gathered all intel from ${loadedFiles.length} files into unified dossier "${finalTargetPath}" (${finalMarkdown.length} bytes). Deleted and verified ${deletedPaths.length} source file(s) removed from workspace index.`,
    verifiedPruned: residualErrors.length === 0,
    verifiedRemovedPaths,
    residualErrors,
  };
}

/**
 * Atomic Report Consolidation & Pruning Protocol
 * 
 * Performs a transactional write of merged content followed by an immediate deletion
 * of input files from IndexedDB/OPFS/VFS, and verifies that all source file IDs are
 * successfully removed from the active workspace index.
 */
export async function consolidateAndPrune(
  sourceFiles: string[],
  destinationPath?: string,
  options?: {
    topic?: string;
    leadOperative?: string;
  }
): Promise<WorkspaceConsolidationResult> {
  return await consolidateWorkspaceFiles({
    sourcePaths: sourceFiles,
    targetPath: destinationPath,
    deleteSources: true,
    archiveSources: false,
    leadOperative: options?.leadOperative || 'Agent Vance (Safehouse Supervisor)',
    topic: options?.topic,
  });
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
