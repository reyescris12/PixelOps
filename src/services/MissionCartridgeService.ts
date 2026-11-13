/**
 * Shareable Mission Cartridges Service
 * (src/services/MissionCartridgeService.ts)
 *
 * Packages operative system prompts, spatial room layouts, placed gear bindings,
 * sanitized MCP server templates, deterministic tripwire watchlists, and OSINT
 * workflows into portable `.pixelops.cartridge.json` files that users can load
 * in one click from the Armory or share across the community.
 */

import type { RoomId } from '../engine/roomData';
import {
  loadRoomSkillBindings,
  saveRoomSkillBindings,
  loadStationSkillBindings,
  saveStationSkillBindings,
} from '../engine/moduleRegistry';
import {
  loadPlacedGearState,
  savePlacedGearState,
  type RoomEquipmentAsset,
} from './PlacedGearService';
import {
  listMcpStations,
  saveMcpStation,
  loadSpatialLeashPolicy,
  saveSpatialLeashPolicy,
  type SpatialLeashPolicyConfig,
} from './SpatialMcpService';
import {
  listTripwireWatches,
  saveTripwireWatch,
  type TripwireWatchDbEntry,
} from './TripwireDiffService';
import {
  loadUserPlaybookTargets,
  saveUserPlaybookTarget,
  type UserPlaybookTarget,
} from '../engine/intelligencePlaybooks';

export interface CartridgeOperativeLoadout {
  agentId: string;
  displayName?: string;
  role?: string;
  room: RoomId;
  spriteVariant?: string;
  systemPrompt: string;
  assignedTools?: string[];
}

export interface CartridgeMcpTemplate {
  id: string;
  name: string;
  serverUrl: string;
  room: string;
  strictRoomLeash: boolean;
  authHeaderName?: string;
}

export interface CartridgeTripwireTemplate {
  id: string;
  label: string;
  category: TripwireWatchDbEntry['category'];
  target: string;
  assignedRoom: string;
  assignedAgentId: string;
  intervalMinutes: number;
  requireHumanApproval: boolean;
}

export interface MissionCartridgeV1 {
  schema: 'pixelops.cartridge.v1';
  id: string;
  name: string;
  tagline: string;
  description: string;
  author: string;
  version: string;
  category: 'osint_recon' | 'infra_hazards' | 'threat_hunting' | 'geopolitical_sitrep' | 'community';
  difficulty: 'Instant Onboarding' | 'Tactical Operator' | 'Red/Blue Specialist';
  tags: string[];
  createdAt: string;
  checksum?: string;
  starterDirective: string;
  starterRoom: RoomId;
  starterAgentId: string;
  crewLoadouts: CartridgeOperativeLoadout[];
  roomSkillBindings?: Record<string, string[]>;
  stationSkillBindings?: Record<string, string>;
  placedGearOverrides?: Partial<Record<string, Partial<RoomEquipmentAsset>>>;
  spatialLeashPolicy?: SpatialLeashPolicyConfig;
  mcpStations?: CartridgeMcpTemplate[];
  tripwireWatches?: CartridgeTripwireTemplate[];
  playbookTargets?: Record<string, UserPlaybookTarget>;
}

const COMMUNITY_CARTRIDGES_LS_KEY = 'pixelops_installed_cartridges_v1';
const ACTIVE_CARTRIDGE_ID_KEY = 'pixelops_active_cartridge_id_v1';

export const BUILTIN_ARMORY_CARTRIDGES: MissionCartridgeV1[] = [
  {
    schema: 'pixelops.cartridge.v1',
    id: 'cartridge_premedia_local_sigint',
    name: 'Pre-Media Local SIGINT & Dispatch Overwatch',
    tagline: 'Real-time 911 CAD, scanner triage, ADS-B emergency/medevac orbits & plume corroboration',
    description:
      'Configures the swarm for zero-delayed-news localized threat detection: Nyx collects Municipal 911/Fire/EMS CAD, NWS CAP polygons & radio scanner transcripts; Cipher cross-checks overhead ADS-B transponders & atmospheric smoke/chemical plume spikes; Vance alerts strictly on multi-track corroboration (>= 0.70).',
    author: 'PixelOps Pre-Media SIGINT Core',
    version: '1.0.0',
    category: 'threat_hunting',
    difficulty: 'Instant Onboarding',
    tags: ['Pre-Media SIGINT', '911 CAD', 'Radio Scanner', 'ADS-B', 'Plume Sensor', 'Corroboration'],
    createdAt: '2026-11-13T00:00:00.000Z',
    starterDirective:
      'Execute a live geofenced Pre-Media Signal Sweep across our local sector: poll Municipal 911 CAD & NWS CAP polygons, sweep overhead ADS-B transponders for emergency squawks or orbiting medevac/police rotorcraft, check atmospheric smoke/chemical plume sensors, and report corroborated threat clusters with SHA-256 packetId provenance.',
    starterRoom: 'comms_tower',
    starterAgentId: 'nyx',
    crewLoadouts: [
      {
        agentId: 'vance',
        room: 'war_room',
        systemPrompt:
          'You are Commander Vance, Pre-Media Threat Assessment Lead. Never rely on delayed mainstream news. Synthesize corroborated alerts strictly when independent pre-media tracks converge (>= 0.70 CORROBORATED or >= 0.90 CRITICAL_CONVERGENCE), citing exact SHA-256 packetIds.',
        assignedTools: [
          'query_corroboration_clusters',
          'osint_local_premedia_sweep',
          'delegate_task_to_operative',
          'query_evidence_graph',
        ],
      },
      {
        agentId: 'nyx',
        room: 'comms_tower',
        systemPrompt:
          'You are Operative Nyx in the Comms Tower. Collect real-time pre-media telemetry—Municipal 911/Fire/EMS CAD dispatches, NWS CAP active warning polygons, live scanner transcripts, and USGS/NASA geofenced hazard feeds—before mainstream media coverage.',
        assignedTools: [
          'osint_local_premedia_sweep',
          'osint_scanner_dispatch_triage',
          'osint_adsb_airspace_radar',
          'osint_hazard_tracker',
        ],
      },
      {
        agentId: 'cipher',
        room: 'server_vault',
        systemPrompt:
          'You are Analyst Cipher in the Server Vault. Cross-corroborate Nyx CAD/scanner alerts against overhead ADS-B emergency/medevac transponders, Open-Meteo smoke/chemical plume anomalies, and DNS/BGP infrastructure shifts.',
        assignedTools: [
          'osint_adsb_airspace_radar',
          'osint_local_premedia_sweep',
          'query_corroboration_clusters',
          'osint_bgp_route_lookup',
        ],
      },
    ],
    roomSkillBindings: {
      comms_tower: ['premedia_sigint_plugin', 'osint_adversarial_recon', 'osint_spectrum_plugin'],
      server_vault: ['premedia_sigint_plugin', 'crypto_vault', 'memory_lookup_plugin'],
      war_room: ['premedia_sigint_plugin', 'osint_hazard_plugin'],
    },
    tripwireWatches: [
      {
        id: 'tw_cart_premedia_usgs_blast',
        label: 'Pre-Media USGS Kinetic & Seismic Sensor Tripwire',
        category: 'usgs_seismic',
        target: 'local geofence',
        assignedRoom: 'comms_tower',
        assignedAgentId: 'nyx',
        intervalMinutes: 5,
        requireHumanApproval: true,
      },
      {
        id: 'tw_cart_premedia_nws_dns',
        label: 'NWS CAP Emergency Dispatch Gateway DNS Watch',
        category: 'dns',
        target: 'api.weather.gov',
        assignedRoom: 'server_vault',
        assignedAgentId: 'cipher',
        intervalMinutes: 15,
        requireHumanApproval: true,
      },
    ],
  },
  {
    schema: 'pixelops.cartridge.v1',
    id: 'cartridge_domain_footprint_audit',
    name: 'Domain Footprint & CT Attack-Surface Audit',
    tagline: 'Instant subdomain CT log enumeration, DNS/ASN mapping & Basement Link Board indexing',
    description:
      'Configures Nyx in the Comms Tower for external crt.sh & BGP/ASN sweeps, Cipher in the Server Vault for hash/TLS validation, and arms a deterministic DNS + Certificate Transparency tripwire watch.',
    author: 'PixelOps Armory Core',
    version: '1.2.0',
    category: 'osint_recon',
    difficulty: 'Instant Onboarding',
    tags: ['crt.sh', 'DNS', 'ASN', 'Attack Surface', 'Evidence Graph'],
    createdAt: '2026-11-12T00:00:00.000Z',
    starterDirective:
      'Execute a full domain footprint audit on cloudflare.com: enumerate Certificate Transparency subdomains, map BGP ASN routing, extract key IPs/ASNs into the Basement Evidence Graph, and save a structured dossier to Workspace Files.',
    starterRoom: 'comms_tower',
    starterAgentId: 'nyx',
    crewLoadouts: [
      {
        agentId: 'vance',
        room: 'war_room',
        systemPrompt:
          'You are Commander Vance. Synthesize external attack-surface findings into executive risk ratings, prioritize exposed subdomains, and coordinate Comms Tower sweeps with Server Vault verification.',
        assignedTools: ['delegate_task_to_operative', 'vault_query_intel', 'query_evidence_graph'],
      },
      {
        agentId: 'nyx',
        room: 'comms_tower',
        systemPrompt:
          'You are Operative Nyx stationed at the Comms Tower Dish Array. Prioritize crt.sh Certificate Transparency discovery, DNS record mapping, BGP ASN topology, and IP reputation telemetry with zero speculation.',
        assignedTools: [
          'osint_crtsh_subdomain_discovery',
          'osint_bgp_route_lookup',
          'osint_ip_reputation_audit',
          'live_web_search',
        ],
      },
      {
        agentId: 'cipher',
        room: 'server_vault',
        systemPrompt:
          'You are Analyst Cipher inside the Server Vault. Correlate extracted ASNs, IPs, and TLS certificates across historical dossiers and file deduplicated markdown intelligence into VFS.',
        assignedTools: ['fs_storage_manager', 'query_evidence_graph', 'memory_vector_lookup'],
      },
    ],
    roomSkillBindings: {
      comms_tower: ['osint_adversarial_recon', 'api_gateway_plugin', 'osint_spectrum_plugin'],
      server_vault: ['crypto_vault', 'memory_lookup_plugin', 'code_sandbox_plugin'],
      archive_basement: ['fs_storage_plugin', 'db_forensics'],
    },
    spatialLeashPolicy: {
      strictEnforcement: true,
      roomLeashes: {
        externalNetworkSweeps: ['comms_tower'],
        vfsVaultDecryption: ['server_vault'],
        evidenceForensics: ['archive_basement', 'war_room', 'library'],
        cartridgeArmory: ['armory', 'war_room'],
      },
    },
    tripwireWatches: [
      {
        id: 'tw_cart_dns_cloudflare',
        label: 'Cloudflare Edge DNS Baseline',
        category: 'dns',
        target: 'cloudflare.com',
        assignedRoom: 'comms_tower',
        assignedAgentId: 'nyx',
        intervalMinutes: 30,
        requireHumanApproval: true,
      },
      {
        id: 'tw_cart_ct_cloudflare',
        label: 'Cloudflare Certificate Transparency Watch',
        category: 'ct_certs',
        target: 'cloudflare.com',
        assignedRoom: 'comms_tower',
        assignedAgentId: 'nyx',
        intervalMinutes: 60,
        requireHumanApproval: true,
      },
    ],
  },
  {
    schema: 'pixelops.cartridge.v1',
    id: 'cartridge_seismic_subsea_grid',
    name: 'Seismic-Grid & Subsea Chokepoint Monitor',
    tagline: 'USGS M4.5+ deterministic hazard tripwires, maritime AIS corridors & orbital recon',
    description:
      'Pre-wires the War Room Holo-Desk and Comms Tower for subsea fiber corridor resilience, pairing USGS M4.5+ deterministic SHA-256 diffing with Maritime AIS chokepoint telemetry and NASA GIBS imagery.',
    author: 'PixelOps Geo-Infra Guild',
    version: '1.1.0',
    category: 'infra_hazards',
    difficulty: 'Instant Onboarding',
    tags: ['USGS Seismic', 'Maritime AIS', 'Subsea Cables', 'NASA GIBS', 'Tripwire'],
    createdAt: '2026-11-12T00:00:00.000Z',
    starterDirective:
      'Sweep global M4.5+ USGS seismic activity near Taiwan Strait and Luzon subsea cable corridors, correlate with Maritime AIS transit status, and archive an infrastructure resilience SITREP.',
    starterRoom: 'war_room',
    starterAgentId: 'vance',
    crewLoadouts: [
      {
        agentId: 'vance',
        room: 'war_room',
        systemPrompt:
          'You are Commander Vance monitoring global infrastructure resilience. Cross-reference USGS M4.5+ seismic events against subsea telecommunications cables, LNG chokepoints, and semiconductor supply hubs.',
        assignedTools: ['osint_hazard_tracker', 'osint_maritime_tracker', 'fs_storage_manager'],
      },
      {
        agentId: 'nyx',
        room: 'comms_tower',
        systemPrompt:
          'You are Operative Nyx handling orbital & spectrum verification. Corroborate terrestrial hazard events with NASA GIBS satellite layers and regional GNSS/ionospheric interference.',
        assignedTools: ['osint_satellite_recon', 'osint_spectrum_analyzer', 'live_web_search'],
      },
    ],
    roomSkillBindings: {
      war_room: ['osint_hazard_plugin', 'deep_research'],
      comms_tower: ['osint_satellite_plugin', 'osint_spectrum_plugin'],
      server_vault: ['osint_maritime_plugin', 'fs_storage_plugin'],
    },
    tripwireWatches: [
      {
        id: 'tw_cart_usgs_pacific',
        label: 'USGS M4.5+ Seismic Feed Tripwire',
        category: 'usgs_seismic',
        target: 'global M4.5',
        assignedRoom: 'war_room',
        assignedAgentId: 'vance',
        intervalMinutes: 15,
        requireHumanApproval: true,
      },
      {
        id: 'tw_cart_maritime_global',
        label: 'Strategic Maritime Chokepoints',
        category: 'maritime_ais',
        target: 'global',
        assignedRoom: 'server_vault',
        assignedAgentId: 'cipher',
        intervalMinutes: 30,
        requireHumanApproval: true,
      },
    ],
  },
  {
    schema: 'pixelops.cartridge.v1',
    id: 'cartridge_adversary_cve_hunt',
    name: 'Adversarial CVE & Threat Actor Link Hunt',
    tagline: 'Cross-investigation APT/CVE correlation in the Basement Link Board',
    description:
      'Tunes Cipher and Nyx for high-precision CVE exploitation tracking, MITRE ATT&CK technique extraction, VirusTotal/OTX indicator checks, and multi-dossier entity linking.',
    author: 'PixelOps Red/Blue Collective',
    version: '1.3.0',
    category: 'threat_hunting',
    difficulty: 'Red/Blue Specialist',
    tags: ['CVE', 'MITRE ATT&CK', 'Threat Actors', 'VirusTotal', 'Link Board'],
    createdAt: '2026-11-12T00:00:00.000Z',
    starterDirective:
      'Compile an active exploitation threat brief on critical edge-gateway CVEs and Volt Typhoon / APT28 infrastructure patterns, explicitly listing CVEs, ASNs, MITRE techniques, and domains for Evidence Graph correlation.',
    starterRoom: 'archive_basement',
    starterAgentId: 'cipher',
    crewLoadouts: [
      {
        agentId: 'cipher',
        room: 'archive_basement',
        systemPrompt:
          'You are Threat Hunter Cipher in the Archive Basement. Always include explicit CVE IDs, MITRE ATT&CK IDs (Txxxx), ASNs, and canonical adversary cluster names so the Evidence Graph exposes hidden cross-investigation bridges.',
        assignedTools: [
          'osint_virustotal_threat_check',
          'query_evidence_graph',
          'fs_storage_manager',
          'live_web_search',
        ],
      },
    ],
    roomSkillBindings: {
      comms_tower: ['osint_adversarial_recon', 'web_search_plugin'],
      archive_basement: ['db_forensics', 'fs_storage_plugin'],
      server_vault: ['crypto_vault', 'memory_lookup_plugin'],
    },
  },
  {
    schema: 'pixelops.cartridge.v1',
    id: 'cartridge_geopolitical_isw_watch',
    name: 'ISW Conflict Theater & Flashpoint Watch',
    tagline: 'Live Institute for the Study of War dossier synthesis + publication hash tripwire',
    description:
      'Pre-configures multi-theater geopolitical conflict monitoring over ISW assessments (Ukraine, Iran/Middle East, Korean Peninsula/Taiwan Strait) with a deterministic web-hash tripwire on understandingwar.org/research/.',
    author: 'PixelOps Strategic Warning Desk',
    version: '1.0.0',
    category: 'geopolitical_sitrep',
    difficulty: 'Tactical Operator',
    tags: ['ISW', 'Geopolitics', 'SITREP', 'Zero-Noise Watch'],
    createdAt: '2026-11-12T00:00:00.000Z',
    starterDirective:
      'Cross-reference the latest ingested ISW assessments across Eastern Europe, the Middle East, and the Indo-Pacific and file an integrated Commander Morning SITREP to Workspace Files.',
    starterRoom: 'library',
    starterAgentId: 'vance',
    crewLoadouts: [
      {
        agentId: 'vance',
        room: 'library',
        systemPrompt:
          'You are Strategic Analyst Vance in the Safehouse Library. Ground every assessment strictly in verified ISW research dossiers and S2 Wire dispatches stored in VFS, citing publication dates and theater coordinates.',
        assignedTools: ['isw_research_lookup', 'live_web_search', 'fs_storage_manager'],
      },
    ],
    tripwireWatches: [
      {
        id: 'tw_cart_isw_catalog',
        label: 'ISW Research Library New Publication Tripwire',
        category: 'web_hash',
        target: 'https://understandingwar.org/research/',
        assignedRoom: 'library',
        assignedAgentId: 'vance',
        intervalMinutes: 45,
        requireHumanApproval: true,
      },
    ],
  },
];

export async function computeCartridgeChecksum(
  cartridge: Omit<MissionCartridgeV1, 'checksum'>
): Promise<string> {
  const clone = { ...cartridge };
  delete (clone as any).checksum;
  const canonical = JSON.stringify(clone);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical)
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }
  return 'px_verified_v1';
}

export function listInstalledCustomCartridges(): MissionCartridgeV1[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(COMMUNITY_CARTRIDGES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveInstalledCustomCartridge(cartridge: MissionCartridgeV1): MissionCartridgeV1[] {
  const current = listInstalledCustomCartridges().filter((c) => c.id !== cartridge.id);
  const next = [cartridge, ...current];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(COMMUNITY_CARTRIDGES_LS_KEY, JSON.stringify(next));
    } catch {}
  }
  return next;
}

export function deleteInstalledCustomCartridge(cartridgeId: string): MissionCartridgeV1[] {
  const next = listInstalledCustomCartridges().filter((c) => c.id !== cartridgeId);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(COMMUNITY_CARTRIDGES_LS_KEY, JSON.stringify(next));
    } catch {}
  }
  return next;
}

export function getActiveCartridgeId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(ACTIVE_CARTRIDGE_ID_KEY);
  } catch {
    return null;
  }
}

/**
 * Validates untrusted JSON text or object as a safe `MissionCartridgeV1` and strips any secret-like fields.
 */
export function parseAndValidateCartridge(rawInput: string | unknown): {
  ok: boolean;
  cartridge?: MissionCartridgeV1;
  error?: string;
} {
  try {
    const obj: any = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    if (!obj || typeof obj !== 'object') {
      return { ok: false, error: 'Cartridge payload must be a JSON object.' };
    }
    if (obj.schema !== 'pixelops.cartridge.v1') {
      return {
        ok: false,
        error: `Unsupported cartridge schema "${String(obj.schema || 'missing')}". Expected "pixelops.cartridge.v1".`,
      };
    }
    if (!obj.name || typeof obj.name !== 'string') {
      return { ok: false, error: 'Cartridge is missing a valid `name`.' };
    }
    if (!Array.isArray(obj.crewLoadouts)) {
      return { ok: false, error: 'Cartridge `crewLoadouts` must be an array.' };
    }

    // Scrub any accidental secret fields from MCP templates
    const safeMcp: CartridgeMcpTemplate[] = Array.isArray(obj.mcpStations)
      ? obj.mcpStations
          .filter((m: any) => m && typeof m.serverUrl === 'string' && /^https?:\/\//i.test(m.serverUrl))
          .map((m: any) => ({
            id: String(m.id || `mcp_${Date.now()}`),
            name: String(m.name || 'Imported MCP Station'),
            serverUrl: String(m.serverUrl).trim(),
            room: String(m.room || 'comms_tower'),
            strictRoomLeash: Boolean(m.strictRoomLeash ?? true),
            authHeaderName: m.authHeaderName ? String(m.authHeaderName) : undefined,
          }))
      : [];

    const validated: MissionCartridgeV1 = {
      schema: 'pixelops.cartridge.v1',
      id: String(obj.id || `cart_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
      name: String(obj.name).slice(0, 90),
      tagline: String(obj.tagline || obj.description || 'Community Safehouse Cartridge').slice(0, 140),
      description: String(obj.description || '').slice(0, 600),
      author: String(obj.author || 'Community Operative').slice(0, 60),
      version: String(obj.version || '1.0.0').slice(0, 20),
      category: [
        'osint_recon',
        'infra_hazards',
        'threat_hunting',
        'geopolitical_sitrep',
        'community',
      ].includes(obj.category)
        ? obj.category
        : 'community',
      difficulty: [
        'Instant Onboarding',
        'Tactical Operator',
        'Red/Blue Specialist',
      ].includes(obj.difficulty)
        ? obj.difficulty
        : 'Tactical Operator',
      tags: Array.isArray(obj.tags) ? obj.tags.map((t: any) => String(t).slice(0, 28)).slice(0, 8) : [],
      createdAt: String(obj.createdAt || new Date().toISOString()),
      checksum: obj.checksum ? String(obj.checksum) : undefined,
      starterDirective: String(obj.starterDirective || '').slice(0, 1000),
      starterRoom: (obj.starterRoom || 'war_room') as RoomId,
      starterAgentId: String(obj.starterAgentId || 'vance'),
      crewLoadouts: obj.crewLoadouts.slice(0, 12).map((c: any) => ({
        agentId: String(c.agentId || 'vance'),
        displayName: c.displayName ? String(c.displayName).slice(0, 40) : undefined,
        role: c.role ? String(c.role).slice(0, 50) : undefined,
        room: (c.room || 'war_room') as RoomId,
        spriteVariant: c.spriteVariant ? String(c.spriteVariant) : undefined,
        systemPrompt: String(c.systemPrompt || '').slice(0, 2000),
        assignedTools: Array.isArray(c.assignedTools)
          ? c.assignedTools.map((t: any) => String(t))
          : undefined,
      })),
      roomSkillBindings:
        obj.roomSkillBindings && typeof obj.roomSkillBindings === 'object'
          ? obj.roomSkillBindings
          : undefined,
      stationSkillBindings:
        obj.stationSkillBindings && typeof obj.stationSkillBindings === 'object'
          ? obj.stationSkillBindings
          : undefined,
      spatialLeashPolicy: obj.spatialLeashPolicy || undefined,
      mcpStations: safeMcp,
      tripwireWatches: Array.isArray(obj.tripwireWatches) ? obj.tripwireWatches.slice(0, 15) : undefined,
      playbookTargets:
        obj.playbookTargets && typeof obj.playbookTargets === 'object'
          ? obj.playbookTargets
          : undefined,
    };

    return { ok: true, cartridge: validated };
  } catch (err: any) {
    return { ok: false, error: `Invalid JSON cartridge: ${err?.message || 'parse error'}` };
  }
}

/**
 * Applies a Mission Cartridge to the local safehouse state in one atomic operation.
 */
export async function applyMissionCartridge(
  cartridge: MissionCartridgeV1,
  callbacks?: {
    onUpdateAgentConfig?: (
      agentId: string,
      updates: {
        customName?: string;
        role?: string;
        currentRoom?: RoomId;
        spriteVariant?: any;
        systemPrompt?: string;
        assignedTools?: string[];
      }
    ) => void;
    onMoveAgentToRoom?: (agentId: string, room: RoomId) => void;
  }
): Promise<{
  appliedAgents: number;
  appliedMcpStations: number;
  appliedTripwires: number;
}> {
  let appliedAgents = 0;
  let appliedMcpStations = 0;
  let appliedTripwires = 0;

  // 1. Apply Crew Loadouts (system prompts, room placements, toolkits)
  for (const loadout of cartridge.crewLoadouts) {
    callbacks?.onUpdateAgentConfig?.(loadout.agentId, {
      ...(loadout.displayName ? { customName: loadout.displayName } : {}),
      ...(loadout.role ? { role: loadout.role } : {}),
      currentRoom: loadout.room,
      ...(loadout.spriteVariant ? { spriteVariant: loadout.spriteVariant } : {}),
      systemPrompt: loadout.systemPrompt,
      ...(loadout.assignedTools ? { assignedTools: loadout.assignedTools } : {}),
    });
    callbacks?.onMoveAgentToRoom?.(loadout.agentId, loadout.room);
    appliedAgents++;
  }

  // 2. Apply Room & Station Skill Bindings
  if (cartridge.roomSkillBindings) {
    const mergedRooms = {
      ...loadRoomSkillBindings(),
      ...cartridge.roomSkillBindings,
    };
    saveRoomSkillBindings(mergedRooms);
  }
  if (cartridge.stationSkillBindings) {
    const mergedStations = {
      ...loadStationSkillBindings(),
      ...cartridge.stationSkillBindings,
    };
    saveStationSkillBindings(mergedStations);
  }

  // 3. Apply Placed Gear Overrides if present
  if (cartridge.placedGearOverrides) {
    const gear = loadPlacedGearState();
    for (const [stationId, patch] of Object.entries(cartridge.placedGearOverrides)) {
      if (gear[stationId] && patch) {
        gear[stationId] = { ...gear[stationId], ...patch };
      }
    }
    savePlacedGearState(gear);
  }

  // 4. Apply Spatial Leash Policy if bundled
  if (cartridge.spatialLeashPolicy) {
    saveSpatialLeashPolicy(cartridge.spatialLeashPolicy);
  }

  // 5. Register Sanitized MCP Station Templates
  if (Array.isArray(cartridge.mcpStations)) {
    for (const mcp of cartridge.mcpStations) {
      await saveMcpStation({
        id: mcp.id,
        name: mcp.name,
        serverUrl: mcp.serverUrl,
        room: mcp.room,
        enabled: true,
        strictRoomLeash: mcp.strictRoomLeash,
        authHeaderName: mcp.authHeaderName,
        lastStatus: 'untested',
      });
      appliedMcpStations++;
    }
  }

  // 6. Arm Bundled Deterministic Tripwires
  if (Array.isArray(cartridge.tripwireWatches)) {
    for (const tw of cartridge.tripwireWatches) {
      await saveTripwireWatch({
        id: tw.id,
        label: tw.label,
        category: tw.category,
        target: tw.target,
        assignedRoom: tw.assignedRoom,
        assignedAgentId: tw.assignedAgentId,
        intervalMinutes: tw.intervalMinutes,
        enabled: true,
        requireHumanApproval: tw.requireHumanApproval,
      });
      appliedTripwires++;
    }
  }

  // 7. Apply Playbook Targets if bundled
  if (cartridge.playbookTargets) {
    for (const [playbookId, target] of Object.entries(cartridge.playbookTargets)) {
      saveUserPlaybookTarget(playbookId as any, target);
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(ACTIVE_CARTRIDGE_ID_KEY, cartridge.id);
    } catch {}
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:cartridge_applied', { detail: { cartridge } })
      );
    } catch {}
  }

  return { appliedAgents, appliedMcpStations, appliedTripwires };
}

/**
 * Exports the user's current safehouse configuration (prompts, room bindings, MCP URLs,
 * spatial leashes, tripwires, and playbook targets) into a secret-free shareable cartridge.
 */
export async function exportCurrentSafehouseCartridge(params: {
  name: string;
  tagline?: string;
  description?: string;
  author?: string;
  tags?: string[];
  starterDirective?: string;
  starterRoom?: RoomId;
  starterAgentId?: string;
  crewSnapshots: Array<{
    id: string;
    customName?: string;
    role?: string;
    currentRoom?: RoomId;
    spriteVariant?: string;
    systemPrompt?: string;
    assignedTools?: string[];
  }>;
}): Promise<MissionCartridgeV1> {
  const [mcpStations, tripwires] = await Promise.all([
    listMcpStations(),
    listTripwireWatches(),
  ]);

  const baseCartridge: Omit<MissionCartridgeV1, 'checksum'> = {
    schema: 'pixelops.cartridge.v1',
    id: `cart_${params.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}_${Date.now().toString(36)}`,
    name: params.name.trim() || 'Custom Safehouse Routine',
    tagline: params.tagline?.trim() || 'Exported PixelOps Safehouse Mission Cartridge',
    description:
      params.description?.trim() ||
      'Custom operative prompts, room skill layout, MCP stations, and deterministic tripwire watches.',
    author: params.author?.trim() || 'Safehouse Commander',
    version: '1.0.0',
    category: 'community',
    difficulty: 'Tactical Operator',
    tags: params.tags && params.tags.length > 0 ? params.tags : ['Custom Loadout', 'Armory'],
    createdAt: new Date().toISOString(),
    starterDirective:
      params.starterDirective?.trim() ||
      'Execute initial sector readiness sweep and verify active tripwire baselines.',
    starterRoom: params.starterRoom || 'war_room',
    starterAgentId: params.starterAgentId || 'vance',
    crewLoadouts: params.crewSnapshots.map((c) => ({
      agentId: c.id,
      displayName: c.customName,
      role: c.role,
      room: (c.currentRoom || 'war_room') as RoomId,
      spriteVariant: c.spriteVariant,
      systemPrompt: c.systemPrompt || '',
      assignedTools: c.assignedTools,
    })),
    roomSkillBindings: loadRoomSkillBindings(),
    stationSkillBindings: loadStationSkillBindings(),
    spatialLeashPolicy: loadSpatialLeashPolicy(),
    // Strictly scrub any tokens—export URLs & room assignments only
    mcpStations: mcpStations.map((m) => ({
      id: m.id,
      name: m.name,
      serverUrl: m.serverUrl,
      room: m.room,
      strictRoomLeash: m.strictRoomLeash,
      authHeaderName: m.authHeaderName,
    })),
    tripwireWatches: tripwires.map((t) => ({
      id: t.id,
      label: t.label,
      category: t.category,
      target: t.target,
      assignedRoom: t.assignedRoom,
      assignedAgentId: t.assignedAgentId,
      intervalMinutes: t.intervalMinutes,
      requireHumanApproval: t.requireHumanApproval,
    })),
    playbookTargets: loadUserPlaybookTargets(),
  };

  const checksum = await computeCartridgeChecksum(baseCartridge);
  return { ...baseCartridge, checksum };
}

export function downloadCartridgeFile(cartridge: MissionCartridgeV1): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const slug = cartridge.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(cartridge, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug || 'mission'}.pixelops.cartridge.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
