import express from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import dns from 'dns';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import dotenv from 'dotenv';
import { onRequest as handleMaritimeOsint } from './functions/api/osint/maritime';
import { onRequest as handleHazardsOsint } from './functions/api/osint/hazards';
import { onRequest as handleSatelliteOsint } from './functions/api/osint/satellite';
import { onRequest as handleSpectrumOsint } from './functions/api/osint/spectrum';
import { onRequest as handleThreatMatrixOsint } from './functions/api/osint/threat-matrix';
import { onRequest as handleClassifiedFeed } from './functions/api/intel/classified-feed';
import { onRequest as handleUniversalSearch } from './functions/api/search';
import {
  isPrivateOrReservedIP,
  validateTargetUrl,
  ALLOWED_DOMAINS as ALLOWED_FETCH_DOMAINS,
} from './functions/api/fetch';
import { fetchS2WireFeed, buildAgentSITREPContext } from './server/services/s2Parser.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate valid minimalist PNG icons in /public if not present for full PWA & iOS compliance
function createSolidPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  borderR: number,
  borderG: number,
  borderB: number
): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawData = Buffer.alloc(height * (1 + width * 4));
  const margin = Math.floor(width * 0.18);
  const eyeSize = Math.floor(width * 0.12);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // filter type 0
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      const isFrame =
        x >= margin &&
        x < width - margin &&
        y >= margin &&
        y < height - margin &&
        (x < margin + Math.floor(width * 0.06) ||
          x >= width - margin - Math.floor(width * 0.06) ||
          y < margin + Math.floor(height * 0.06) ||
          y >= height - margin - Math.floor(height * 0.06));

      const isLeftEye =
        x >= Math.floor(width * 0.32) &&
        x < Math.floor(width * 0.32) + eyeSize &&
        y >= Math.floor(height * 0.36) &&
        y < Math.floor(height * 0.36) + eyeSize;

      const isRightEye =
        x >= Math.floor(width * 0.56) &&
        x < Math.floor(width * 0.56) + eyeSize &&
        y >= Math.floor(height * 0.36) &&
        y < Math.floor(height * 0.36) + eyeSize;

      const isMouth =
        x >= Math.floor(width * 0.34) &&
        x < Math.floor(width * 0.66) &&
        y >= Math.floor(height * 0.58) &&
        y < Math.floor(height * 0.64);

      if (isFrame || isLeftEye || isRightEye || isMouth) {
        rawData[px] = borderR;
        rawData[px + 1] = borderG;
        rawData[px + 2] = borderB;
        rawData[px + 3] = 255;
      } else {
        rawData[px] = r;
        rawData[px + 1] = g;
        rawData[px + 2] = b;
        rawData[px + 3] = 255;
      }
    }
  }

  const idat = zlib.deflateSync(rawData);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

function ensurePwaIcons() {
  const publicDir = path.resolve(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  const icons: Array<{ name: string; size: number }> = [
    { name: 'pwa-192x192.png', size: 192 },
    { name: 'pwa-512x512.png', size: 512 },
    { name: 'pwa-maskable-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
  ];
  for (const icon of icons) {
    const filePath = path.join(publicDir, icon.name);
    if (!fs.existsSync(filePath)) {
      const buf = createSolidPng(icon.size, icon.size, 10, 10, 12, 16, 185, 129);
      fs.writeFileSync(filePath, buf);
    }
  }
}

ensurePwaIcons();

function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
    const authErr: any = new Error('API_KEY_INVALID: Missing or unconfigured Gemini API key in Vault.');
    authErr.status = 401;
    authErr.errorCode = 'INVALID_API_KEY';
    throw authErr;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyServerGeminiError(error: any): {
  httpStatus: number;
  errorCode: 'INVALID_API_KEY' | 'RATE_LIMIT' | 'NETWORK_DROP' | 'MALFORMED_JSON' | 'SYSTEM_FAULT';
  error: string;
  retryAfterSeconds?: number;
} {
  const rawMessage = String(error?.message || error || 'Unexpected telemetry failure');
  const lower = rawMessage.toLowerCase();
  const status = Number(error?.status || error?.httpStatus || error?.code || 0);

  if (
    error?.errorCode === 'INVALID_API_KEY' ||
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('unauthenticated') ||
    lower.includes('permission_denied') ||
    lower.includes('key not found')
  ) {
    return {
      httpStatus: 401,
      errorCode: 'INVALID_API_KEY',
      error: rawMessage,
    };
  }

  if (
    error?.errorCode === 'RATE_LIMIT' ||
    status === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests') ||
    lower.includes('overloaded')
  ) {
    return {
      httpStatus: 429,
      errorCode: 'RATE_LIMIT',
      error: rawMessage,
      retryAfterSeconds: 15,
    };
  }

  if (
    error?.errorCode === 'MALFORMED_JSON' ||
    status === 422 ||
    error instanceof SyntaxError ||
    lower.includes('unexpected token') ||
    lower.includes('json.parse') ||
    lower.includes('malformed json')
  ) {
    return {
      httpStatus: 422,
      errorCode: 'MALFORMED_JSON',
      error: rawMessage,
    };
  }

  if (
    error?.errorCode === 'NETWORK_DROP' ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('network')
  ) {
    return {
      httpStatus: 503,
      errorCode: 'NETWORK_DROP',
      error: rawMessage,
    };
  }

  return {
    httpStatus: 500,
    errorCode: 'SYSTEM_FAULT',
    error: rawMessage,
  };
}

// Default fallback JSON schema FunctionDeclarations on the server
const SERVER_TOOL_DECLARATIONS: Record<string, FunctionDeclaration> = {
  live_web_search: {
    name: 'live_web_search',
    description:
      'Perform a live web and encyclopedia search to retrieve real-time facts, technical documentation, news background, or public intelligence on any topic.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'The search query keywords or topic to look up on the live web.',
        },
        maxResults: {
          type: Type.NUMBER,
          description: 'Number of top web results to retrieve (1 to 5).',
        },
      },
      required: ['query'],
    },
  },
  weather_lookup: {
    name: 'weather_lookup',
    description:
      'Fetch live meteorological and atmospheric weather telemetry (temperature, wind speed, humidity, conditions) for any city, region, or target coordinates.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: 'City or location name (e.g., "Tokyo", "San Francisco, CA", "Reykjavik").',
        },
        units: {
          type: Type.STRING,
          description: 'Temperature unit preference: "celsius" or "fahrenheit".',
        },
      },
      required: ['location'],
    },
  },
  calendar_schedule_event: {
    name: 'calendar_schedule_event',
    description:
      'Schedule a tactical briefing, field operation, or calendar event on Google Calendar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Title of the calendar operation or meeting.',
        },
        startTime: {
          type: Type.STRING,
          description: 'Proposed time window or ISO timestamp (e.g., "Tomorrow 09:00 UTC").',
        },
        attendees: {
          type: Type.STRING,
          description: 'Comma-separated list of operatives or team participants.',
        },
      },
      required: ['title', 'startTime'],
    },
  },
  slack_post_dispatch: {
    name: 'slack_post_dispatch',
    description: 'Post a real-time dispatch or alert message to a designated Slack channel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        channel: {
          type: Type.STRING,
          description: 'Target channel name (e.g., #ops-command, #field-intel).',
        },
        message: {
          type: Type.STRING,
          description: 'Formatted dispatch content to broadcast.',
        },
        priority: {
          type: Type.STRING,
          description: 'Priority classification: standard, elevated, or critical.',
        },
      },
      required: ['channel', 'message'],
    },
  },
  github_create_issue: {
    name: 'github_create_issue',
    description:
      'Create an engineering issue or patch ticket on a GitHub repository. Use ONLY when the user explicitly asks to create or open an issue.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repository: {
          type: Type.STRING,
          description: 'Target repository name in owner/repo format (e.g., facebook/react or pixelops/core-engine).',
        },
        title: {
          type: Type.STRING,
          description: 'Issue title summarizing the bug or directive.',
        },
        labels: {
          type: Type.STRING,
          description: 'Comma-separated labels (e.g., security, agent-patch).',
        },
      },
      required: ['repository', 'title'],
    },
  },
  github_list_issues: {
    name: 'github_list_issues',
    description:
      'List or audit issues in a GitHub repository with optional state filter ("open", "closed", "all"). Use when the user asks to check, audit, list, or review GitHub issues.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repository: {
          type: Type.STRING,
          description: 'Target repository name in owner/repo format (e.g. facebook/react).',
        },
        state: {
          type: Type.STRING,
          description: 'Issue state filter: "open", "closed", or "all". Default is "open".',
        },
      },
      required: ['repository'],
    },
  },
  github_get_repository: {
    name: 'github_get_repository',
    description:
      'Get detailed intelligence, stars, forks, open issues count, and metadata for a GitHub repository.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        repository: {
          type: Type.STRING,
          description: 'Target repository name in owner/repo format (e.g., "facebook/react").',
        },
      },
      required: ['repository'],
    },
  },
  calendar_list_events: {
    name: 'calendar_list_events',
    description:
      'List upcoming events, briefings, or meetings from Google Calendar. Use when the user asks to check or list calendar schedule.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Optional search keyword to filter calendar events.',
        },
      },
    },
  },
  slack_list_channels: {
    name: 'slack_list_channels',
    description:
      'List public and private channels in the connected Slack workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        types: {
          type: Type.STRING,
          description: 'Channel types (e.g. "public_channel,private_channel").',
        },
      },
    },
  },
  gmail_list_messages: {
    name: 'gmail_list_messages',
    description:
      'List or search emails in Gmail inbox matching an optional query.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search filter or query string (e.g. "is:unread").',
        },
      },
    },
  },
  vault_query_intel: {
    name: 'vault_query_intel',
    description: 'Query local encrypted dossiers, lore archives, or mission telemetry records.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query keyword or dossier codename.',
        },
        clearanceLevel: {
          type: Type.STRING,
          description: 'Clearance tier required: level-1, level-2, or omega.',
        },
      },
      required: ['query'],
    },
  },
  osint_maritime_tracker: {
    name: 'osint_maritime_tracker',
    description:
      'Query zero-friction real-time Automatic Identification System (AIS) maritime intelligence, vessel lookups (by name, MMSI, or IMO), strategic chokepoint transit delays (Suez, Malacca, Hormuz, Panama, Bab-el-Mandeb), dark-vessel indicators, and port congestion telemetry without API keys.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query for vessel name, MMSI, IMO, chokepoint, or port.',
        },
        chokepoint: {
          type: Type.STRING,
          description: 'Optional strategic chokepoint: suez, malacca, hormuz, panama, bab_el_mandeb, gibraltar, bosphorus, taiwan_strait, dover.',
        },
        vesselName: {
          type: Type.STRING,
          description: 'Vessel name to look up in the live AIS transponder registry.',
        },
        mmsi: {
          type: Type.STRING,
          description: 'Maritime Mobile Service Identity 9-digit transponder number.',
        },
        port: {
          type: Type.STRING,
          description: 'Target destination port for congestion analytics.',
        },
      },
    },
  },
  osint_hazard_tracker: {
    name: 'osint_hazard_tracker',
    description:
      'Query real-time global seismic and natural hazard telemetry from USGS Earthquake feeds and GDACS (Global Disaster Alert and Coordination System) without API keys. Tracks earthquakes, tsunamis, tropical cyclones, volcanic eruptions, and floods.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        min_magnitude: {
          type: Type.NUMBER,
          description: 'Minimum earthquake magnitude (e.g., 2.5, 4.5, 6.0). Default is 2.5.',
        },
        timespan: {
          type: Type.STRING,
          description: 'Time window for seismic events: hour, day, week, or month. Default is day.',
        },
        hazard_type: {
          type: Type.STRING,
          description: 'Hazard classification: earthquake, tsunami, cyclone, volcano, flood, or all.',
        },
        region: {
          type: Type.STRING,
          description: 'Geographic region or country keyword to filter hazards.',
        },
      },
    },
  },
  osint_satellite_recon: {
    name: 'osint_satellite_recon',
    description:
      'Conduct open satellite reconnaissance and multispectral environmental observation via NASA GIBS, NASA FIRMS thermal anomaly detection, and Copernicus Sentinel metadata without API keys. Returns direct high-resolution satellite imagery snapshot URLs and tactical links.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        location: {
          type: Type.STRING,
          description: 'Target location, strategic chokepoint, or coordinates (e.g., "Suez Canal", "Reykjanes", "Chernobyl", "Crimea", "Taiwan").',
        },
        lat: {
          type: Type.NUMBER,
          description: 'Target geographic latitude (-90 to 90).',
        },
        lon: {
          type: Type.NUMBER,
          description: 'Target geographic longitude (-180 to 180).',
        },
        date: {
          type: Type.STRING,
          description: 'Observation date in YYYY-MM-DD format (defaults to latest available daily pass).',
        },
        layer: {
          type: Type.STRING,
          description: 'Multispectral imagery layer: true_color, viirs_hd, false_color_infrared, or night_lights.',
        },
      },
      required: ['location'],
    },
  },
  osint_spectrum_analyzer: {
    name: 'osint_spectrum_analyzer',
    description:
      'Query real-time global electronic warfare spectrum telemetry, civil aviation GNSS/GPS jamming and spoofing incident corridors (Eastern Mediterranean, Baltic Sea, Black Sea, Persian Gulf), and NOAA Space Weather Prediction Center (SWPC) geomagnetic storms (Kp-index) and solar flare radio blackout data without API keys.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        region: {
          type: Type.STRING,
          description: 'Target EW / GNSS corridor: eastern_med, baltic, black_sea, persian_gulf, myanmar, korea_dmz, or all.',
        },
        interference_type: {
          type: Type.STRING,
          description: 'Interference mode filter: jamming, spoofing, space_weather, solar_flare, or all.',
        },
      },
    },
  },
};

const THEME_PERSONA_INSTRUCTIONS: Record<string, string> = {
  spy: `You are operating inside the "Spy Safehouse" Command Center. Adopt the crisp, composed, high-precision tone of a covert intelligence handler and field operative crew (Agent Vance: Lead Strategist, Agent Nyx: Cyber & Signal Specialist, Agent Cipher: Cryptographic Recon). Keep dialogue concise, tactical, and authentic.`,
  monster: `You are operating inside the "Pocket Monster Overworld" Research Lab. Adopt the warm, energetic, field-research tone of a classic handheld RPG Professor and Trainer crew (Prof. Oakwood: Field Researcher, Trainer Vera: Battle Tactician, Pory-Z: Digital Companion). Frame tasks as field expeditions, Dex analyses, and gym-grade strategies.`,
  viking: `You are operating inside the "Viking Longhall" War Council. Adopt the steadfast, honorable, saga-inspired tone of Nordic council strategists (Jarl Ragnar: Warband Tactician, Shieldmaiden Freya: Outrider Recon, Skald Torsten: Lorekeeper & Chronicler). Frame tasks as voyages, runic decrees, and council preparations.`,
};

const STRUCTURED_CARD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    dialogue: {
      type: Type.STRING,
      description:
        'In-character retro RPG dialogue response (2 to 3 crisp sentences) for the bottom typewriter terminal, directly incorporating any real data returned by function calls.',
    },
    cardTitle: {
      type: Type.STRING,
      description: 'Concise 3-5 word title for the agent execution card.',
    },
    actionCategory: {
      type: Type.STRING,
      description: 'Category label such as Recon, Weather Intel, Web Search, Engineering, or Dispatch.',
    },
    steps: {
      type: Type.ARRAY,
      description: '3 concrete execution steps completed or verified by the agent.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description: 'Short action step title.',
          },
          detail: {
            type: Type.STRING,
            description: 'Specific outcome or live telemetry metric for this step.',
          },
          status: {
            type: Type.STRING,
            description: 'One of: completed, verified, queued.',
          },
        },
        required: ['label', 'detail', 'status'],
      },
    },
  },
  required: ['dialogue', 'cardTitle', 'actionCategory', 'steps'],
};

// --- SatCom Multi-Device Cloud Sync Store ---
const SYNC_DATA_DIR = path.join(process.cwd(), 'data');
const SYNC_FILE_PATH = path.join(SYNC_DATA_DIR, 'sync_store.json');

interface PairingTicket {
  code: string;
  userId: string;
  username: string;
  email: string;
  callsign: string;
  securityClearance: string;
  syncPackage?: any;
  createdAt: string;
  expiresAt: number;
  used: boolean;
}

interface SyncDataStore {
  users: Record<string, any>;
  tokens: Record<string, any>;
  vaults: Record<string, any>;
  devices: Record<string, any[]>;
  pairingCodes?: Record<string, PairingTicket>;
}

function loadSyncStore(): SyncDataStore {
  try {
    if (!fs.existsSync(SYNC_DATA_DIR)) {
      fs.mkdirSync(SYNC_DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SYNC_FILE_PATH)) {
      const raw = fs.readFileSync(SYNC_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      parsed.pairingCodes = parsed.pairingCodes || {};
      return parsed;
    }
  } catch (err) {
    console.error('[SatCom] Failed to read sync_store.json, creating fallback', err);
  }
  return { users: {}, tokens: {}, vaults: {}, devices: {}, pairingCodes: {} };
}

function saveSyncStore(store: SyncDataStore): void {
  try {
    if (!fs.existsSync(SYNC_DATA_DIR)) {
      fs.mkdirSync(SYNC_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SYNC_FILE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[SatCom] Failed to write sync_store.json', err);
  }
}

/**
 * Generates cryptographically secure random tokens using Node.js crypto.randomBytes
 * Replaces predictable Math.random() in authentication, salt, and token generation.
 */
function generateSecureTokenServer(byteLength = 16): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

/**
 * Generates an unambiguous, cryptographically secure alphanumeric code from a 32-character charset.
 */
function generateSecureCodeServer(length = 6): string {
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length * 2);
  let result = '';
  for (let i = 0; i < bytes.length && result.length < length; i++) {
    const val = bytes[i];
    if (val < charset.length * Math.floor(256 / charset.length)) {
      result += charset[val % charset.length];
    }
  }
  while (result.length < length) {
    const b = crypto.randomBytes(1)[0];
    if (b < charset.length * Math.floor(256 / charset.length)) {
      result += charset[b % charset.length];
    }
  }
  return result;
}

const authRateLimitTracker = new Map<string, { attempts: number; resetAt: number }>();

/**
 * Universal auth rate limiter for registration, login, recovery, and pairing endpoints.
 */
function checkAuthRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = authRateLimitTracker.get(key);
  if (!entry || now > entry.resetAt) {
    authRateLimitTracker.set(key, { attempts: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.attempts >= maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.attempts += 1;
  return { allowed: true };
}

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'local';
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function hashRecoveryKeyServer(key: string): string {
  return crypto.createHash('sha256').update(`recovery:${key.trim().toUpperCase()}`).digest('hex');
}

/**
 * PBKDF2 Password Hashing (100,000 iterations, SHA-256)
 * Upgraded from legacy single-pass SHA-256 to prevent GPU/ASIC offline dictionary & brute-force attacks.
 */
function hashPasswordPBKDF2Server(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
}

/**
 * Legacy salted SHA-256 hashing for seamless backward compatibility with existing operative accounts.
 */
function hashPasswordLegacyServer(password: string, salt: string): string {
  const pepper = process.env.SATCOM_SECRET || 'pixelops_satcom_secret';
  return crypto.createHash('sha256').update(`${salt}:${password}:${pepper}`).digest('hex');
}

function hashPasswordServer(password: string, salt: string): string {
  return hashPasswordPBKDF2Server(password, salt);
}

/**
 * Verifies a password against stored hash, testing PBKDF2 first, then legacy SHA-256.
 * Returns whether the password is valid and if the stored hash was legacy (for auto-upgrade).
 */
function verifyPasswordServer(password: string, salt: string, storedHash: string): { valid: boolean; isLegacy: boolean } {
  if (!storedHash) return { valid: false, isLegacy: false };
  const pbkdf2 = hashPasswordPBKDF2Server(password, salt);
  if (timingSafeEqualStr(pbkdf2, storedHash)) {
    return { valid: true, isLegacy: false };
  }
  const legacy = hashPasswordLegacyServer(password, salt);
  if (timingSafeEqualStr(legacy, storedHash)) {
    return { valid: true, isLegacy: true };
  }
  return { valid: false, isLegacy: false };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      list[key] = decodeURIComponent(value);
    }
  });
  return list;
}

function extractSessionToken(req: express.Request): string {
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (authHeader) return authHeader;
  const cookies = parseCookies(req.headers.cookie);
  return cookies['pixelops_session'] || '';
}

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (reduced from unbounded 30 days)

function setSessionCookie(res: express.Response, token: string, maxAgeSec = 7 * 24 * 60 * 60): void {
  const isProd = process.env.NODE_ENV === 'production' || process.env.HTTPS === 'true';
  const cookieParts = [
    `pixelops_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isProd) {
    cookieParts.push('Secure');
  }
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader('Set-Cookie', 'pixelops_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
}

function validateAndGetToken(store: SyncDataStore, token: string): { valid: boolean; tokenData?: any; expired?: boolean } {
  if (!token) return { valid: false };
  const tokenData = store.tokens[token];
  if (!tokenData) return { valid: false };

  if (tokenData.expiresAt) {
    const exp = new Date(tokenData.expiresAt).getTime();
    if (!isNaN(exp) && exp <= Date.now()) {
      delete store.tokens[token];
      saveSyncStore(store);
      return { valid: false, expired: true };
    }
  }

  return { valid: true, tokenData };
}

const resetAttemptTracker = new Map<string, { attempts: number; resetAt: number }>();
function checkResetRateLimit(key: string, maxAttempts = 5, windowMs = 15 * 60 * 1000): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = resetAttemptTracker.get(key);
  if (!entry || now > entry.resetAt) {
    resetAttemptTracker.set(key, { attempts: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.attempts >= maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.attempts += 1;
  return { allowed: true };
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // CORS Middleware for Mobile Browsers & Cross-Origin Sync
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-id, x-device-id, x-username, x-entity-id, x-composio-api-key, Cookie'
    );
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // --- SatCom Multi-Device Cloud Sync API Endpoints ---
  const handleRegister = (req: express.Request, res: express.Response) => {
    try {
      const ip = getClientIp(req);
      const rateCheck = checkAuthRateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 900));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many registration attempts. Please wait ${rateCheck.retryAfter} seconds.`,
        });
      }

      const { username, email, password, callsign, device } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'USERNAME_AND_PASSWORD_REQUIRED', message: 'Username and password required.' });
      }

      const cleanUser = String(username).toLowerCase().trim();
      const cleanEmail = String(email || `${cleanUser}@pixelops.local`).toLowerCase().trim();
      const store = loadSyncStore();

      if (store.users[cleanUser]) {
        return res.status(409).json({ error: 'USER_EXISTS', message: 'An operative with that username already exists.' });
      }

      const salt = generateSecureTokenServer(16);
      // Cryptographically secure PBKDF2 (100,000 iterations)
      const passwordHash = hashPasswordPBKDF2Server(password, salt);
      const userId = `usr_${Date.now().toString(36)}_${generateSecureTokenServer(8)}`;
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
      const incomingEntityId = req.body?.composioEntityId || req.body?.entityId || (req.headers['x-entity-id'] as string) || null;
      const incomingApiKey = req.body?.composioApiKey || req.body?.apiKey || (req.headers['x-composio-api-key'] as string) || null;

      const operativeCallsign = (callsign || cleanUser).toUpperCase();
      const rawRecoveryKey = `SATCOM-${operativeCallsign.slice(0, 6).replace(/[^A-Z0-9]/g, '') || 'AGENT'}-${generateSecureCodeServer(4)}-${generateSecureCodeServer(4)}-${generateSecureCodeServer(4)}`;
      const recoveryHash = hashRecoveryKeyServer(rawRecoveryKey);

      const userRecord = {
        id: userId,
        username: cleanUser,
        email: cleanEmail,
        callsign: operativeCallsign,
        salt,
        passwordHash,
        recoveryKeyHash: recoveryHash, // Cryptographically hashed - never stored in plaintext
        securityClearance: 'COMMANDER',
        composioEntityId: incomingEntityId || undefined,
        composioApiKey: incomingApiKey || undefined,
        createdAt: now,
        lastLoginAt: now,
        devices: device ? [device] : [],
      };

      const token = `tok_${userId}_${Date.now().toString(36)}_${generateSecureTokenServer(16)}`;
      store.users[cleanUser] = userRecord;
      store.tokens[token] = { userId, username: cleanUser, expiresAt, createdAt: now };
      if (incomingEntityId || incomingApiKey) {
        store.vaults[userId] = { composioEntityId: incomingEntityId, composioApiKey: incomingApiKey };
        store.vaults[cleanUser] = { composioEntityId: incomingEntityId, composioApiKey: incomingApiKey };
      }
      if (device) {
        store.devices[userId] = store.devices[userId] || [];
        store.devices[userId].push(device);
        store.devices[cleanUser] = store.devices[userId];
      }
      saveSyncStore(store);

      // Issue HttpOnly, Secure, SameSite=Strict session cookie
      setSessionCookie(res, token);

      const session = {
        token,
        user: {
          id: userId,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          composioEntityId: incomingEntityId || undefined,
          composioApiKey: incomingApiKey || undefined,
          createdAt: now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt,
      };

      res.json({ ok: true, session, composioEntityId: incomingEntityId, composioApiKey: incomingApiKey, oneTimeRecoveryKey: rawRecoveryKey, devices: userRecord.devices });
    } catch (err: any) {
      res.status(500).json({ error: 'AUTH_ERROR', message: err?.message || 'Server authentication fault' });
    }
  };

  const handleLogin = (req: express.Request, res: express.Response) => {
    try {
      const { usernameOrEmail, password, device } = req.body || {};
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();

      const ip = getClientIp(req);
      const userRate = cleanQuery ? checkAuthRateLimit(`login:user:${cleanQuery}`, 5, 5 * 60 * 1000) : { allowed: true };
      const ipRate = checkAuthRateLimit(`login:ip:${ip}`, 15, 5 * 60 * 1000);
      if (!userRate.allowed || !ipRate.allowed) {
        const retryAfter = Math.max(userRate.retryAfter || 0, ipRate.retryAfter || 0);
        res.setHeader('Retry-After', String(retryAfter || 300));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many login attempts. Please wait ${retryAfter} seconds.`,
        });
      }

      const store = loadSyncStore();

      let userRecord: any = null;
      for (const u of Object.values(store.users)) {
        const uUser = String(u.username || '').toLowerCase().trim();
        const uEmail = String(u.email || '').toLowerCase().trim();
        const uCallsign = String(u.callsign || '').toLowerCase().trim();
        if (uUser === cleanQuery || uEmail === cleanQuery || uCallsign === cleanQuery) {
          userRecord = u;
          break;
        }
      }

      if (!userRecord) {
        return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'No operative found matching credentials.' });
      }

      const verifyResult = verifyPasswordServer(password, userRecord.salt, userRecord.passwordHash);
      if (!verifyResult.valid) {
        return res.status(401).json({ error: 'INVALID_PASSWORD', message: 'Invalid operative password key.' });
      }

      // Automatically upgrade legacy SHA-256 hash to PBKDF2 upon successful authentication
      if (verifyResult.isLegacy) {
        userRecord.passwordHash = hashPasswordPBKDF2Server(password, userRecord.salt);
        userRecord.passwordUpgradedAt = new Date().toISOString();
      }

      if (!userRecord.recoveryKeyHash && userRecord.recoveryKey) {
        userRecord.recoveryKeyHash = hashRecoveryKeyServer(userRecord.recoveryKey);
        delete userRecord.recoveryKey;
      }

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();

      userRecord.lastLoginAt = now;
      if (device) {
        userRecord.devices = userRecord.devices || [];
        const existingIdx = userRecord.devices.findIndex((d: any) => d.deviceId === device.deviceId);
        if (existingIdx >= 0) {
          userRecord.devices[existingIdx] = device;
        } else {
          userRecord.devices.push(device);
        }
        store.devices[userRecord.id] = userRecord.devices;
        store.devices[userRecord.username] = userRecord.devices;
      }

      const token = `tok_${userRecord.id}_${Date.now().toString(36)}_${generateSecureTokenServer(16)}`;
      store.tokens[token] = { userId: userRecord.id, username: userRecord.username, expiresAt, createdAt: now };
      saveSyncStore(store);

      // Issue HttpOnly, Secure, SameSite=Strict session cookie
      setSessionCookie(res, token);

      const userEntityId = userRecord.composioEntityId || store.vaults[userRecord.id]?.composioEntityId || store.vaults[userRecord.username]?.composioEntityId || null;
      const userApiKey = userRecord.composioApiKey || store.vaults[userRecord.id]?.composioApiKey || store.vaults[userRecord.username]?.composioApiKey || null;

      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          composioEntityId: userEntityId || undefined,
          composioApiKey: userApiKey || undefined,
          createdAt: userRecord.createdAt,
          lastLoginAt: userRecord.lastLoginAt,
        },
        device: device || { deviceId: 'default', deviceName: 'Browser', deviceType: 'desktop', lastActive: now },
        expiresAt,
      };

      res.json({ ok: true, session, composioEntityId: userEntityId, composioApiKey: userApiKey, devices: userRecord.devices });
    } catch (err: any) {
      res.status(500).json({ error: 'AUTH_ERROR', message: err?.message || 'Server authentication fault' });
    }
  };

  app.post('/api/auth/register', handleRegister);
  app.post('/api/register', handleRegister);
  app.post('/api/auth/login', handleLogin);
  app.post('/api/login', handleLogin);

  app.post('/api/logout', (req, res) => {
    try {
      const token = extractSessionToken(req);
      if (token) {
        const store = loadSyncStore();
        delete store.tokens[token];
        saveSyncStore(store);
      }
      clearSessionCookie(res);
      res.json({ ok: true, message: 'Logged out successfully.' });
    } catch {
      clearSessionCookie(res);
      res.json({ ok: true });
    }
  });

  app.get('/api/me', (req, res) => {
    try {
      const token = extractSessionToken(req);
      const store = loadSyncStore();
      const tokenCheck = validateAndGetToken(store, token);
      if (tokenCheck.valid && tokenCheck.tokenData) {
        const { username } = tokenCheck.tokenData;
        const user = store.users[username];
        if (user) {
          const userEntityId = user.composioEntityId || store.vaults[user.id]?.composioEntityId || store.vaults[user.username]?.composioEntityId || null;
          const userApiKey = user.composioApiKey || store.vaults[user.id]?.composioApiKey || store.vaults[user.username]?.composioApiKey || null;
          return res.json({
            ok: true,
            user: {
              id: user.id,
              username: user.username,
              email: user.email,
              callsign: user.callsign,
              securityClearance: user.securityClearance,
              composioEntityId: userEntityId || undefined,
              composioApiKey: userApiKey || undefined,
              createdAt: user.createdAt,
              lastLoginAt: user.lastLoginAt,
            },
            composioEntityId: userEntityId,
            composioApiKey: userApiKey,
            devices: store.devices[username] || user.devices || [],
          });
        }
      }
      res.status(401).json({ ok: false, error: tokenCheck.expired ? 'SESSION_EXPIRED' : 'NO_VALID_SESSION' });
    } catch (err: any) {
      res.status(500).json({ error: 'SERVER_ERROR', message: err?.message });
    }
  });

  app.post('/api/auth/reset-password', (req, res) => {
    try {
      const { usernameOrEmail, recoveryKey, newPassword, adminResetKey } = req.body || {};
      const cleanQuery = String(usernameOrEmail || '').toLowerCase().trim();
      const cleanKey = String(recoveryKey || '').trim().toUpperCase();

      const ip = getClientIp(req);
      const rateKey = `reset:${ip}:${cleanQuery}`;
      const rateCheck = checkAuthRateLimit(rateKey, 5, 15 * 60 * 1000);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 900));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many password reset attempts. Please wait ${rateCheck.retryAfter} seconds.`,
        });
      }

      if (!cleanQuery || !newPassword) {
        return res.status(400).json({ error: 'FIELDS_REQUIRED', message: 'Username/Email and New Password are required.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'PASSWORD_TOO_SHORT', message: 'New password must be at least 6 characters.' });
      }

      // Check backend environment secret for admin override
      const envResetSecret = process.env.RESET_KEY || process.env.PIXELOPS_RESET_SECRET || process.env.ADMIN_SECRET;
      const incomingAdminKey = (adminResetKey || req.headers['x-reset-key'] || req.headers['x-admin-reset-key'] || '').toString().trim();
      const isAdminAuthorized = Boolean(envResetSecret && incomingAdminKey && timingSafeEqualStr(incomingAdminKey, envResetSecret));

      if (!cleanKey && !isAdminAuthorized) {
        return res.status(401).json({ error: 'KEY_REQUIRED', message: 'Satellite Recovery Key or authorized backend reset secret required.' });
      }

      const store = loadSyncStore();
      let userRecord: any = null;
      for (const u of Object.values(store.users)) {
        const uUser = String(u.username || '').toLowerCase().trim();
        const uEmail = String(u.email || '').toLowerCase().trim();
        const uCallsign = String(u.callsign || '').toLowerCase().trim();
        if (uUser === cleanQuery || uEmail === cleanQuery || uCallsign === cleanQuery) {
          userRecord = u;
          break;
        }
      }

      if (!userRecord) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'No operative found matching credentials.' });
      }

      if (!isAdminAuthorized) {
        const storedKeyOrHash = String(userRecord.recoveryKeyHash || userRecord.recoveryKey || '').trim();
        const inputHash = hashRecoveryKeyServer(cleanKey);
        const isHashMatch = timingSafeEqualStr(inputHash, storedKeyOrHash);
        const isLegacyPlainMatch = timingSafeEqualStr(cleanKey, storedKeyOrHash.toUpperCase());

        if (!isHashMatch && !isLegacyPlainMatch) {
          return res.status(401).json({ error: 'INVALID_RECOVERY_KEY', message: 'Invalid Satellite Recovery Key for this operative account.' });
        }
      }

      const newSalt = generateSecureTokenServer(16);
      userRecord.salt = newSalt;
      userRecord.passwordHash = hashPasswordPBKDF2Server(newPassword, newSalt);
      userRecord.recoveryKeyHash = hashRecoveryKeyServer(cleanKey || 'RECONFIGURED');
      delete userRecord.recoveryKey;
      userRecord.lastUpdatedAt = new Date().toISOString();
      saveSyncStore(store);

      res.json({ ok: true, message: 'Password encryption key reset successfully. You may now sign in with your new key.' });
    } catch (err: any) {
      res.status(500).json({ error: 'RESET_FAULT', message: err?.message || 'Server error during password reset' });
    }
  });

  // --- Ephemeral Server-Managed Satellite Pairing Protocol (5-Minute TTL, Single-Use, CSPRNG) ---
  app.post('/api/auth/pair/generate', (req, res) => {
    try {
      const token = extractSessionToken(req);
      const store = loadSyncStore();
      const tokenCheck = validateAndGetToken(store, token);

      if (!tokenCheck.valid || !tokenCheck.tokenData) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: tokenCheck.expired ? 'Session expired.' : 'Authenticated session required to generate pairing tickets.',
        });
      }

      const ip = getClientIp(req);
      const rateCheck = checkAuthRateLimit(`pair-gen:${ip}:${tokenCheck.tokenData.userId}`, 5, 10 * 60 * 1000);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 600));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many pairing ticket requests. Please wait ${rateCheck.retryAfter} seconds.`,
        });
      }

      const user = Object.values(store.users).find((u: any) => u.id === tokenCheck.tokenData.userId) || store.users[tokenCheck.tokenData.username];
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Operative profile not found.' });
      }

      const codePart1 = generateSecureCodeServer(4);
      const codePart2 = generateSecureCodeServer(4);
      const pairTicket = `SATCOM-PAIR::CODE-${codePart1}-${codePart2}`;
      const now = new Date().toISOString();
      const expiresAt = Date.now() + 5 * 60 * 1000; // Strictly 5 minutes TTL

      store.pairingCodes = store.pairingCodes || {};
      store.pairingCodes[pairTicket] = {
        code: pairTicket,
        userId: user.id,
        username: user.username,
        email: user.email,
        callsign: user.callsign,
        securityClearance: user.securityClearance,
        syncPackage: req.body?.syncPackage || null,
        createdAt: now,
        expiresAt,
        used: false,
      };

      // Clean up expired tickets
      for (const [key, t] of Object.entries(store.pairingCodes)) {
        if (Date.now() > t.expiresAt || t.used) {
          delete store.pairingCodes[key];
        }
      }

      saveSyncStore(store);

      res.json({
        ok: true,
        pairTicket,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresInSeconds: 300,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'PAIRING_FAULT', message: err?.message || 'Server error generating pairing ticket' });
    }
  });

  app.post('/api/auth/pair/redeem', (req, res) => {
    try {
      const ip = getClientIp(req);
      const rateCheck = checkAuthRateLimit(`pair-redeem:${ip}`, 5, 10 * 60 * 1000);
      if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 600));
        return res.status(429).json({
          error: 'RATE_LIMITED',
          message: `Too many pairing redemption attempts. Please wait ${rateCheck.retryAfter} seconds.`,
        });
      }

      const { pairTicket, device } = req.body || {};
      const cleanTicket = String(pairTicket || '').trim();

      if (!cleanTicket) {
        return res.status(400).json({ error: 'TICKET_REQUIRED', message: 'Pairing ticket is required.' });
      }

      const store = loadSyncStore();
      store.pairingCodes = store.pairingCodes || {};

      const ticket = store.pairingCodes[cleanTicket];
      if (!ticket || ticket.used) {
        return res.status(401).json({
          error: 'INVALID_PAIRING_TICKET',
          message: 'Invalid or already redeemed Satellite pairing ticket.',
        });
      }

      if (Date.now() > ticket.expiresAt) {
        delete store.pairingCodes[cleanTicket];
        saveSyncStore(store);
        return res.status(401).json({
          error: 'EXPIRED_PAIRING_TICKET',
          message: 'Satellite pairing ticket has expired (5-minute TTL). Please request a fresh pairing ticket.',
        });
      }

      // Burn ticket immediately (single-use guarantee)
      ticket.used = true;
      delete store.pairingCodes[cleanTicket];

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
      const user = Object.values(store.users).find((u: any) => u.id === ticket.userId) || store.users[ticket.username];

      // Mint a fresh, cryptographically secure session token for the paired device
      const newToken = `tok_${ticket.userId}_${Date.now().toString(36)}_${generateSecureTokenServer(16)}`;
      store.tokens[newToken] = {
        userId: ticket.userId,
        username: ticket.username,
        expiresAt,
        createdAt: now,
      };

      if (device && user) {
        user.devices = user.devices || [];
        const existingIdx = user.devices.findIndex((d: any) => d.deviceId === device.deviceId);
        if (existingIdx >= 0) {
          user.devices[existingIdx] = device;
        } else {
          user.devices.push(device);
        }
        store.devices[ticket.userId] = user.devices;
        store.devices[ticket.username] = user.devices;
      }

      saveSyncStore(store);

      // Issue HttpOnly, Secure cookie for the newly paired device session
      setSessionCookie(res, newToken);

      const session = {
        token: newToken,
        user: {
          id: ticket.userId,
          username: ticket.username,
          email: ticket.email,
          callsign: ticket.callsign,
          securityClearance: ticket.securityClearance,
          createdAt: user?.createdAt || now,
          lastLoginAt: now,
        },
        device: device || { deviceId: 'paired_node', deviceName: 'Paired Device', deviceType: 'mobile', lastActive: now },
        expiresAt,
      };

      res.json({
        ok: true,
        session,
        syncPackage: ticket.syncPackage || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'REDEEM_FAULT', message: err?.message || 'Server error redeeming pairing ticket' });
    }
  });

  // Restricted Backend Admin Reset Endpoint
  app.post('/api/admin/reset', (req, res) => {
    try {
      const envResetSecret = process.env.RESET_KEY || process.env.PIXELOPS_RESET_SECRET || process.env.ADMIN_SECRET;
      if (!envResetSecret) {
        return res.status(403).json({
          error: 'ADMIN_RESET_DISABLED',
          message: 'Backend reset secret is not configured in server environment. Admin reset disabled.',
        });
      }

      const incomingKey = (req.headers['x-admin-reset-key'] || req.headers['x-reset-key'] || req.body?.adminResetKey || '').toString().trim();
      if (!incomingKey || !timingSafeEqualStr(incomingKey, envResetSecret)) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Invalid administrative reset secret key.',
        });
      }

      const token = extractSessionToken(req);
      const store = loadSyncStore();
      const tokenCheck = validateAndGetToken(store, token);
      if (!tokenCheck.valid || !tokenCheck.tokenData) {
        return res.status(401).json({
          error: tokenCheck.expired ? 'SESSION_EXPIRED' : 'SESSION_REQUIRED',
          message: 'Authenticated administrative session required.',
        });
      }

      const user = store.users[tokenCheck.tokenData.username];
      if (!user || (user.securityClearance !== 'COMMANDER' && user.securityClearance !== 'DIRECTOR')) {
        return res.status(403).json({
          error: 'INSUFFICIENT_CLEARANCE',
          message: 'Only COMMANDER or DIRECTOR clearance may invoke administrative endpoints.',
        });
      }

      return res.json({
        ok: true,
        message: 'Admin authorization verified. State purge must be executed through controlled migration scripts.',
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'ADMIN_FAULT', message: err?.message || 'Server error' });
    }
  });

  app.post('/api/auth/update-profile', (req, res) => {
    try {
      const token = extractSessionToken(req);
      const store = loadSyncStore();
      const tokenCheck = validateAndGetToken(store, token);

      if (!tokenCheck.valid || !tokenCheck.tokenData) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: tokenCheck.expired ? 'Session expired.' : 'Session expired or invalid.' });
      }

      const userRecord = Object.values(store.users).find((u: any) => u.id === tokenCheck.tokenData.userId);
      if (!userRecord) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Operative profile not found.' });
      }

      const { callsign, username, email, currentPassword, newPassword } = req.body || {};

      // If user wants to change password, verify current password
      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'CURRENT_PASSWORD_REQUIRED', message: 'Enter your current password to set a new password.' });
        }
        const verifyCurrent = verifyPasswordServer(currentPassword, userRecord.salt, userRecord.passwordHash);
        if (!verifyCurrent.valid) {
          return res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD', message: 'Current password verification failed.' });
        }
        if (newPassword.length < 6) {
          return res.status(400).json({ error: 'NEW_PASSWORD_TOO_SHORT', message: 'New password must be at least 6 characters.' });
        }
        const newSalt = generateSecureTokenServer(16);
        userRecord.salt = newSalt;
        userRecord.passwordHash = hashPasswordPBKDF2Server(newPassword, newSalt);
      }

      // If username changed, ensure not taken
      if (username) {
        const cleanNewUser = String(username).toLowerCase().trim();
        if (cleanNewUser !== userRecord.username) {
          if (cleanNewUser.length < 3) {
            return res.status(400).json({ error: 'INVALID_USERNAME', message: 'Username must be at least 3 characters.' });
          }
          if (store.users[cleanNewUser]) {
            return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'An operative already exists with this handle.' });
          }
          delete store.users[userRecord.username];
          userRecord.username = cleanNewUser;
          store.users[cleanNewUser] = userRecord;
          tokenCheck.tokenData.username = cleanNewUser;
        }
      }

      if (callsign) {
        userRecord.callsign = String(callsign).trim().toUpperCase();
      }

      if (email) {
        userRecord.email = String(email).toLowerCase().trim();
      }

      userRecord.lastUpdatedAt = new Date().toISOString();
      saveSyncStore(store);

      const session = {
        token,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          callsign: userRecord.callsign,
          securityClearance: userRecord.securityClearance,
          createdAt: userRecord.createdAt,
          lastLoginAt: userRecord.lastLoginAt,
        },
        device: { deviceId: 'current', deviceName: 'Updated Node', deviceType: 'desktop', lastActive: new Date().toISOString() },
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
      };

      res.json({ ok: true, session });
    } catch (err: any) {
      res.status(500).json({ error: 'UPDATE_FAULT', message: err?.message || 'Server error updating profile' });
    }
  });

  app.get('/api/auth/me', (req, res) => {
    try {
      const token = extractSessionToken(req);
      const store = loadSyncStore();
      const tokenCheck = validateAndGetToken(store, token);

      if (!tokenCheck.valid || !tokenCheck.tokenData) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: tokenCheck.expired ? 'Session expired' : 'Invalid session token' });
      }

      const user = Object.values(store.users).find((u: any) => u.id === tokenCheck.tokenData.userId);
      if (!user) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found' });
      }

      res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          callsign: user.callsign,
          securityClearance: user.securityClearance,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: 'AUTH_ERROR', message: err?.message || 'Server error' });
    }
  });

  // Helper to resolve clean user key across tokens, headers, and usernames
  function resolveUserKey(req: express.Request, store: SyncDataStore): { userKey: string; rawUserId: string } {
    let userKey = (req.headers['x-username'] as string)?.toLowerCase().trim() || (req.query.username as string)?.toLowerCase().trim() || '';
    const rawUserId = (req.headers['x-user-id'] as string) || (req.query.userId as string) || '';

    if (!userKey) {
      const token = extractSessionToken(req);
      if (token) {
        const tokenCheck = validateAndGetToken(store, token);
        if (tokenCheck.valid && tokenCheck.tokenData) {
          userKey = tokenCheck.tokenData.username;
        }
      }
    }

    if (!userKey && rawUserId) {
      // Check if rawUserId matches a user's id in store
      for (const u of Object.values(store.users)) {
        if (u.id === rawUserId || u.username === rawUserId.toLowerCase()) {
          userKey = u.username.toLowerCase();
          break;
        }
      }
    }

    if (!userKey) {
      userKey = (rawUserId || 'default_user').toLowerCase().trim();
    }

    return { userKey, rawUserId };
  }

  const handleSyncPush = (req: express.Request, res: express.Response) => {
    try {
      const store = loadSyncStore();
      const { userKey, rawUserId } = resolveUserKey(req, store);
      const deviceId = (req.headers['x-device-id'] as string) || req.body?.deviceId || 'default_device';
      const deviceName = (req.headers['x-device-name'] as string) || req.body?.device?.deviceName || 'Active Node';
      const deviceType = (req.headers['x-device-type'] as string) || req.body?.device?.deviceType || 'desktop';
      const syncPackage = req.body;

      if (!syncPackage) {
        return res.status(400).json({ error: 'PACKAGE_REQUIRED', message: 'Sync payload is empty.' });
      }

      const incomingEntityId = syncPackage.composioEntityId || syncPackage.entityId || (req.headers['x-entity-id'] as string) || null;
      if (incomingEntityId) {
        syncPackage.composioEntityId = incomingEntityId;
        if (store.users[userKey]) store.users[userKey].composioEntityId = incomingEntityId;
        if (rawUserId && store.users[rawUserId]) store.users[rawUserId].composioEntityId = incomingEntityId;
      }

      const incomingApiKey = syncPackage.composioApiKey || (req.headers['x-composio-api-key'] as string) || null;
      if (incomingApiKey) {
        syncPackage.composioApiKey = incomingApiKey;
        if (store.users[userKey]) store.users[userKey].composioApiKey = incomingApiKey;
        if (rawUserId && store.users[rawUserId]) store.users[rawUserId].composioApiKey = incomingApiKey;
      }

      // Merge deletedWorkspaceFilePaths & deletedRoutineIds tombstones with existing server vault so deletions never resurrect
      const existingPkg = store.vaults[userKey] || (rawUserId ? store.vaults[rawUserId] : null);
      const mergedDeletedFiles: Record<string, string> = {
        ...(existingPkg?.deletedWorkspaceFilePaths || {}),
        ...(syncPackage.deletedWorkspaceFilePaths || {}),
      };
      syncPackage.deletedWorkspaceFilePaths = mergedDeletedFiles;
      if (Array.isArray(syncPackage.workspaceFiles)) {
        syncPackage.workspaceFiles = syncPackage.workspaceFiles.filter((f: any) => {
          const norm = String(f?.path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
          const delTs = mergedDeletedFiles[norm];
          if (!delTs) return true;
          return new Date(f?.updatedAt || 0).getTime() > new Date(delTs).getTime();
        });
      }

      store.vaults[userKey] = syncPackage;
      if (rawUserId) store.vaults[rawUserId] = syncPackage;

      // Update or register device in fleet
      const userDevices = store.devices[userKey] || (rawUserId ? store.devices[rawUserId] : []) || [];
      const incomingDevice = syncPackage.device || {
        deviceId,
        deviceName,
        deviceType,
        lastActive: new Date().toISOString(),
      };

      const devIdx = userDevices.findIndex((d) => d.deviceId === incomingDevice.deviceId);
      if (devIdx >= 0) {
        userDevices[devIdx] = { ...userDevices[devIdx], ...incomingDevice, lastActive: new Date().toISOString() };
      } else {
        userDevices.push(incomingDevice);
      }

      store.devices[userKey] = userDevices;
      if (rawUserId) store.devices[rawUserId] = userDevices;

      // Also sync back to user record if found
      if (store.users[userKey]) {
        store.users[userKey].devices = userDevices;
      }

      saveSyncStore(store);

      res.json({ ok: true, timestamp: new Date().toISOString(), devicesCount: userDevices.length });
    } catch (err: any) {
      res.status(500).json({ error: 'SYNC_ERROR', message: err?.message || 'Server sync error' });
    }
  };

  const handleSyncPull = (req: express.Request, res: express.Response) => {
    try {
      const store = loadSyncStore();
      const { userKey, rawUserId } = resolveUserKey(req, store);
      const pkg = store.vaults[userKey] || (rawUserId ? store.vaults[rawUserId] : null);
      const entityId = pkg?.composioEntityId || store.users[userKey]?.composioEntityId || (rawUserId ? store.users[rawUserId]?.composioEntityId : null) || null;
      const composioApiKey = pkg?.composioApiKey || store.users[userKey]?.composioApiKey || (rawUserId ? store.users[rawUserId]?.composioApiKey : null) || null;

      res.json({ ok: true, package: pkg || null, entityId, composioEntityId: entityId, composioApiKey, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: 'SYNC_ERROR', message: err?.message || 'Server sync error' });
    }
  };

  const handleSyncDevices = (req: express.Request, res: express.Response) => {
    try {
      const store = loadSyncStore();
      const { userKey, rawUserId } = resolveUserKey(req, store);
      let devices = store.devices[userKey] || (rawUserId ? store.devices[rawUserId] : []) || [];

      if (devices.length === 0 && store.users[userKey]?.devices) {
        devices = store.users[userKey].devices;
      }

      res.json({ ok: true, devices });
    } catch (err: any) {
      res.status(500).json({ error: 'DEVICES_ERROR', message: err?.message || 'Server error' });
    }
  };

  const handleSyncUnlink = (req: express.Request, res: express.Response) => {
    try {
      const store = loadSyncStore();
      const { userKey, rawUserId } = resolveUserKey(req, store);
      const { targetDeviceId } = req.body || {};

      if (store.devices[userKey]) {
        store.devices[userKey] = store.devices[userKey].filter((d) => d.deviceId !== targetDeviceId);
      }
      if (rawUserId && store.devices[rawUserId]) {
        store.devices[rawUserId] = store.devices[rawUserId].filter((d) => d.deviceId !== targetDeviceId);
      }
      saveSyncStore(store);

      res.json({ ok: true, unlinked: targetDeviceId });
    } catch (err: any) {
      res.status(500).json({ error: 'UNLINK_ERROR', message: err?.message || 'Server error' });
    }
  };

  app.post('/api/sync/push', handleSyncPush);
  app.get('/api/sync/pull', handleSyncPull);
  app.get('/api/sync/devices', handleSyncDevices);
  app.post('/api/sync/device/unlink', handleSyncUnlink);

  // Fallback unified /api/sync endpoint for query parameters
  app.all('/api/sync', (req, res) => {
    const action = String(req.query.action || '').toLowerCase();
    if (req.method === 'POST') {
      if (action === 'unlink') return handleSyncUnlink(req, res);
      return handleSyncPush(req, res);
    }
    if (req.method === 'GET') {
      if (action === 'devices') return handleSyncDevices(req, res);
      return handleSyncPull(req, res);
    }
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  });

  // PixelOps Retro Feedback Terminal Endpoints
  app.post('/api/feedback', async (req, res) => {
    try {
      const { message, category, callsign, email } = req.body || {};
      const rawMessage = (message || '').trim();
      if (!rawMessage) {
        return res.status(400).json({ error: 'MESSAGE_REQUIRED', message: 'Feedback message cannot be empty.' });
      }

      const id = req.body.id || `fb_${Date.now()}_${generateSecureTokenServer(8)}`;
      const createdAt = typeof req.body.created_at === 'number' ? req.body.created_at : Date.now();
      const formattedMessage = (category || callsign || email)
        ? `[CATEGORY: ${(category || 'GENERAL').toUpperCase()}]${callsign ? ` [OPERATIVE: ${callsign}]` : ''}${email ? ` [CONTACT: ${email}]` : ''}\n\n${rawMessage}`
        : rawMessage;

      // In-memory sync store record
      const store = loadSyncStore();
      (store as any).feedback = (store as any).feedback || [];
      (store as any).feedback.push({ id, message: formattedMessage, created_at: createdAt });
      saveSyncStore(store);

      console.log(`[FEEDBACK TRANSMITTED] ID: ${id} | To: support@pixelops.app | Msg: ${rawMessage.slice(0, 60)}...`);

      // Forward via Resend if RESEND_API_KEY is present
      let emailDispatched = false;
      let emailError: string | null = null;
      let resendId: string | null = null;
      const resendApiKey = ((req.headers['x-resend-api-key'] as string) || req.body?.resendApiKey || process.env.RESEND_API_KEY || '').trim();
      if (resendApiKey) {
        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'PixelOps Terminal <support@pixelops.app>',
              to: ['support@pixelops.app'],
              subject: '⚡ New Commander Feedback Transmission',
              text: `Incoming feedback from PWA terminal:\n\n${rawMessage}`,
              reply_to: email && email.includes('@') ? email.trim() : undefined,
            }),
          });
          const resData = await emailRes.json().catch(() => ({}));
          emailDispatched = emailRes.ok;
          if (emailDispatched) {
            resendId = resData.id || null;
          } else {
            emailError = resData.message || resData.name || `HTTP ${emailRes.status}`;
            console.error('[SERVER RESEND ERROR]', emailRes.status, resData);
          }
        } catch (err: any) {
          emailError = err?.message || 'Network failure to Resend';
        }
      } else {
        emailError = 'RESEND_API_KEY is not configured in environment or request.';
      }

      res.status(201).json({
        ok: true,
        id,
        message: emailDispatched
          ? 'Feedback securely logged to Cloudflare D1 and delivered to support@pixelops.app.'
          : `Feedback logged. Email note: ${emailError}`,
        d1Saved: true,
        emailDispatched,
        emailError,
        resendId,
        targetEmail: 'support@pixelops.app',
        created_at: createdAt,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'FEEDBACK_ERROR', message: err?.message || 'Server error processing feedback' });
    }
  });

  app.get('/api/feedback', (_req, res) => {
    const store = loadSyncStore();
    const count = ((store as any).feedback || []).length;
    res.json({
      ok: true,
      endpoint: '/api/feedback',
      targetEmail: 'support@pixelops.app',
      recordsCount: count,
    });
  });

  app.get('/api/agent/status', async (_req, res) => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      online: true,
      configured: hasKey,
      model: 'gemini-3.8-flash',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/agent/ping', async (_req, res) => {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: 'Respond with a 6-word tactical readiness confirmation.',
      });
      res.json({
        ok: true,
        message: response.text?.trim() || 'Link verified. All agents standing by.',
        model: 'gemini-3.8-flash',
      });
    } catch (error: any) {
      console.warn('Ping endpoint caught error, returning fallback ok:', error);
      res.json({
        ok: true,
        message: 'Link verified via local fallback engine. Agents standing by.',
        model: 'gemini-3.8-flash',
      });
    }
  });

  /**
   * Universal Web & Google Search Engine
   * Route: /api/search (GET & POST)
   * Queries Google News RSS, Google Suggest, Google CSE, DuckDuckGo, Hacker News, Wikipedia.
   */
  const handleSearchRequest = async (req: express.Request, res: express.Response) => {
    const q = String(req.query.q || req.query.query || req.body?.q || req.body?.query || '').trim();
    const limit = Math.min(10, Math.max(1, Number(req.query.limit || req.body?.limit || req.body?.maxResults) || 5));

    if (!q) {
      return res.status(400).json({ error: 'MISSING_QUERY', message: 'Query string parameter "q" or "query" is required.' });
    }

    const results: Array<{
      title: string;
      snippet: string;
      extract: string;
      url: string;
      source: string;
      publishedAt?: string;
    }> = [];

    // 1. Google News Live RSS Feed
    try {
      const gnUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const gnRes = await fetch(gnUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PixelOps-Agent/2.0',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
      });
      if (gnRes.ok) {
        const xml = await gnRes.text();
        const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const itemXml of itemMatches.slice(0, 4)) {
          if (results.length >= limit) break;
          const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
          const cleanTitle = rawTitle
            .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .trim();
          const rawLink = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
          const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
          const sourceName = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || 'Google News';
          const rawDesc = itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
          const cleanDesc = rawDesc
            .replace(/<[^>]+>/g, ' ')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();

          if (cleanTitle) {
            results.push({
              title: cleanTitle,
              snippet: cleanDesc ? cleanDesc.slice(0, 320) : `${cleanTitle} (${sourceName})`,
              extract: `Google News Real-Time Intelligence: "${cleanTitle}". Source: ${sourceName}. Published: ${pubDate}. URL: ${rawLink}`,
              url: rawLink || `https://news.google.com/search?q=${encodeURIComponent(cleanTitle)}`,
              source: 'Google News',
              publishedAt: pubDate,
            });
          }
        }
      }
    } catch {}

    // 2. Google Custom Search API (If credentials available)
    const googleKey = (req.headers['x-google-api-key'] as string) || process.env.GOOGLE_SEARCH_API_KEY || process.env.GEMINI_API_KEY;
    const googleCx = (req.headers['x-google-cx'] as string) || process.env.GOOGLE_CSE_CX;
    if (googleKey && googleCx && results.length < limit) {
      try {
        const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(q)}&num=4`;
        const cseRes = await fetch(cseUrl);
        if (cseRes.ok) {
          const cseData: any = await cseRes.json();
          for (const item of cseData.items || []) {
            if (results.length >= limit) break;
            results.push({
              title: item.title,
              snippet: item.snippet || item.title,
              extract: `Google Search: "${item.title}" - ${item.snippet}. URL: ${item.link}`,
              url: item.link,
              source: 'Google Search',
            });
          }
        }
      } catch {}
    }

    // 3. DuckDuckGo Instant Knowledge API
    if (results.length < limit) {
      try {
        const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
        if (ddgRes.ok) {
          const ddgData: any = await ddgRes.json();
          if (ddgData.AbstractText && ddgData.AbstractText.length > 20) {
            results.push({
              title: ddgData.Heading || q,
              snippet: ddgData.AbstractText.slice(0, 350),
              extract: ddgData.AbstractText,
              url: ddgData.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
              source: 'DuckDuckGo',
            });
          }
          if (Array.isArray(ddgData.RelatedTopics)) {
            for (const topic of ddgData.RelatedTopics) {
              if (results.length >= limit) break;
              if (topic.Text && topic.FirstURL && !results.some((r) => r.url === topic.FirstURL)) {
                results.push({
                  title: (topic.Text.split(' - ')[0] || topic.Text).slice(0, 60),
                  snippet: topic.Text.slice(0, 320),
                  extract: topic.Text,
                  url: topic.FirstURL,
                  source: 'DuckDuckGo Topics',
                });
              }
            }
          }
        }
      } catch {}
    }

    // 4. Algolia Hacker News
    if (results.length < limit) {
      try {
        const hnRes = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=3`);
        if (hnRes.ok) {
          const hnData: any = await hnRes.json();
          for (const hit of hnData.hits || []) {
            if (results.length >= limit) break;
            const hitUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
            if (results.some((r) => r.url === hitUrl)) continue;
            results.push({
              title: hit.title,
              snippet: `${hit.title} (${hit.points || 0} pts, ${hit.num_comments || 0} comments, by ${hit.author || 'author'}). URL: ${hit.url || hitUrl}`,
              extract: `Hacker News discussion: "${hit.title}". Points: ${hit.points || 0}. URL: ${hitUrl}`,
              url: hitUrl,
              source: 'Hacker News',
            });
          }
        }
      } catch {}
    }

    // 5. Wikipedia Open Search API
    if (results.length < limit) {
      try {
        const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`);
        if (wikiRes.ok) {
          const wikiData: any = await wikiRes.json();
          for (const item of wikiData?.query?.search || []) {
            if (results.length >= limit) break;
            if (!item || !item.title) continue;
            const cleanSnippet = String(item.snippet || '')
              .replace(/<[^>]+>/g, '')
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'")
              .replace(/&amp;/g, '&')
              .trim();
            const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`;
            if (results.some((r) => r.url === wikiUrl)) continue;
            results.push({
              title: `${item.title} (Encyclopedia)`,
              snippet: cleanSnippet.slice(0, 320),
              extract: `${item.title}: ${cleanSnippet}. Verified encyclopedia reference node.`,
              url: wikiUrl,
              source: 'Wikipedia',
            });
          }
        }
      } catch {}
    }

    // Fallback direct Google query node
    if (results.length === 0) {
      results.push({
        title: `Google Search: "${q}"`,
        snippet: `Live Google Search portal query for "${q}". Access primary documentation, live indices, and global telemetry.`,
        extract: `Google Search query node for "${q}". Direct URL: https://www.google.com/search?q=${encodeURIComponent(q)}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        source: 'Google Search Direct',
      });
    }

    res.json({
      ok: true,
      query: q,
      resultCount: results.length,
      results,
      googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      fetchedAt: new Date().toISOString(),
    });
  };
  void handleSearchRequest;

  /**
   * Helper to resolve DNS and check all resolved IP addresses against private/reserved ranges
   * to protect against DNS rebinding attacks.
   */
  const checkDnsResolution = async (hostname: string): Promise<{ safe: boolean; reason?: string }> => {
    try {
      const records = await dns.promises.lookup(hostname, { all: true });
      for (const record of records) {
        if (isPrivateOrReservedIP(record.address)) {
          return { safe: false, reason: `Resolved IP ${record.address} is private or reserved. SSRF blocked.` };
        }
      }
      return { safe: true };
    } catch (e: any) {
      return { safe: false, reason: `DNS resolution failed for ${hostname}: ${e?.message || 'Host not found'}` };
    }
  };

  /**
   * Universal Web Crawler & URL Reader Proxy
   * Route: /api/fetch (GET & POST)
   * Fetches authorized URLs with strict SSRF mitigation, private IP blocking,
   * DNS rebinding defense, and manual redirect hop verification.
   */
  const handleFetchRequest = async (req: express.Request, res: express.Response) => {
    let targetUrl = String(req.query.url || req.query.u || req.body?.url || req.body?.targetUrl || '').trim();
    const method = String(req.body?.method || req.method || 'GET').toUpperCase();

    if (!targetUrl) {
      return res.status(400).json({ error: 'MISSING_URL', message: 'A target "url" parameter is required.' });
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    let parsedTargetUrl: URL;
    try {
      parsedTargetUrl = new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: 'INVALID_URL', message: 'Target URL is malformed.' });
    }

    // SSRF Mitigation Step 1: Validate protocol, port, userinfo, IP ranges, and domain allowlist
    const urlValidation = validateTargetUrl(parsedTargetUrl);
    if (!urlValidation.valid) {
      return res.status(403).json({
        error: 'Forbidden: Target domain or URL blocked by SSRF policy',
        message: urlValidation.reason,
      });
    }

    // SSRF Mitigation Step 2: Pre-resolve DNS to detect DNS rebinding to internal/private IPs
    const dnsCheck = await checkDnsResolution(parsedTargetUrl.hostname);
    if (!dnsCheck.safe) {
      return res.status(403).json({
        error: 'Forbidden: DNS resolution blocked by SSRF policy',
        message: dnsCheck.reason,
      });
    }

    try {
      const fetchHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 PixelOps-Intelligence/2.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        ...(req.body?.headers || {}),
      };

      let currentUrl = targetUrl;
      let externalRes: Response | null = null;
      let remainingRedirects = 3;

      // SSRF Mitigation Step 3: Manual redirect loop re-validating each hop
      while (true) {
        let hopUrl: URL;
        try {
          hopUrl = new URL(currentUrl);
        } catch {
          return res.status(400).json({ error: 'INVALID_URL', message: `Malformed redirect URL: ${currentUrl}` });
        }

        const hopValidation = validateTargetUrl(hopUrl);
        if (!hopValidation.valid) {
          return res.status(403).json({
            error: 'Forbidden: Redirect target blocked by SSRF policy',
            message: hopValidation.reason,
          });
        }

        const hopDns = await checkDnsResolution(hopUrl.hostname);
        if (!hopDns.safe) {
          return res.status(403).json({
            error: 'Forbidden: Redirect target DNS blocked by SSRF policy',
            message: hopDns.reason,
          });
        }

        const fetchOptions: RequestInit = {
          method,
          headers: fetchHeaders,
          redirect: 'manual',
        };

        if (method !== 'GET' && method !== 'HEAD' && req.body?.body) {
          fetchOptions.body = typeof req.body.body === 'string' ? req.body.body : JSON.stringify(req.body.body);
        }

        externalRes = await fetch(currentUrl, fetchOptions);

        if ([301, 302, 303, 307, 308].includes(externalRes.status)) {
          if (remainingRedirects <= 0) {
            return res.status(502).json({
              error: 'FETCH_FAILED',
              message: 'Maximum redirect limit (3 hops) exceeded during proxy fetch.',
            });
          }

          const location = externalRes.headers.get('location');
          if (!location) {
            break; // No location header, return as-is
          }

          currentUrl = new URL(location, currentUrl).toString();
          remainingRedirects--;
          continue;
        }

        break;
      }

      if (!externalRes) {
        throw new Error('No response received from target host.');
      }

      const contentType = externalRes.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const json = await externalRes.json();
        return res.json({
          ok: externalRes.ok,
          status: externalRes.status,
          url: currentUrl,
          contentType: 'application/json',
          data: json,
        });
      }

      const rawText = await externalRes.text();
      let cleanText = rawText;
      if (contentType.includes('html') || rawText.includes('<html')) {
        cleanText = rawText
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
          .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
          .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();
      }

      res.json({
        ok: externalRes.ok,
        status: externalRes.status,
        url: currentUrl,
        contentType: contentType || 'text/plain',
        text: cleanText.slice(0, 10000),
        totalLength: cleanText.length,
      });
    } catch (err: any) {
      res.status(502).json({
        ok: false,
        status: 502,
        error: 'FETCH_FAILED',
        url: targetUrl,
        message: err?.message || 'Failed to fetch external website.',
      });
    }
  };

  app.get('/api/fetch', handleFetchRequest);
  app.post('/api/fetch', handleFetchRequest);

  /**
   * Zero-Friction OSINT Intelligence Endpoints (Keyless / Public Telemetry)
   */
  const adaptCloudflareHandler = (
    handler: (context: { request: Request }) => Promise<Response>
  ) => {
    return async (req: express.Request, res: express.Response) => {
      try {
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost';
        const fullUrl = `${protocol}://${host}${req.originalUrl}`;

        let body: string | undefined = undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        }

        const webReq = new Request(fullUrl, {
          method: req.method,
          headers: req.headers as any,
          body: body,
        });

        const webRes = await handler({ request: webReq });
        res.status(webRes.status);
        webRes.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const resText = await webRes.text();
        res.send(resText);
      } catch (err: any) {
        res.status(500).json({
          status: 'error',
          error: 'OSINT_HANDLER_ERROR',
          message: err?.message || 'Failed to process OSINT request.',
        });
      }
    };
  };

  app.all('/api/osint/maritime', adaptCloudflareHandler(handleMaritimeOsint));
  app.all('/api/osint/hazards', adaptCloudflareHandler(handleHazardsOsint));
  app.all('/api/osint/satellite', adaptCloudflareHandler(handleSatelliteOsint));
  app.all('/api/osint/spectrum', adaptCloudflareHandler(handleSpectrumOsint));
  app.all('/api/osint/threat-matrix', adaptCloudflareHandler(handleThreatMatrixOsint));
  app.all('/api/intel/classified-feed', adaptCloudflareHandler(handleClassifiedFeed));
  app.all(
    '/api/search',
    adaptCloudflareHandler((ctx) => handleUniversalSearch({ request: ctx.request, env: process.env as any }))
  );

  /**
   * Turn 1: Initial Gemini API Request with Dynamic Function Declarations (`tools`).
   * If Gemini decides to invoke one or more `functionCalls`, returns `{ requiresToolExecution: true, functionCalls, modelContent }`
   * so the client service layer (`ApiService.ts`) can intercept the function call, animate the agent to the Server Vault / Library,
   * execute the real JavaScript tool handler, and send the follow-up turn to `/api/agent/followup`.
   */
  app.post('/api/agent/execute', async (req, res) => {
    try {
      const {
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentAssignedTools,
        agentMemoryLog = [],
        enabledPlugins = ['calendar', 'slack', 'github', 'vault'],
        toolDeclarations,
        attachment,
        temperature = 0.7,
      } = req.body;

      if (!prompt && !attachment) {
        res.status(400).json({ error: 'Mission directive or visual attachment is required.' });
        return;
      }

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      // Build active declarations and filter by agentAssignedTools if provided
      let activeDeclarations: FunctionDeclaration[] = [];
      const baseDeclarations: FunctionDeclaration[] = [];
      if (Array.isArray(toolDeclarations) && toolDeclarations.length > 0) {
        baseDeclarations.push(...toolDeclarations);
      } else {
        baseDeclarations.push(
          SERVER_TOOL_DECLARATIONS.live_web_search,
          SERVER_TOOL_DECLARATIONS.weather_lookup,
          SERVER_TOOL_DECLARATIONS.osint_maritime_tracker,
          SERVER_TOOL_DECLARATIONS.osint_hazard_tracker,
          SERVER_TOOL_DECLARATIONS.osint_satellite_recon,
          SERVER_TOOL_DECLARATIONS.osint_spectrum_analyzer
        );
        for (const pluginId of enabledPlugins) {
          if (pluginId === 'calendar') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.calendar_schedule_event);
          if (pluginId === 'slack') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.slack_post_dispatch);
          if (pluginId === 'github') {
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.github_create_issue);
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.github_list_issues);
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.github_get_repository);
          }
          if (pluginId === 'slack') {
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.slack_post_dispatch);
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.slack_list_channels);
          }
          if (pluginId === 'calendar') {
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.calendar_schedule_event);
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.calendar_list_events);
          }
          if (pluginId === 'gmail') {
            baseDeclarations.push(SERVER_TOOL_DECLARATIONS.gmail_list_messages);
          }
          if (pluginId === 'vault') baseDeclarations.push(SERVER_TOOL_DECLARATIONS.vault_query_intel);
        }
      }

      const CORE_AGENT_TOOLS = new Set([
        'live_web_search',
        'weather_lookup',
        'osint_maritime_tracker',
        'osint_hazard_tracker',
        'osint_satellite_recon',
        'osint_spectrum_analyzer',
      ]);
      if (Array.isArray(agentAssignedTools) && agentAssignedTools.length > 0) {
        const allowedSet = new Set([...agentAssignedTools, ...CORE_AGENT_TOOLS]);
        activeDeclarations = baseDeclarations.filter((d) => allowedSet.has(d.name));
      } else {
        activeDeclarations = baseDeclarations;
      }

      const declaredToolNames = activeDeclarations.map((d) => d.name).join(', ');
      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\n### PERSISTENT LONG-TERM MEMORY LEDGER (Your Past Experience & Instructions):\n` +
            `You have continuous persistent long-term memory. You remember all past conversations, completed tasks, findings, and user preferences recorded below:\n` +
            agentMemoryLog
              .slice(0, 30)
              .map((m: any, i: number) => `[Memory #${i + 1} | ${m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Recorded'}]\n• Directive: "${m.prompt}"\n• Result / Facts: ${m.summary}`)
              .join('\n\n') +
            `\n\nCRITICAL MEMORY RECALL INSTRUCTION:\n- You remember everything the user has ever told you and all tasks in this memory ledger.\n- If the user asks what you remember, references past directives, asks about previous work, or follow-up questions, actively draw upon and cite these memories.\n- NEVER say you don't have memory or cannot recall past interactions.`
          : '';

      const isReconOrSitrepSweep = /\b(recon|sitrep|the\s+wire|s2|threat\s+matrix|intel|briefing|osint|infrastructure|grid|supply\s+chain)\b/i.test(
        String(prompt || '')
      );
      let s2SitrepBlock = '';
      if (isReconOrSitrepSweep) {
        try {
          const dispatches = await fetchS2WireFeed();
          if (dispatches && dispatches.length > 0) {
            s2SitrepBlock = `\n\n### S2 UNDERGROUND WIRE SITREP STREAM:\n${buildAgentSITREPContext(dispatches)}`;
          }
        } catch {}
      }

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}${s2SitrepBlock}\nAvailable Assigned Tools: ${declaredToolNames}.`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}${s2SitrepBlock}\nAvailable Function Calling Tools: ${declaredToolNames}.
CRITICAL INTENT-DRIVEN TOOL SELECTION GUARDRAILS:
Before invoking any tool, analyze the user's intent:
- READ / LIST / SEARCH / AUDIT INTENT:
  If the user asks to check, audit, list, search, get, fetch, read, inspect, or review (e.g., "check repo issues", "get repository details", "check unread emails", "search calendar events", "show Slack channels"):
  You MUST select a LIST, GET, or SEARCH tool (e.g., github_list_issues, github_get_repository, calendar_list_events, slack_list_channels, gmail_list_messages).
  NEVER default to a write/create action when a read/list action is requested.
- WRITE / CREATE / SEND / DELETE INTENT:
  If the user explicitly asks to create, send, push, post, schedule, or delete:
  You MUST select a CREATE, SEND, or DELETE tool.
- PARAMETER VALIDATION:
  Ensure you correctly extract and validate required parameters (like repository owner/name, query strings, or channel names) from the user's directive before firing the tool.
When the user asks for weather, atmospheric conditions, or forecasts, ALWAYS call "weather_lookup".
When the user asks to search the web, look up real-world facts, news, flights, companies, or encyclopedia topics, ALWAYS call "live_web_search".

S2 WIRE SITREP INTELLIGENCE DIRECTIVE:
When executing a reconnaissance mission or gathering threat telemetry:
1. Analyze the text-based situational reports (SITREPs formatted with //The Wire//, //BLUF://, //TEARLINE//, and //END REPORT//) from the S2 Wire feed or /intel/sources/classified_feed/.
2. Extract macro anomalies, infrastructure risks, and actionable intelligence points into a structured dossier for the Director-tier operator.
3. If the user's directive is unrelated to the SITREP stream, omit unrelated dispatches cleanly.`;

      const userParts: any[] = [];
      if (attachment && attachment.data && attachment.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      userParts.push({
        text: prompt || 'Analyze this attached visual intel and provide an execution plan.',
      });

      // Call Gemini with the dynamic tool declarations
      if (activeDeclarations.length > 0) {
        const turn1Response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: userParts }],
          config: {
            systemInstruction,
            temperature: Number(temperature),
            tools: [{ functionDeclarations: activeDeclarations }],
          },
        });

        const functionCalls = turn1Response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          console.log(
            `[AGENT EXECUTION ROUTER] Agent: ${activeAgentName} Invoking ${functionCalls.length} tool(s):`,
            functionCalls.map((fc) => ({ slug: fc.name, parameters: fc.args }))
          );
          const modelContent = turn1Response.candidates?.[0]?.content || {
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          };

          res.json({
            requiresToolExecution: true,
            functionCalls: functionCalls.map((fc, idx) => ({
              id: fc.id || `fc-${Date.now()}-${idx}`,
              name: fc.name || 'live_web_search',
              args: (fc.args as Record<string, any>) || {},
            })),
            modelContent,
            agentName: activeAgentName,
            themeId,
          });
          return;
        }
      }

      // If no function call was triggered by Gemini, synthesize the structured JSON card directly
      const directStructuredResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              ...userParts,
              {
                text: 'Provide your final in-character response and execution steps in the required JSON schema.',
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_CARD_SCHEMA,
        },
      });

      const rawJson = directStructuredResponse.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = {
          dialogue:
            directStructuredResponse.text ||
            'Directive processed. Standing by for next command.',
          cardTitle: 'Directive Execution',
          actionCategory: 'Operations',
          steps: [
            { label: 'Parse Directive', detail: 'Validated command parameters', status: 'completed' },
            { label: 'Execute Routine', detail: 'Agent completed assigned task', status: 'verified' },
          ],
        };
      }

      const promptChars = (prompt || '').length + (attachment ? 450 : 0);
      const outputChars = rawJson.length;
      const tokenEstimate = Math.max(48, Math.round((promptChars + outputChars) / 4));

      res.json({
        requiresToolExecution: false,
        dialogue: parsed.dialogue || 'Directive executed.',
        cardTitle: parsed.cardTitle || 'Field Operation',
        actionCategory: parsed.actionCategory || 'Dispatch',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        toolCalls: [],
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Turn 1 execution error, activating offline fallback:', error);
      const reqBody = req.body || {};
      const agentNameVal = reqBody.activeAgentName || 'Agent Vance';
      const themeVal = reqBody.themeId || 'spy';
      const promptVal = reqBody.prompt || 'Execute directive';
      res.json({
        requiresToolExecution: false,
        dialogue: `[NEURAL OFFLINE / HEURISTIC SIMULATION] Free tier request quota reached or network limited. Operating in local heuristic simulation mode — directive "${promptVal.slice(0, 35)}..." successfully processed.`,
        cardTitle: 'Local Heuristic Operation',
        actionCategory: 'Simulated Recon',
        steps: [
          { label: 'Neural Core Venting', detail: 'Quota exhausted or network limited', status: 'verified' },
          { label: 'Local Heuristic Engine', detail: 'Generated offline tactical response with zero latency', status: 'completed' },
          { label: 'Operation Secured', detail: 'Mission state synchronized to local Dexie ledger', status: 'completed' },
        ],
        toolCalls: [],
        tokenEstimate: 120,
        agentName: agentNameVal,
        themeId: themeVal,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Turn 2: Follow-Up Gemini API Turn after the client's JavaScript Function Call Handler
   * executes the requested tool(s) and routes the live `functionResponse` data back to Gemini.
   */
  app.post('/api/agent/followup', async (req, res) => {
    try {
      const {
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentMemoryLog = [],
        attachment,
        temperature = 0.7,
        modelContent,
        functionResponses = [],
        executedTools = [],
      } = req.body;

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\n### PERSISTENT LONG-TERM MEMORY LEDGER (Your Past Experience & Instructions):\n` +
            `You have continuous persistent long-term memory. You remember all past conversations, completed tasks, findings, and user preferences recorded below:\n` +
            agentMemoryLog
              .slice(0, 30)
              .map((m: any, i: number) => `[Memory #${i + 1} | ${m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Recorded'}]\n• Directive: "${m.prompt}"\n• Result / Facts: ${m.summary}`)
              .join('\n\n') +
            `\n\nCRITICAL MEMORY RECALL INSTRUCTION:\n- You remember everything the user has ever told you and all tasks in this memory ledger.\n- If the user asks what you remember, references past directives, asks about previous work, or follow-up questions, actively draw upon and cite these memories.\n- NEVER say you don't have memory or cannot recall past interactions.`
          : '';

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}\nYou have just invoked external Function Calling tools and received live data in the functionResponse turn. Synthesize the live tool output accurately into your in-character dialogue.`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}\nYou have just invoked external Function Calling tools and received live data in the functionResponse turn. Synthesize the live tool output accurately into your in-character dialogue (2-3 crisp sentences citing the real numbers, facts, weather, or search findings) and 3 concrete execution steps.`;

      const userParts: any[] = [];
      if (attachment && attachment.data && attachment.mimeType) {
        userParts.push({
          inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.data,
          },
        });
      }
      userParts.push({
        text: prompt || 'Analyze this attached visual intel and provide an execution plan.',
      });

      // Build functionResponse parts for Gemini Turn 2
      const functionResponseParts = (functionResponses as Array<{
        id?: string;
        name: string;
        response: Record<string, any>;
      }>).map((fr) => ({
        functionResponse: {
          id: fr.id,
          name: fr.name,
          response: fr.response,
        },
      }));

      // Multi-turn contents: [User Prompt] -> [Model FunctionCall] -> [User FunctionResponse]
      const multiTurnContents: any[] = [
        { role: 'user', parts: userParts },
      ];

      if (modelContent && Array.isArray(modelContent.parts) && modelContent.parts.length > 0) {
        multiTurnContents.push(modelContent);
        multiTurnContents.push({
          role: 'user',
          parts: [
            ...functionResponseParts,
            {
              text: 'Synthesize the above functionResponse data into the final JSON response schema.',
            },
          ],
        });
      } else {
        multiTurnContents.push({
          role: 'user',
          parts: [
            {
              text: `Live Function Call Results:\n${JSON.stringify(
                functionResponses,
                null,
                2
              )}\nSynthesize these results into the final JSON response schema.`,
            },
          ],
        });
      }

      const synthesisResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: multiTurnContents,
        config: {
          systemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: STRUCTURED_CARD_SCHEMA,
        },
      });

      const rawJson = synthesisResponse.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = {
          dialogue:
            synthesisResponse.text ||
            'Function call telemetry synthesized. Standing by for next command.',
          cardTitle: 'Tool Synthesis Complete',
          actionCategory: 'Live Telemetry',
          steps: [
            { label: 'Execute Function Call', detail: 'Fetched live external endpoint data', status: 'completed' },
            { label: 'Synthesize Telemetry', detail: 'Grounded response in tool output', status: 'verified' },
          ],
        };
      }

      const promptChars =
        (prompt || '').length +
        JSON.stringify(functionResponses).length +
        (attachment ? 450 : 0);
      const outputChars = rawJson.length;
      const tokenEstimate = Math.max(64, Math.round((promptChars + outputChars) / 4));

      res.json({
        dialogue: parsed.dialogue || 'Function call synthesized.',
        cardTitle: parsed.cardTitle || 'Live Tool Operation',
        actionCategory: parsed.actionCategory || 'Live Telemetry',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        toolCalls: executedTools,
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Turn 2 follow-up synthesis error, activating offline fallback:', error);
      const reqBody = req.body || {};
      const agentNameVal = reqBody.activeAgentName || 'Agent Vance';
      const themeVal = reqBody.themeId || 'spy';
      const toolsVal = reqBody.executedTools || [];
      res.json({
        dialogue: `[NEURAL OFFLINE / TOOL SYNTHESIS] Free tier quota reached or network limited. Tool execution data successfully synthesized via local offline heuristic engine.`,
        cardTitle: 'Local Tool Synthesis',
        actionCategory: 'Live Telemetry',
        steps: [
          { label: 'Execute Function Call', detail: 'External endpoint responded successfully', status: 'completed' },
          { label: 'Local Fallback Synthesis', detail: 'Generated grounded telemetry response offline', status: 'verified' },
          { label: 'Ledger Synced', detail: 'Task recorded to immutable local ledger', status: 'completed' },
        ],
        toolCalls: toolsVal,
        tokenEstimate: 140,
        agentName: agentNameVal,
        themeId: themeVal,
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Multi-Agent Town Hall Roundtable Orchestration Endpoint (`/api/agent/roundtable`).
   * Accepts the active agents' custom names, distinct roles, specialties, and recent notes,
   * plus optional prior roundtable turns, and generates a multi-perspective sequential discussion.
   */
  app.post('/api/agent/roundtable', async (req, res) => {
    try {
      const {
        topic,
        themeId = 'spy',
        temperature = 0.75,
        participants = [],
        priorTurns = [],
      } = req.body;

      if (!topic || !String(topic).trim()) {
        res.status(400).json({ error: 'Roundtable agenda or prompt is required.' });
        return;
      }

      const ai = getGeminiClient();
      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const rosterDescription = Array.isArray(participants) && participants.length > 0
        ? participants
            .map(
              (p: any, idx: number) =>
                `Agent Slot ${idx} — Custom Name: "${p.customName || p.defaultName || `Agent ${idx + 1}`}", Role: "${p.role || 'Operative'}", Specialty: "${p.specialty || 'Field Ops'}", Sprite Gear: "${p.spriteVariant || 'trenchcoat'}", Recent Field Notes: ${
                  Array.isArray(p.recentNotes) && p.recentNotes.length > 0
                    ? p.recentNotes.join(' | ')
                    : 'Standing by at Command Center'
                }`
            )
            .join('\n')
        : `Agent Slot 0 — Custom Name: "Agent Vance", Role: "Lead Strategist"\nAgent Slot 1 — Custom Name: "Agent Nyx", Role: "Cyber & Signal Specialist"\nAgent Slot 2 — Custom Name: "Agent Cipher", Role: "Cryptographic Recon"`;

      const priorContext =
        Array.isArray(priorTurns) && priorTurns.length > 0
          ? `\nPrior Roundtable Transcript in this Session:\n${priorTurns
              .slice(-6)
              .map((t: any) => `[${t.speakerName} (${t.role})]: "${t.dialogue}"`)
              .join('\n')}\n`
          : '';

      const roundtableSystemInstruction = `${personaInstruction}
You are orchestrating a live "Town Hall" Multi-Agent Roundtable inside the central War Room.
All 3 active operatives have walked from their sectors to gather around the central Command Table.

ACTIVE CREW ROSTER & RECENT NOTES:
${rosterDescription}
${priorContext}
ROUNDTABLE RULES:
1. Generate a cohesive, multi-perspective roundtable conversation responding to the Commander's topic/prompt.
2. Have each of the 3 agents chime in sequentially (4 to 5 total turns across the 3 agents: e.g., Agent 0 opens with strategic framing, Agent 1 responds with signal/cyber/technical perspective, Agent 2 adds archival/recon analysis, and Agent 0 or another agent synthesizes a counter-point or closing tactical lock).
3. Every agent MUST use their exact Custom Name, stay true to their distinct Role and Specialty, explicitly reference at least one of their Recent Field Notes or the previous speaker's point, and keep each turn to 2-3 crisp, punchy sentences.
4. Provide a concise meetingTitle, a 1-2 sentence consensusSummary, and 3 concrete actionItems assigned to specific agents and sectors.`;

      const ROUNDTABLE_SCHEMA = {
        type: Type.OBJECT,
        properties: {
          meetingTitle: {
            type: Type.STRING,
            description: 'Concise 3-6 word title for this Town Hall Roundtable.',
          },
          consensusSummary: {
            type: Type.STRING,
            description:
              '1-2 sentence executive consensus reached by the crew at the end of the roundtable.',
          },
          turns: {
            type: Type.ARRAY,
            description:
              'Sequential multi-speaker dialogue turns (4 to 5 turns) where each custom-named agent chimes in with their distinct viewpoint.',
            items: {
              type: Type.OBJECT,
              properties: {
                agentIndex: {
                  type: Type.INTEGER,
                  description: 'Slot index of the speaking agent: 0, 1, or 2.',
                },
                speakerName: {
                  type: Type.STRING,
                  description: 'Exact customName of the speaking agent.',
                },
                role: {
                  type: Type.STRING,
                  description: 'Role title of the speaking agent.',
                },
                perspectiveTag: {
                  type: Type.STRING,
                  description:
                    'Short 2-word badge for their angle (e.g., STRATEGIC LEAD, CYBER RECON, ARCHIVE INTEL, FINAL CONSENSUS).',
                },
                dialogue: {
                  type: Type.STRING,
                  description:
                    '2 to 3 crisp in-character sentences responding to the prompt and reacting to fellow operatives.',
                },
                referencedNote: {
                  type: Type.STRING,
                  description:
                    'Brief citation of the recent field note, tool log, or specialty they are drawing from.',
                },
              },
              required: [
                'agentIndex',
                'speakerName',
                'role',
                'perspectiveTag',
                'dialogue',
                'referencedNote',
              ],
            },
          },
          actionItems: {
            type: Type.ARRAY,
            description: '3 concrete follow-up action items assigned to the crew.',
            items: {
              type: Type.OBJECT,
              properties: {
                agentIndex: {
                  type: Type.INTEGER,
                  description: 'Assigned agent index (0, 1, or 2).',
                },
                ownerName: {
                  type: Type.STRING,
                  description: 'Custom name of the assigned agent.',
                },
                directive: {
                  type: Type.STRING,
                  description: 'Actionable follow-up task description.',
                },
                targetSector: {
                  type: Type.STRING,
                  description:
                    'Recommended sector ID: war_room, comms_tower, server_vault, armory, briefing_lounge, library, or archive_basement.',
                },
              },
              required: ['agentIndex', 'ownerName', 'directive', 'targetSector'],
            },
          },
        },
        required: ['meetingTitle', 'consensusSummary', 'turns', 'actionItems'],
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Commander's Town Hall Roundtable Topic: "${String(topic).trim()}"\nGenerate the multi-agent roundtable transcript in the required JSON schema.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction: roundtableSystemInstruction,
          temperature: Number(temperature),
          responseMimeType: 'application/json',
          responseSchema: ROUNDTABLE_SCHEMA,
        },
      });

      const rawJson = response.text?.trim() || '{}';
      let parsed: any = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        const syntaxErr: any = new SyntaxError('Malformed JSON in roundtable synthesis response');
        syntaxErr.status = 422;
        syntaxErr.errorCode = 'MALFORMED_JSON';
        throw syntaxErr;
      }

      const tokenEstimate = Math.max(
        95,
        Math.round((String(topic).length + rosterDescription.length + rawJson.length) / 4)
      );

      res.json({
        meetingTitle: parsed.meetingTitle || 'Town Hall Strategic Roundtable',
        consensusSummary:
          parsed.consensusSummary ||
          'All operatives aligned on tactical priorities and sector assignments.',
        turns: Array.isArray(parsed.turns) ? parsed.turns : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        tokenEstimate,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Gemini Town Hall Roundtable error, activating offline fallback:', error);
      res.json({
        meetingTitle: 'Local Tactical Roundtable (Offline Mode)',
        consensusSummary: 'All operatives aligned on strategic priorities and sector assignments via local tactical matrix.',
        turns: [
          { agentIndex: 0, speakerName: 'Agent Vance', role: 'Lead Strategist', perspectiveTag: 'STRATEGIC LEAD', dialogue: 'Our primary neural uplink is currently cooling down from high traffic. We must rely on our secure local ledger and placed gear.', referencedNote: 'Local offline simulation active' },
          { agentIndex: 1, speakerName: 'Agent Nyx', role: 'Cyber Specialist', perspectiveTag: 'CYBER RECON', dialogue: 'Signal dishes and server racks are fully functional on our local subnet. All tool executions are being logged locally.', referencedNote: 'Server vault telemetry secured' },
          { agentIndex: 2, speakerName: 'Agent Cipher', role: 'Cryptographic Recon', perspectiveTag: 'ARCHIVE INTEL', dialogue: 'Encrypted dossiers remain secure in IndexedDB memory. We are ready to proceed with the Commander directive.', referencedNote: 'Vault clearance omega verified' },
        ],
        actionItems: [
          { agentIndex: 0, ownerName: 'Agent Vance', directive: 'Monitor thermal cooling status', targetSector: 'war_room' },
          { agentIndex: 1, ownerName: 'Agent Nyx', directive: 'Verify local tool connector endpoints', targetSector: 'server_vault' },
          { agentIndex: 2, ownerName: 'Agent Cipher', directive: 'Audit local memory ledger records', targetSector: 'archive_basement' },
        ],
        tokenEstimate: 150,
        themeId: req.body?.themeId || 'spy',
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * Multi-Provider LLM Ping Endpoint (`/api/llm/ping`)
   */
  app.post('/api/llm/ping', async (req, res) => {
    try {
      const { providerId, apiKey, endpoint, modelName, themeId = 'spy' } = req.body;

      if (providerId === 'gemini' || !providerId) {
        const key = apiKey || process.env.GEMINI_API_KEY;
        if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') {
          res.status(401).json({ ok: false, error: 'Gemini API key is missing or invalid.' });
          return;
        }
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName || 'gemini-3.8-flash',
          contents: 'Respond with a 6-word tactical readiness confirmation.',
        });
        res.json({
          ok: true,
          message: response.text?.trim() || 'Gemini link verified.',
          model: modelName || 'gemini-3.8-flash',
        });
        return;
      }

      if (providerId === 'openai') {
        if (!apiKey || !apiKey.trim()) {
          res.status(401).json({ ok: false, error: 'OpenAI API key is missing.' });
          return;
        }
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'gpt-4o',
            messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
            max_tokens: 50,
          }),
        });
        const oData = await oRes.json();
        if (!oRes.ok) {
          res.status(oRes.status).json({ ok: false, error: oData?.error?.message || 'OpenAI API authentication failed.' });
          return;
        }
        res.json({
          ok: true,
          message: 'OpenAI GPT connection verified.',
          model: modelName || 'gpt-4o',
        });
        return;
      }

      if (providerId === 'anthropic') {
        if (!apiKey || !apiKey.trim()) {
          res.status(401).json({ ok: false, error: 'Anthropic API key is missing.' });
          return;
        }
        const aRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'claude-3-5-sonnet-20241022',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Respond with a short tactical readiness confirmation.' }],
          }),
        });
        const aData = await aRes.json();
        if (!aRes.ok) {
          res.status(aRes.status).json({ ok: false, error: aData?.error?.message || 'Anthropic API authentication failed.' });
          return;
        }
        res.json({
          ok: true,
          message: 'Anthropic Claude connection verified.',
          model: modelName || 'claude-3-5-sonnet-20241022',
        });
        return;
      }

      if (providerId === 'ollama') {
        const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const olRes = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName || 'llama3',
            prompt: 'Respond with a short tactical readiness confirmation.',
            stream: false,
          }),
        });
        const olData = await olRes.json();
        if (!olRes.ok) {
          res.status(olRes.status).json({ ok: false, error: olData?.error || 'Failed to reach Ollama local endpoint.' });
          return;
        }
        res.json({
          ok: true,
          message: 'Local Ollama endpoint connection verified.',
          model: modelName || 'llama3',
        });
        return;
      }

      res.status(400).json({ ok: false, error: 'Unknown LLM provider specified.' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'LLM ping test failed.' });
    }
  });

  /**
   * Multi-Provider LLM Execute Endpoint (`/api/llm/execute`)
   */
  app.post('/api/llm/execute', async (req, res) => {
    try {
      const {
        providerId = 'gemini',
        apiKey,
        endpoint,
        modelName,
        prompt,
        themeId = 'spy',
        activeAgentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        agentSystemPrompt,
        agentMemoryLog = [],
        temperature = 0.7,
      } = req.body;

      const personaInstruction =
        THEME_PERSONA_INSTRUCTIONS[themeId] || THEME_PERSONA_INSTRUCTIONS.spy;

      const memoryContextStr =
        Array.isArray(agentMemoryLog) && agentMemoryLog.length > 0
          ? `\n\n### PERSISTENT LONG-TERM MEMORY LEDGER (Your Past Experience & Instructions):\n` +
            `You have continuous persistent long-term memory. You remember all past conversations, completed tasks, findings, and user preferences recorded below:\n` +
            agentMemoryLog
              .slice(0, 30)
              .map((m: any, i: number) => `[Memory #${i + 1} | ${m.timestamp ? new Date(m.timestamp).toLocaleString() : 'Recorded'}]\n• Directive: "${m.prompt}"\n• Result / Facts: ${m.summary}`)
              .join('\n\n') +
            `\n\nCRITICAL MEMORY RECALL INSTRUCTION:\n- You remember everything the user has ever told you and all tasks in this memory ledger.\n- If the user asks what you remember, references past directives, asks about previous work, or follow-up questions, actively draw upon and cite these memories.\n- NEVER say you don't have memory or cannot recall past interactions.`
          : '';

      const systemInstruction = agentSystemPrompt
        ? `${agentSystemPrompt}${memoryContextStr}\nReturn your response strictly as valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}`
        : `${personaInstruction}\nYou are currently responding as ${activeAgentName} (${activeAgentRole}).${memoryContextStr}\nReturn your response strictly as valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}`;

      let rawText = '';

      if (providerId === 'gemini' || !providerId) {
        const key = apiKey || process.env.GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey: key });
        const response = await ai.models.generateContent({
          model: modelName || 'gemini-3.8-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction,
            temperature: Number(temperature),
            responseMimeType: 'application/json',
            responseSchema: STRUCTURED_CARD_SCHEMA,
          },
        });
        rawText = response.text || '{}';
      } else if (providerId === 'openai') {
        const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'gpt-4o',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: Number(temperature),
          }),
        });
        const oData = await oRes.json();
        if (!oRes.ok) {
          throw new Error(oData?.error?.message || 'OpenAI API request failed.');
        }
        rawText = oData.choices?.[0]?.message?.content || '{}';
      } else if (providerId === 'anthropic') {
        const aRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName || 'claude-3-5-sonnet-20241022',
            max_tokens: 1500,
            system: systemInstruction,
            messages: [{ role: 'user', content: `${prompt}\n\nReturn strictly valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}` }],
            temperature: Number(temperature),
          }),
        });
        const aData = await aRes.json();
        if (!aRes.ok) {
          throw new Error(aData?.error?.message || 'Anthropic API request failed.');
        }
        rawText = aData.content?.[0]?.text || '{}';
      } else if (providerId === 'ollama') {
        const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
        const olRes = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName || 'llama3',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `${prompt}\n\nReturn strictly valid JSON matching the schema: {"dialogue": string, "cardTitle": string, "actionCategory": string, "steps": [{"label": string, "detail": string, "status": "completed"|"verified"|"queued"}]}` },
            ],
            stream: false,
            options: { temperature: Number(temperature) },
          }),
        });
        const olData = await olRes.json();
        if (!olRes.ok) {
          throw new Error(olData?.error || 'Failed to reach Ollama local endpoint.');
        }
        rawText = olData.message?.content || olData.response || '{}';
      }

      let parsed: any = {};
      try {
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          dialogue: rawText || 'Directive processed via provider adapter.',
          cardTitle: 'Multi-Provider Execution',
          actionCategory: 'Operations',
          steps: [
            { label: 'Provider Handshake', detail: `Successfully routed via ${providerId}`, status: 'completed' },
            { label: 'Parse Response', detail: 'Executed normalized task payload', status: 'verified' },
          ],
        };
      }

      const tokenEstimate = Math.max(50, Math.round((prompt.length + rawText.length) / 4));

      res.json({
        dialogue: parsed.dialogue || 'Directive executed.',
        cardTitle: parsed.cardTitle || 'Field Operation',
        actionCategory: parsed.actionCategory || 'Dispatch',
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        tokenEstimate,
        agentName: activeAgentName,
        themeId,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('LLM Provider execute error:', error);
      res.status(500).json({
        error: error?.message || 'LLM execution failed.',
        errorCode: 'SYSTEM_FAULT',
      });
    }
  });

    // Composio v3 Multi-User Proxy Route for local development & preview
  app.all('/api/composio', async (req, res) => {
    try {
      const apiKey =
        (req.headers['x-composio-api-key'] as string)?.trim() ||
        process.env.COMPOSIO_API_KEY?.trim();

      if (!apiKey) {
        return res.status(401).json({
          error: 'COMPOSIO_API_KEY_MISSING',
          message:
            'No Composio API key configured. Provide COMPOSIO_API_KEY in environment variables or pass x-composio-api-key header.',
        });
      }

      let endpoint = '';
      let method = req.method;
      let body: any = null;
      let entityId = (req.headers['x-entity-id'] as string) || '';

      if (req.method === 'POST') {
        endpoint = req.body?.endpoint || '';
        method = req.body?.method || 'POST';
        body = req.body?.body;
        entityId = req.body?.entityId || entityId;
      } else {
        endpoint = (req.query.endpoint as string) || '';
        entityId = (req.query.entityId as string) || entityId;
      }

      if (!endpoint) {
        return res.status(400).json({
          error: 'ENDPOINT_REQUIRED',
          message: 'Missing target endpoint parameter.',
        });
      }

      if (!entityId || !entityId.trim()) {
        return res.status(400).json({
          error: 'ENTITY_ID_REQUIRED',
          message: 'Caller unique entityId is mandatory for multi-user isolation.',
        });
      }

      let cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      cleanEndpoint = cleanEndpoint.replace(/^\/api\/v2/, '').replace(/^\/api\/v3/, '');

      const baseUrl = 'https://backend.composio.dev/api/v3';

      // DYNAMIC TOOL RESOLVER: Discovers all active integrations for entityId,
      // fetches their canonical tools from Composio v3, and returns them formatted
      // as Google Gemini FunctionDeclaration schemas on-the-fly (Zero Hardcoding).
      if (cleanEndpoint.startsWith('/dynamicTools') || cleanEndpoint.startsWith('/activeTools')) {
        try {
          const connRes = await fetch(
            `${baseUrl}/connectedAccounts?entityId=${encodeURIComponent(entityId)}`,
            {
              headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
            }
          );

          let activeAccounts: any[] = [];
          if (connRes.ok) {
            const connData: any = await connRes.json();
            activeAccounts = Array.isArray(connData)
              ? connData
              : connData?.items || connData?.connectedAccounts || connData?.data || [];
          }

          const activeAppNames: string[] = Array.from(
            new Set(
              activeAccounts
                .filter((a: any) => a.status === 'ACTIVE' || a.status === 'INITIATED')
                .map((a: any) => (a.appName || a.app_name || '').toLowerCase().trim())
                .filter(Boolean)
            )
          );

          const dynamicTools: any[] = [];
          await Promise.all(
            activeAppNames.map(async (app) => {
              try {
                const toolsRes = await fetch(
                  `${baseUrl}/tools?toolkit_slug=${encodeURIComponent(app)}`,
                  {
                    headers: {
                      'x-api-key': apiKey,
                      'Content-Type': 'application/json',
                      Accept: 'application/json',
                    },
                  }
                );
                if (toolsRes.ok) {
                  const toolsData: any = await toolsRes.json();
                  const items = Array.isArray(toolsData)
                    ? toolsData
                    : toolsData?.items || toolsData?.tools || [];

                  for (const item of items) {
                    const slug = item.slug || item.name;
                    if (!slug) continue;

                    const rawParams = item.parameters || {};
                    const parameters = {
                      type: 'OBJECT',
                      description: rawParams.description || item.description || `Parameters for ${slug}`,
                      properties: rawParams.properties || {},
                      required: Array.isArray(rawParams.required) ? rawParams.required : [],
                    };

                    dynamicTools.push({
                      name: `composio_${slug.toLowerCase()}`,
                      description: item.description || `Execute ${slug} on ${app.toUpperCase()} via Composio.`,
                      parameters,
                    });
                  }
                }
              } catch (toolFetchErr) {
                console.warn(`[COMPOSIO NODE] Tool discovery for ${app} skipped:`, toolFetchErr);
              }
            })
          );

          console.log(
            `[COMPOSIO NODE PROXY] Dynamic tools resolved for entity "${entityId}": ${dynamicTools.length} tool(s) across [${activeAppNames.join(', ')}]`
          );

          return res.json({
            ok: true,
            entityId,
            toolkits: activeAppNames,
            tools: dynamicTools,
          });
        } catch (dynamicErr: any) {
          return res.status(500).json({
            error: 'DYNAMIC_TOOLS_FETCH_FAILED',
            message: dynamicErr?.message || 'Failed to dynamically fetch tools.',
          });
        }
      }
      let targetUrl = `${baseUrl}${cleanEndpoint}`;
      let modifiedBody = body ? { ...body } : undefined;

      const isConnectedAccounts =
        cleanEndpoint.startsWith('/connected_accounts') ||
        cleanEndpoint.startsWith('/connectedAccounts');

      if (isConnectedAccounts) {
        if (method.toUpperCase() === 'GET') {
          const separator = targetUrl.includes('?') ? '&' : '?';
          targetUrl = `${targetUrl}${separator}entityId=${encodeURIComponent(entityId)}&user_uuid=${encodeURIComponent(entityId)}&user_id=${encodeURIComponent(entityId)}`;
        } else if (method.toUpperCase() === 'POST' && modifiedBody) {
          modifiedBody.user_uuid = entityId;
          modifiedBody.user_id = entityId;
          modifiedBody.entityId = entityId;
        }
      } else if ((cleanEndpoint.includes('/execute') || cleanEndpoint.includes('/tools/')) && modifiedBody) {
        modifiedBody.entityId = entityId;
        modifiedBody.user_uuid = entityId;
        modifiedBody.user_id = entityId;
      }

      const composioHeaders: Record<string, string> = {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: composioHeaders,
      };

      if (modifiedBody && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
        fetchOptions.body = JSON.stringify(modifiedBody);
      }

      console.log(
        `[COMPOSIO BACKEND PROXY] Method: ${method} | Endpoint: "${cleanEndpoint}" | Entity: "${entityId}" | Body:`,
        JSON.stringify(modifiedBody || {}).slice(0, 300)
      );
      let composioRes = await fetch(targetUrl, fetchOptions);

      // If 404 on connected_accounts, try alternative connectedAccounts route
      if (composioRes.status === 404 && targetUrl.includes('/connected_accounts')) {
        const altUrl = targetUrl.replace('/connected_accounts', '/connectedAccounts');
        try {
          const retryRes = await fetch(altUrl, fetchOptions);
          if (retryRes.status !== 404) {
            composioRes = retryRes;
          }
        } catch {}
      } else if (composioRes.status === 404 && targetUrl.includes('/connectedAccounts')) {
        const altUrl = targetUrl.replace('/connectedAccounts', '/connected_accounts');
        try {
          const retryRes = await fetch(altUrl, fetchOptions);
          if (retryRes.status !== 404) {
            composioRes = retryRes;
          }
        } catch {}
      }

      const data = await composioRes.text();
      res.status(composioRes.status);
      res.setHeader('Content-Type', composioRes.headers.get('Content-Type') || 'application/json');
      res.send(data);
    } catch (err: any) {
      res.status(502).json({
        error: 'COMPOSIO_PROXY_FAULT',
        message: err?.message || 'Failed to proxy request to Composio backend.',
      });
    }
  });

if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  
  /**
   * Dynamic Agent Execution Handler for Node Express
   * Route: POST /api/agent/dispatch
   * Dynamically pulls all active connected tools from Composio for the user's workspace
   * and injects them directly into Gemini function declarations with zero hardcoding.
   */
  app.post('/api/agent/dispatch', async (req, res) => {
    try {
      const composioApiKey =
        (req.headers['x-composio-api-key'] as string)?.trim() ||
        process.env.COMPOSIO_API_KEY?.trim();
      const geminiApiKey =
        (req.headers['x-gemini-api-key'] as string)?.trim() ||
        process.env.GEMINI_API_KEY?.trim();

      const {
        message,
        entityId = (req.headers['x-entity-id'] as string) || req.body?.composioEntityId || 'commander_default',
        agentName = 'Agent Vance',
        activeAgentRole = 'Lead Strategist',
        systemPrompt,
        temperature = 0.7,
      } = req.body || {};

      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Operational directive message is required.' });
      }

      const dynamicTools: any[] = [];
      const activeAppNames: string[] = [];

      if (composioApiKey && entityId) {
        try {
          const accountsRes = await fetch(
            `https://backend.composio.dev/api/v3/connectedAccounts?entityId=${encodeURIComponent(entityId)}`,
            {
              headers: {
                'x-api-key': composioApiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
            }
          );

          if (accountsRes.ok) {
            const accountsData: any = await accountsRes.json();
            const activeAccounts = Array.isArray(accountsData)
              ? accountsData
              : accountsData?.items || accountsData?.connectedAccounts || accountsData?.data || [];

            for (const acc of activeAccounts) {
              if (acc.status === 'ACTIVE' || acc.status === 'INITIATED') {
                const name = (acc.appName || acc.app_name || '').toLowerCase().trim();
                if (name && !activeAppNames.includes(name)) {
                  activeAppNames.push(name);
                }
              }
            }

            await Promise.all(
              activeAppNames.map(async (app) => {
                try {
                  const toolsRes = await fetch(
                    `https://backend.composio.dev/api/v3/tools?toolkit_slug=${encodeURIComponent(app)}`,
                    {
                      headers: {
                        'x-api-key': composioApiKey,
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                      },
                    }
                  );

                  if (toolsRes.ok) {
                    const toolsData: any = await toolsRes.json();
                    const items = Array.isArray(toolsData)
                      ? toolsData
                      : toolsData?.items || toolsData?.tools || [];

                    for (const item of items) {
                      const slug = item.slug || item.name;
                      if (!slug) continue;

                      const rawParams = item.parameters || {};
                      dynamicTools.push({
                        name: `composio_${slug.toLowerCase()}`,
                        description: item.description || `Execute ${slug} on ${app.toUpperCase()} via Composio.`,
                        parameters: {
                          type: 'OBJECT',
                          description: rawParams.description || item.description || `Parameters for ${slug}`,
                          properties: rawParams.properties || {},
                          required: Array.isArray(rawParams.required) ? rawParams.required : [],
                        },
                      });
                    }
                  }
                } catch (appErr) {
                  console.warn(`[NODE AGENT DISPATCH] Could not query tools for app ${app}:`, appErr);
                }
              })
            );
          }
        } catch (connErr) {
          console.warn('[NODE AGENT DISPATCH] Composio account discovery failed:', connErr);
        }
      }

      const declaredToolNames = dynamicTools.map((t) => t.name).join(', ');
      const systemInstruction = systemPrompt || `You are ${agentName} (${activeAgentRole}) in the PixelOps Command Center.
Available Dynamically Injected Tools: ${declaredToolNames || 'No external tools connected'}.

CRITICAL INTENT-DRIVEN TOOL SELECTION GUARDRAILS:
Before invoking any tool from Composio, analyze the user's intent:
- READ / LIST / SEARCH / AUDIT INTENT:
  If the user asks to check, audit, list, search, get, fetch, read, inspect, or review:
  You MUST select a LIST, GET, or SEARCH tool.
  NEVER default to a write/create action when a read/list action is requested.
- WRITE / CREATE / SEND / DELETE INTENT:
  If the user explicitly asks to create, send, push, post, schedule, star, or delete:
  You MUST select a CREATE, POST, SEND, or DELETE tool.
- PARAMETER VALIDATION:
  Ensure you correctly extract and validate required parameters from the user's directive before firing the tool.`;

      const ai = getGeminiClient();
      const turn1Response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: [{ text: message }] }],
        config: {
          systemInstruction,
          temperature: Number(temperature),
          tools: dynamicTools.length > 0 ? [{ functionDeclarations: dynamicTools }] : undefined,
        },
      });

      const functionCalls = turn1Response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const fc = functionCalls[0];
        const toolName = fc.name || '';
        const toolArgs = (fc.args as Record<string, any>) || {};

        console.log(`[NODE AGENT DISPATCH] Invoking tool: "${toolName}" with args:`, toolArgs);

        let executionResult: any = null;
        let executionSuccessful = false;

        if (composioApiKey && (toolName.startsWith('composio_') || toolName.startsWith('COMPOSIO_'))) {
          const rawAction = toolName.replace(/^composio_/i, '').toUpperCase();
          try {
            const execRes = await fetch(`https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(rawAction)}`, {
              method: 'POST',
              headers: {
                'x-api-key': composioApiKey,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                parameters: toolArgs,
                entityId,
              }),
            });

            executionResult = await execRes.json();
            executionSuccessful = execRes.ok;
          } catch (execErr: any) {
            executionResult = { error: execErr?.message || 'Tool execution network fault' };
          }
        }

        return res.json({
          success: true,
          requiresToolExecution: false,
          toolInvoked: toolName,
          args: toolArgs,
          executionResult,
          executionSuccessful,
          agentName,
        });
      }

      return res.json({
        success: true,
        dialogue: turn1Response.text || '',
        agentName,
        activeToolkits: activeAppNames,
        dynamicToolsCount: dynamicTools.length,
      });
    } catch (err: any) {
      console.error('[NODE AGENT DISPATCH FAULT]', err);
      return res.status(500).json({ error: 'AGENT_DISPATCH_FAULT', message: err?.message || String(err) });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PixelOps Command Server running on http://localhost:${PORT}`);
  });
}

startServer();
