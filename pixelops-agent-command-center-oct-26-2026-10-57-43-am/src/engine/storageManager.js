/**
 * IndexedDB Storage Service Bridge (storageManager.js)
 */

let ledgerDb = null;
try {
  if (typeof globalThis !== 'undefined' && globalThis.__ledgerDb) {
    ledgerDb = globalThis.__ledgerDb;
  }
} catch {}

const VFS_KEY = 'pixelops_vfs_files_v1';
const memoryFileMap = new Map();

export function resolveCategoryFromPath(path, explicitCategory) {
  if (explicitCategory) return explicitCategory;
  const clean = String(path || '').replace(/^[\\/]+/, '').toLowerCase();
  if (clean.startsWith('reports/') || clean.startsWith('reports\\')) return 'reports';
  if (clean.startsWith('logs/') || clean.startsWith('logs\\')) return 'logs';
  if (clean.startsWith('config/') || clean.startsWith('config\\')) return 'config';
  if (clean.startsWith('archive/') || clean.startsWith('archive\\')) return 'archive';
  if (clean.startsWith('data/') || clean.startsWith('data\\')) return 'data';
  if (clean.endsWith('.md')) return 'reports';
  if (clean.endsWith('.json')) return 'config';
  return 'reports';
}

export function resolveFormatFromPath(path, explicitFormat) {
  if (explicitFormat) return explicitFormat;
  const clean = String(path || '').toLowerCase();
  if (clean.endsWith('.md')) return 'markdown';
  if (clean.endsWith('.json')) return 'json';
  if (clean.endsWith('.csv')) return 'csv';
  if (clean.endsWith('.log') || clean.endsWith('.txt')) return 'text';
  return 'markdown';
}

export function normalizeFilePath(rawPath) {
  return String(rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

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

export async function listWorkspaceFiles(categoryFilter) {
  const mergedMap = new Map();

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

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      if (raw) {
        const vfs = JSON.parse(raw);
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
    } catch {}
  }

  for (const [norm, rec] of memoryFileMap.entries()) {
    if (!mergedMap.has(norm)) {
      mergedMap.set(norm, rec);
    }
  }

  let fileList = Array.from(mergedMap.values());

  if (categoryFilter && categoryFilter !== 'all') {
    fileList = fileList.filter((f) => f.category === categoryFilter);
  }

  fileList.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return fileList;
}

export async function readWorkspaceFile(rawPath) {
  const norm = normalizeFilePath(rawPath);
  if (!norm) return null;

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
  } catch {}

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

  if (memoryFileMap.has(norm)) {
    return memoryFileMap.get(norm);
  }

  return null;
}

export async function writeWorkspaceFile(rawPath, content, explicitFormat, explicitCategory) {
  const norm = normalizeFilePath(rawPath);
  const category = resolveCategoryFromPath(norm, explicitCategory);
  const format = resolveFormatFromPath(norm, explicitFormat);
  const updatedAt = new Date().toISOString();
  const sizeBytes = (content || '').length;

  const record = {
    path: norm,
    category,
    format,
    content,
    sizeBytes,
    updatedAt,
    previewSnippet: (content || '').slice(0, 160).replace(/\n/g, ' '),
  };

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

  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(VFS_KEY);
      const vfs = raw ? JSON.parse(raw) : {};
      vfs[norm] = { content, format, updatedAt };
      localStorage.setItem(VFS_KEY, JSON.stringify(vfs));
    } catch {}
  }

  memoryFileMap.set(norm, record);
  return record;
}

export async function deleteWorkspaceFile(rawPath) {
  const norm = normalizeFilePath(rawPath);
  let deleted = false;

  try {
    if (ledgerDb && ledgerDb.workspace_files) {
      const existing = await ledgerDb.workspace_files.where('path').equals(norm).first();
      if (existing && existing.id !== undefined) {
        await ledgerDb.workspace_files.delete(existing.id);
        deleted = true;
      }
    }
  } catch {}

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

  if (memoryFileMap.has(norm)) {
    memoryFileMap.delete(norm);
    deleted = true;
  }

  return deleted;
}

export async function exportWorkspaceFile(rawPath) {
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

export async function copyWorkspaceFileContent(rawPath) {
  const file = await readWorkspaceFile(rawPath);
  if (!file) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(file.content);
      return true;
    } catch {}
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

export async function seedInitialWorkspaceFiles(force = false) {
  const existing = await listWorkspaceFiles();
  if (existing.length > 0 && !force) {
    return existing;
  }

  const seeded = [];
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

export async function getWorkspaceCategories() {
  const files = await listWorkspaceFiles();
  const set = new Set(['reports', 'logs', 'config']);
  for (const f of files) {
    if (f.category) set.add(f.category);
  }
  return Array.from(set);
}
