export interface SkillModuleDef {
  id: string;
  name: string;
  shortCode: string;
  category: 'code' | 'research' | 'security' | 'system' | 'data';
  description: string;
  systemPromptModifier: string;
  providedTools: string[];
  recommendedRoom?: string;
  iconName: string;
}

export const AVAILABLE_SKILLS: SkillModuleDef[] = [
  {
    id: 'web_search_plugin',
    name: 'Web Search & Extraction',
    shortCode: 'WEB_SEARCH',
    category: 'research',
    description:
      'Enables live web queries, real-time web search via Jina Reader, and documentation extraction.',
    systemPromptModifier: '',
    providedTools: ['live_web_search'],
    recommendedRoom: 'library',
    iconName: 'Search',
  },
  {
    id: 'code_sandbox_plugin',
    name: 'Code Sandbox & JS Evaluator',
    shortCode: 'CODE_SANDBOX',
    category: 'code',
    description:
      'Allows local code drafting, testing, mathematical computation, and data processing in an isolated sandbox.',
    systemPromptModifier: '',
    providedTools: ['code_sandbox_eval'],
    recommendedRoom: 'server_vault',
    iconName: 'Cpu',
  },
  {
    id: 'fs_storage_plugin',
    name: 'File System & Storage Manager',
    shortCode: 'FS_STORAGE',
    category: 'data',
    description:
      'Handles reading, writing, and exporting markdown logs, JSON configs, and workspace files directly to IndexedDB or user downloads.',
    systemPromptModifier: '',
    providedTools: ['fs_storage_manager'],
    recommendedRoom: 'archive_basement',
    iconName: 'Database',
  },
  {
    id: 'api_gateway_plugin',
    name: 'API & Fetch Gateway',
    shortCode: 'API_GATEWAY',
    category: 'system',
    description:
      'A generalized client supporting BYOK execution for custom REST endpoints and webhooks.',
    systemPromptModifier: '',
    providedTools: ['api_fetch_gateway'],
    recommendedRoom: 'comms_tower',
    iconName: 'Radar',
  },
  {
    id: 'memory_lookup_plugin',
    name: 'Memory & Vector Lookup',
    shortCode: 'MEMORY_LOOKUP',
    category: 'security',
    description:
      'Queries local historical logs, Dexie/IndexedDB immutable records, and saved agent notes.',
    systemPromptModifier: '',
    providedTools: ['memory_vector_lookup'],
    recommendedRoom: 'server_vault',
    iconName: 'Key',
  },
  {
    id: 'github_scraper',
    name: 'GitHub Repo Scraper',
    shortCode: 'GITHUB_SCRAPER',
    category: 'code',
    description:
      'Fetches repository trees, git logs, branch diffs, and pull requests via the local safehouse bridge.',
    systemPromptModifier: '',
    providedTools: ['fetch_github_repo', 'read_git_diff', 'inspect_repo_tree'],
    recommendedRoom: 'cyber_lab',
    iconName: 'FolderGit2',
  },
  {
    id: 'deep_research',
    name: 'Deep Research Engine',
    shortCode: 'DEEP_RESEARCH',
    category: 'research',
    description:
      'Autonomous multi-hop web retrieval, search query generation, and intelligence synthesis across archives.',
    systemPromptModifier: '',
    providedTools: ['web_search', 'extract_page_content', 'synthesize_intel'],
    recommendedRoom: 'library',
    iconName: 'Search',
  },
  {
    id: 'code_refactor',
    name: 'AST Code Refactor Engine',
    shortCode: 'CODE_REFACTOR',
    category: 'code',
    description:
      'High-speed syntax tree analysis, AST pattern replacement, and type-safe refactoring pipelines.',
    systemPromptModifier: '',
    providedTools: ['ast_parse', 'apply_code_patch', 'run_linter'],
    recommendedRoom: 'war_room',
    iconName: 'Cpu',
  },
  {
    id: 'terminal_shell',
    name: 'Headless Shell Sandbox',
    shortCode: 'TERMINAL_SHELL',
    category: 'system',
    description:
      'Direct execution of local whitelisted shell scripts and node commands through the safehouse sidecar.',
    systemPromptModifier: '',
    providedTools: ['execute_shell_cmd', 'read_local_file', 'write_local_file'],
    recommendedRoom: 'server_vault',
    iconName: 'Terminal',
  },
  {
    id: 'crypto_vault',
    name: 'Quantum Key Decryptor',
    shortCode: 'CRYPTO_VAULT',
    category: 'security',
    description:
      'Analyzes encrypted environment secrets, parses cipher payloads, and validates JWT/HMAC hashes.',
    systemPromptModifier: '',
    providedTools: ['decrypt_vault_secret', 'verify_hash_checksum', 'generate_secure_nonce'],
    recommendedRoom: 'quantum_vault',
    iconName: 'Key',
  },
  {
    id: 'db_forensics',
    name: 'Database Forensics Analyzer',
    shortCode: 'DB_FORENSICS',
    category: 'data',
    description:
      'Query performance analyzer, migration planner, and schema relational graph extractor.',
    systemPromptModifier: '',
    providedTools: ['analyze_query_plan', 'inspect_db_schema', 'generate_migration'],
    recommendedRoom: 'archive_basement',
    iconName: 'Database',
  },
  {
    id: 'browser_crawler',
    name: 'Stealth Browser Crawler',
    shortCode: 'BROWSER_CRAWLER',
    category: 'research',
    description:
      'Headless DOM interaction and DOM tree scraper for dynamic single-page web applications.',
    systemPromptModifier: '',
    providedTools: ['crawl_url', 'extract_dom_elements', 'capture_screenshot'],
    recommendedRoom: 'comms_tower',
    iconName: 'Radar',
  },
  {
    id: 'osint_maritime_plugin',
    name: 'Maritime AIS Radar & Vessel Tracking',
    shortCode: 'AIS_RADAR',
    category: 'data',
    description:
      'Real-time Automatic Identification System (AIS) vessel transponder tracking, strategic chokepoint transit delays (Suez, Panama, Hormuz), and dark vessel indicators.',
    systemPromptModifier:
      'You have live access to global AIS maritime telemetry. Use osint_maritime_tracker to monitor naval transits, shipping chokepoints, and port congestion.',
    providedTools: ['osint_maritime_tracker'],
    recommendedRoom: 'server_vault',
    iconName: 'Radar',
  },
  {
    id: 'osint_hazard_plugin',
    name: 'Global Hazards & Seismic Intel (USGS)',
    shortCode: 'HAZARD_INTEL',
    category: 'research',
    description:
      'Real-time global seismic feeds from USGS (all magnitudes, M4.5+, significant events) and multi-hazard alerts from GDACS (tsunamis, cyclones, volcanoes, floods).',
    systemPromptModifier:
      'You have live telemetry for global seismic events and natural hazards. Cross-reference USGS telemetry before evaluating infrastructure disruptions.',
    providedTools: ['osint_hazard_tracker'],
    recommendedRoom: 'war_room',
    iconName: 'Database',
  },
  {
    id: 'osint_satellite_plugin',
    name: 'NASA GIBS Satellite Reconnaissance',
    shortCode: 'SAT_RECON',
    category: 'research',
    description:
      'Direct high-resolution multispectral optical, infrared, and nighttime lights satellite snapshots from NASA GIBS & Copernicus Sentinel metadata.',
    systemPromptModifier:
      'You have access to open satellite reconnaissance imagery. Use osint_satellite_recon to generate high-resolution snapshot URLs of target coordinates.',
    providedTools: ['osint_satellite_recon'],
    recommendedRoom: 'comms_tower',
    iconName: 'Search',
  },
  {
    id: 'osint_spectrum_plugin',
    name: 'Spectrum & GNSS Interference (EW)',
    shortCode: 'SPECTRUM_EW',
    category: 'security',
    description:
      'Real-time civil aviation GNSS jamming & spoofing corridor index combined with NOAA SWPC solar flare and geomagnetic storm levels (Kp-index).',
    systemPromptModifier:
      'You have real-time spectrum and electronic warfare telemetry. Check regional GPS degradation and space weather before evaluating communications or flight path deviations.',
    providedTools: ['osint_spectrum_analyzer'],
    recommendedRoom: 'comms_tower',
    iconName: 'Radar',
  },
];

const ROOM_BINDINGS_STORAGE_KEY = 'pixelops_room_skill_bindings_v1';
const STATION_BINDINGS_STORAGE_KEY = 'pixelops_station_skill_bindings_v1';

// Default initial bindings bridging rooms to capabilities
const DEFAULT_ROOM_BINDINGS: Record<string, string[]> = {
  comms_tower: ['api_gateway_plugin', 'web_search_plugin', 'osint_spectrum_plugin', 'osint_satellite_plugin'],
  war_room: ['code_sandbox_plugin', 'api_gateway_plugin', 'osint_hazard_plugin'],
  server_vault: ['code_sandbox_plugin', 'memory_lookup_plugin', 'osint_maritime_plugin'],
  armory: ['code_sandbox_plugin'],
  briefing_lounge: ['memory_lookup_plugin'],
  library: ['web_search_plugin', 'deep_research'],
  archive_basement: ['fs_storage_plugin', 'memory_lookup_plugin'],
  cyber_lab: ['code_sandbox_plugin', 'github_scraper'],
  quantum_vault: ['memory_lookup_plugin', 'crypto_vault'],
  stealth_hangar: ['api_gateway_plugin'],
};

const DEFAULT_STATION_BINDINGS: Record<string, string> = {
  comms_cipher_rig: 'api_gateway_plugin',
  comms_dish_console: 'osint_satellite_plugin',
  war_left_desk: 'code_sandbox_plugin',
  war_center_desk: 'osint_hazard_plugin',
  vault_laptop: 'memory_lookup_plugin',
  vault_core_rack: 'osint_maritime_plugin',
  lib_front_desk: 'deep_research',
  lib_card_catalog: 'web_search_plugin',
  basement_omega_safe: 'fs_storage_plugin',
  cyber_bench: 'code_sandbox_plugin',
  cyber_neural_pod: 'github_scraper',
};

type ModuleRegistryListener = () => void;
const listeners = new Set<ModuleRegistryListener>();

export function subscribeModuleRegistry(cb: ModuleRegistryListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(): void {
  for (const cb of Array.from(listeners)) {
    try {
      cb();
    } catch (e) {
      console.error('Error in module registry listener:', e);
    }
  }
}

let memoryRoomBindings: Record<string, string[]> = { ...DEFAULT_ROOM_BINDINGS };
let memoryStationBindings: Record<string, string> = { ...DEFAULT_STATION_BINDINGS };

/**
 * Loads room skill bindings map (roomId -> array of skillIds).
 */
export function loadRoomSkillBindings(): Record<string, string[]> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(ROOM_BINDINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_ROOM_BINDINGS };
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : { ...DEFAULT_ROOM_BINDINGS };
    } catch (e) {
      console.warn('Failed to load room skill bindings:', e);
      return { ...DEFAULT_ROOM_BINDINGS };
    }
  }
  return memoryRoomBindings;
}

/**
 * Saves room skill bindings map to storage.
 */
export function saveRoomSkillBindings(bindings: Record<string, string[]>): void {
  memoryRoomBindings = { ...bindings };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(ROOM_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
      notifyListeners();
    } catch (e) {
      console.warn('Failed to save room skill bindings:', e);
    }
  } else {
    notifyListeners();
  }
}

/**
 * Loads workstation-specific skill bindings map (stationId -> skillId).
 */
export function loadStationSkillBindings(): Record<string, string> {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STATION_BINDINGS_STORAGE_KEY);
      if (!raw) return { ...DEFAULT_STATION_BINDINGS };
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : { ...DEFAULT_STATION_BINDINGS };
    } catch (e) {
      console.warn('Failed to load station skill bindings:', e);
      return { ...DEFAULT_STATION_BINDINGS };
    }
  }
  return memoryStationBindings;
}

/**
 * Saves workstation-specific skill bindings map to storage.
 */
export function saveStationSkillBindings(bindings: Record<string, string>): void {
  memoryStationBindings = { ...bindings };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STATION_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
      notifyListeners();
    } catch (e) {
      console.warn('Failed to save station skill bindings:', e);
    }
  } else {
    notifyListeners();
  }
}

/**
 * Mounts a skill module to a room or specifically to a workstation.
 */
export function mountSkillToRoom(roomId: string, skillId: string, stationId?: string): void {
  const roomBindings = loadRoomSkillBindings();
  const currentSkills = roomBindings[roomId] || [];
  if (!currentSkills.includes(skillId)) {
    roomBindings[roomId] = [...currentSkills, skillId];
    saveRoomSkillBindings(roomBindings);
  }

  if (stationId) {
    const stationBindings = loadStationSkillBindings();
    stationBindings[stationId] = skillId;
    saveStationSkillBindings(stationBindings);
  } else {
    notifyListeners();
  }
}

/**
 * Unmounts a skill module from a room or workstation.
 */
export function unmountSkillFromRoom(roomId: string, skillId: string, stationId?: string): void {
  const roomBindings = loadRoomSkillBindings();
  if (roomBindings[roomId]) {
    roomBindings[roomId] = roomBindings[roomId].filter((id) => id !== skillId);
    saveRoomSkillBindings(roomBindings);
  }

  if (stationId) {
    const stationBindings = loadStationSkillBindings();
    if (stationBindings[stationId] === skillId) {
      delete stationBindings[stationId];
      saveStationSkillBindings(stationBindings);
    }
  } else {
    // If unmounted from room, also remove any station bindings in that room pointing to this skill
    const stationBindings = loadStationSkillBindings();
    let changed = false;
    for (const [stId, sId] of Object.entries(stationBindings)) {
      if (sId === skillId) {
        delete stationBindings[stId];
        changed = true;
      }
    }
    if (changed) saveStationSkillBindings(stationBindings);
  }
}

/**
 * Retrieves all skill definitions bound to a room.
 */
export function getRoomBoundSkills(roomId: string): SkillModuleDef[] {
  const roomBindings = loadRoomSkillBindings();
  const skillIds = roomBindings[roomId] || [];
  return skillIds
    .map((id) => AVAILABLE_SKILLS.find((s) => s.id === id))
    .filter((s): s is SkillModuleDef => Boolean(s));
}

/**
 * Retrieves skill definition bound to a specific workstation (if any).
 */
export function getStationBoundSkill(stationId: string): SkillModuleDef | null {
  const stationBindings = loadStationSkillBindings();
  const skillId = stationBindings[stationId];
  if (!skillId) return null;
  return AVAILABLE_SKILLS.find((s) => s.id === skillId) || null;
}

/**
 * Agent-room operational trigger resolver:
 * Calculates the real-time operational status badge and bound tool list for an agent
 * based on their current room and interactive workstation.
 */
export function resolveAgentOperationalState(
  agentState: {
    room?: string;
    stationId?: string;
    isMoving?: boolean;
    statusTag?: string;
  },
  defaultRoomTag: string = 'IDLE'
): {
  operationalBadge: string;
  activeSkill: SkillModuleDef | null;
  boundTools: string[];
  systemPromptModifier: string;
} {
  if (!agentState || !agentState.room) {
    return {
      operationalBadge: defaultRoomTag,
      activeSkill: null,
      boundTools: [],
      systemPromptModifier: '',
    };
  }

  // If moving, keep the movement tag (e.g. TO WAR ROOM)
  if (agentState.isMoving) {
    return {
      operationalBadge: agentState.statusTag || 'MOVING',
      activeSkill: null,
      boundTools: [],
      systemPromptModifier: '',
    };
  }

  // 1. Check if the specific workstation has a bound skill
  if (agentState.stationId) {
    const stationSkill = getStationBoundSkill(agentState.stationId);
    if (stationSkill) {
      return {
        operationalBadge: `BOUND: ${stationSkill.shortCode}`,
        activeSkill: stationSkill,
        boundTools: stationSkill.providedTools,
        systemPromptModifier: stationSkill.systemPromptModifier,
      };
    }
  }

  // 2. Check if the room has bound skills
  const roomSkills = getRoomBoundSkills(agentState.room);
  if (roomSkills.length > 0) {
    const primarySkill = roomSkills[0];
    const allTools = Array.from(new Set(roomSkills.flatMap((s) => s.providedTools)));
    const combinedPrompt = roomSkills.map((s) => s.systemPromptModifier).join('\n');
    return {
      operationalBadge: `BOUND: ${primarySkill.shortCode}`,
      activeSkill: primarySkill,
      boundTools: allTools,
      systemPromptModifier: combinedPrompt,
    };
  }

  // 3. Fallback to workstation or room task tag
  return {
    operationalBadge: agentState.statusTag || defaultRoomTag,
    activeSkill: null,
    boundTools: [],
    systemPromptModifier: '',
  };
}

/**
 * Returns all active runtime tools for an agent in their current room and station.
 */
export function getAgentRuntimeTools(roomId: string, stationId?: string): string[] {
  const tools = new Set<string>();
  if (stationId) {
    const stSkill = getStationBoundSkill(stationId);
    if (stSkill) stSkill.providedTools.forEach((t) => tools.add(t));
  }
  const roomSkills = getRoomBoundSkills(roomId);
  for (const s of roomSkills) {
    s.providedTools.forEach((t) => tools.add(t));
  }
  return Array.from(tools);
}
