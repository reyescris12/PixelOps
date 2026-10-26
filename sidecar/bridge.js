/**
 * PixelOps Local Node.js Sidecar Execution Bridge
 * Runs on http://127.0.0.1:31416
 *
 * Provides secure local system operations:
 * - /api/health          : Heartbeat & workspace root telemetry
 * - /api/execute-shell   : Runs safe whitelisted terminal commands with strict timeouts
 * - /api/file-io         : Reads & writes files strictly bounded inside workspace root
 * - /api/telemetry       : Real-time system metrics & execution telemetry
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = Number(process.env.PIXELOPS_SIDECAR_PORT) || 31416;
export const WORKSPACE_ROOT = path.resolve(process.env.PIXELOPS_WORKSPACE_ROOT || path.join(__dirname, '..'));

// Maximum command execution timeout (12 seconds)
const EXEC_TIMEOUT_MS = 12000;
// Maximum output buffer size (512 KB)
const MAX_BUFFER = 512 * 1024;

// Safe whitelisted command prefixes allowed to run through the sidecar
const ALLOWED_COMMAND_PREFIXES = [
  'node',
  'npm',
  'git',
  'dir',
  'echo',
  'ls',
  'cat',
  'pwd',
  'type',
  'where',
  'which',
  'whoami',
  'python',
  'tsc',
  'vite',
  'findstr',
  'grep',
];

// Dangerous patterns strictly blocked
const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf/i,
  /format/i,
  /del\s+\/s/i,
  /rmdir\s+\/s/i,
  /powershell\s+.*-enc/i,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd/,
  /drop\s+database/i,
];

// Telemetry log ring buffer (last 50 events)
const telemetryEvents = [];

function recordTelemetry(event) {
  const item = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  telemetryEvents.unshift(item);
  if (telemetryEvents.length > 50) telemetryEvents.pop();
  return item;
}

/**
 * Validates and resolves a target file path strictly inside WORKSPACE_ROOT.
 * Prevents directory traversal attacks (e.g., ../../../etc/passwd).
 */
export function resolveSafePath(userPath) {
  if (!userPath || typeof userPath !== 'string') {
    throw new Error('Missing target path');
  }
  const sanitized = userPath.replace(/\0/g, '').trim();
  const resolved = path.resolve(WORKSPACE_ROOT, sanitized);

  const relative = path.relative(WORKSPACE_ROOT, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Access denied: target path escapes designated workspace boundary');
  }
  return resolved;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large (max 2MB)'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error('Invalid JSON payload: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const json = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

export const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    // 1. Health & Heartbeat
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'pixelops-local-sidecar',
        version: '1.0.0',
        port: PORT,
        workspaceRoot: WORKSPACE_ROOT,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Safe Shell Execution
    if (pathname === '/api/execute-shell' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const command = (body.command || '').trim();

      if (!command) {
        return sendJson(res, 400, { error: 'Missing "command" in request body' });
      }

      // Check blocked dangerous patterns
      for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
          recordTelemetry({ type: 'shell_blocked', command, reason: 'Matched blocked safety pattern' });
          return sendJson(res, 403, {
            error: 'Command blocked by PixelOps security sandbox: matches dangerous execution pattern',
          });
        }
      }

      // Check allowed prefixes
      const tokens = command.split(/\s+/);
      const rootBinary = tokens[0].toLowerCase();
      const isAllowed = ALLOWED_COMMAND_PREFIXES.some((prefix) => rootBinary === prefix || rootBinary.endsWith(path.sep + prefix));

      if (!isAllowed) {
        recordTelemetry({ type: 'shell_blocked', command, reason: `Binary "${rootBinary}" not in whitelist` });
        return sendJson(res, 403, {
          error: `Execution denied: binary "${rootBinary}" is not in the sidecar security whitelist (${ALLOWED_COMMAND_PREFIXES.join(', ')})`,
        });
      }

      const cwd = body.cwd ? resolveSafePath(body.cwd) : WORKSPACE_ROOT;

      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd,
            timeout: EXEC_TIMEOUT_MS,
            maxBuffer: MAX_BUFFER,
            env: { ...process.env, NODE_ENV: 'development' },
          },
          (error, stdout, stderr) => {
            const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
            const event = recordTelemetry({
              type: 'shell_executed',
              command,
              cwd: path.relative(WORKSPACE_ROOT, cwd) || '.',
              exitCode,
              outputLength: (stdout || '').length + (stderr || '').length,
            });

            sendJson(res, 200, {
              success: exitCode === 0,
              command,
              exitCode,
              stdout: (stdout || '').toString(),
              stderr: (stderr || '').toString(),
              eventId: event.id,
              timestamp: new Date().toISOString(),
            });
            resolve();
          }
        );
      });
    }

    // 3. File I/O Operations (Read, Write, List, Stat, Exists)
    if (pathname === '/api/file-io' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { action, filePath, content, encoding = 'utf8' } = body;

      if (!action) {
        return sendJson(res, 400, { error: 'Missing "action" parameter (read, write, list, stat, exists)' });
      }

      const safePath = resolveSafePath(filePath || '.');

      if (action === 'read') {
        if (!fs.existsSync(safePath)) {
          return sendJson(res, 404, { error: `File not found: ${filePath}` });
        }
        const stat = fs.statSync(safePath);
        if (stat.isDirectory()) {
          return sendJson(res, 400, { error: `Target path is a directory, use action: "list"` });
        }
        if (stat.size > 2 * 1024 * 1024) {
          return sendJson(res, 400, { error: 'File exceeds 2MB read limit' });
        }
        const data = fs.readFileSync(safePath, encoding);
        recordTelemetry({ type: 'file_read', path: path.relative(WORKSPACE_ROOT, safePath) });
        return sendJson(res, 200, {
          success: true,
          filePath: path.relative(WORKSPACE_ROOT, safePath),
          sizeBytes: stat.size,
          content: data,
        });
      }

      if (action === 'write') {
        if (content === undefined || content === null) {
          return sendJson(res, 400, { error: 'Missing "content" for write action' });
        }
        const parentDir = path.dirname(safePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(safePath, content, encoding);
        const stat = fs.statSync(safePath);
        recordTelemetry({ type: 'file_write', path: path.relative(WORKSPACE_ROOT, safePath), sizeBytes: stat.size });
        return sendJson(res, 200, {
          success: true,
          filePath: path.relative(WORKSPACE_ROOT, safePath),
          sizeBytes: stat.size,
          timestamp: new Date().toISOString(),
        });
      }

      if (action === 'list') {
        if (!fs.existsSync(safePath)) {
          return sendJson(res, 404, { error: `Directory not found: ${filePath}` });
        }
        const entries = fs.readdirSync(safePath, { withFileTypes: true }).map((ent) => ({
          name: ent.name,
          isDirectory: ent.isDirectory(),
          isFile: ent.isFile(),
        }));
        recordTelemetry({ type: 'dir_list', path: path.relative(WORKSPACE_ROOT, safePath) });
        return sendJson(res, 200, {
          success: true,
          directory: path.relative(WORKSPACE_ROOT, safePath) || '.',
          entries,
        });
      }

      if (action === 'stat' || action === 'exists') {
        const exists = fs.existsSync(safePath);
        if (!exists) {
          return sendJson(res, 200, { exists: false });
        }
        const stat = fs.statSync(safePath);
        return sendJson(res, 200, {
          exists: true,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }

      return sendJson(res, 400, { error: `Unsupported action: "${action}"` });
    }

    // 4. Streaming Execution Telemetry
    if (pathname === '/api/telemetry' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'active',
        eventCount: telemetryEvents.length,
        events: telemetryEvents,
        memoryUsage: process.memoryUsage(),
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }

    // Default 404
    return sendJson(res, 404, { error: `Endpoint not found: ${req.method} ${pathname}` });
  } catch (err) {
    recordTelemetry({ type: 'internal_error', error: err.message });
    return sendJson(res, 500, { error: err.message || 'Internal sidecar execution error' });
  }
});

// Auto-start if run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[PixelOps Sidecar] Execution bridge active at http://127.0.0.1:${PORT}`);
    console.log(`[PixelOps Sidecar] Workspace root bounded to: ${WORKSPACE_ROOT}`);
  });
}

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

export default server;
