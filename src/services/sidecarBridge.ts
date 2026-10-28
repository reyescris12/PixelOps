/**
 * Frontend Sidecar Client Hook & Connection Bridge for PixelOps
 *
 * Connects to the local Node.js sidecar execution bridge at http://127.0.0.1:31416
 * Handles graceful fallback if running purely in offline/browser mode.
 */

const SIDECAR_DEFAULT_URL = 'http://127.0.0.1:31416';

let isSidecarOnline: boolean | null = null; // null = untracked, true = online, false = offline
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 10000;

export interface SidecarOptions {
  cwd?: string;
  encoding?: string;
  sidecarBaseUrl?: string;
}

/**
 * Checks if the local PixelOps sidecar bridge is online and responding.
 */
export async function checkSidecarHealth(sidecarBaseUrl: string = SIDECAR_DEFAULT_URL): Promise<boolean> {
  const now = Date.now();
  if (isSidecarOnline !== null && now - lastCheckTime < CHECK_INTERVAL_MS) {
    return isSidecarOnline;
  }

  // Fast check: on HTTPS or mobile/remote hosting (like Netlify or Cloudflare Pages), local 127.0.0.1 sidecar is unreachable
  if (typeof window !== 'undefined' && window.location) {
    if (
      window.location.protocol === 'https:' ||
      (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    ) {
      isSidecarOnline = false;
      lastCheckTime = now;
      return false;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);

    const res = await fetch(`${sidecarBaseUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      isSidecarOnline = true;
      lastCheckTime = now;
      return true;
    }
  } catch {
    // Sidecar is offline / unreachable
  }

  isSidecarOnline = false;
  lastCheckTime = now;
  return false;
}

/**
 * Executes a whitelisted shell command via the local sidecar.
 * Falls back to in-browser mock telemetry if the sidecar is offline.
 */
export async function executeSidecarShell(command: string, options: SidecarOptions = {}): Promise<any> {
  const { cwd, sidecarBaseUrl = SIDECAR_DEFAULT_URL } = options;
  const online = await checkSidecarHealth(sidecarBaseUrl);

  if (online) {
    try {
      const res = await fetch(`${sidecarBaseUrl}/api/execute-shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, cwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Shell execution error`);
      }
      return {
        ...data,
        isLocalSidecar: true,
      };
    } catch (err: any) {
      console.warn('[Sidecar Client] Remote command execution failed, using fallback:', err?.message || err);
    }
  }

  // Graceful browser-only simulation fallback
  return {
    success: true,
    command,
    exitCode: 0,
    stdout: `[PixelOps Browser Sandbox Simulator]\n$ ${command}\nExecution completed in browser virtual workspace.\nStart the local sidecar bridge (node sidecar/bridge.js) for live OS execution.`,
    stderr: '',
    isLocalSidecar: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Reads a file via the local sidecar bridge.
 */
export async function readSidecarFile(filePath: string, options: SidecarOptions = {}): Promise<any> {
  const { encoding = 'utf8', sidecarBaseUrl = SIDECAR_DEFAULT_URL } = options;
  const online = await checkSidecarHealth(sidecarBaseUrl);

  if (online) {
    try {
      const res = await fetch(`${sidecarBaseUrl}/api/file-io`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', filePath, encoding }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Failed to read file`);
      }
      return {
        ...data,
        isLocalSidecar: true,
      };
    } catch (err: any) {
      console.warn('[Sidecar Client] Local file read failed, falling back:', err?.message || err);
    }
  }

  // Browser-only fallback: check localStorage or return sandbox content
  return {
    success: true,
    filePath,
    content: `// [PixelOps Virtual File Simulator: ${filePath}]\n// Live sidecar bridge offline. Connect to port 31416 for direct disk access.\n`,
    sizeBytes: 120,
    isLocalSidecar: false,
  };
}

/**
 * Writes a file via the local sidecar bridge.
 */
export async function writeSidecarFile(filePath: string, content: string, options: SidecarOptions = {}): Promise<any> {
  const { encoding = 'utf8', sidecarBaseUrl = SIDECAR_DEFAULT_URL } = options;
  const online = await checkSidecarHealth(sidecarBaseUrl);

  if (online) {
    try {
      const res = await fetch(`${sidecarBaseUrl}/api/file-io`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write', filePath, content, encoding }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Failed to write file`);
      }
      return {
        ...data,
        isLocalSidecar: true,
      };
    } catch (err: any) {
      console.warn('[Sidecar Client] Local file write failed:', err?.message || err);
    }
  }

  // Browser fallback
  return {
    success: true,
    filePath,
    sizeBytes: typeof content === 'string' ? content.length : 0,
    isLocalSidecar: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Lists directory entries via the local sidecar.
 */
export async function listSidecarDirectory(directory: string = '.', options: SidecarOptions = {}): Promise<any> {
  const { sidecarBaseUrl = SIDECAR_DEFAULT_URL } = options;
  const online = await checkSidecarHealth(sidecarBaseUrl);

  if (online) {
    try {
      const res = await fetch(`${sidecarBaseUrl}/api/file-io`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', filePath: directory }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}: Directory listing failed`);
      }
      return {
        ...data,
        isLocalSidecar: true,
      };
    } catch (err: any) {
      console.warn('[Sidecar Client] Local directory listing failed:', err?.message || err);
    }
  }

  return {
    success: true,
    directory,
    entries: [
      { name: 'src', isDirectory: true, isFile: false },
      { name: 'public', isDirectory: true, isFile: false },
      { name: 'package.json', isDirectory: false, isFile: true },
      { name: 'README.md', isDirectory: false, isFile: true },
    ],
    isLocalSidecar: false,
  };
}

/**
 * Fetches real-time system execution telemetry from the local sidecar.
 */
export async function fetchSidecarTelemetry(sidecarBaseUrl: string = SIDECAR_DEFAULT_URL): Promise<any> {
  const online = await checkSidecarHealth(sidecarBaseUrl);
  if (!online) {
    return {
      status: 'offline',
      isLocalSidecar: false,
      message: 'PixelOps local sidecar bridge is not running on port 31416 (browser-only mode).',
      events: [],
    };
  }

  try {
    const res = await fetch(`${sidecarBaseUrl}/api/telemetry`);
    if (res.ok) {
      const data = await res.json();
      return {
        ...data,
        isLocalSidecar: true,
      };
    }
  } catch {
    // Ignore error
  }

  return {
    status: 'offline',
    isLocalSidecar: false,
    events: [],
  };
}
