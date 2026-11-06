import type { RoomId } from '../components/SpriteCanvas';
import {
  loadStationSkillBindings,
  loadRoomSkillBindings,
  AVAILABLE_SKILLS,
} from '../engine/moduleRegistry';
import { getAllRoomStations } from '../engine/roomManager';

export interface RoomEquipmentAsset {
  stationId: string;
  name: string;
  room: RoomId;
  supportedTools: string[];
  isPowered: boolean;
  description: string;
}

const STORAGE_GEAR_KEY = 'pixelops_placed_gear_state_v1';

export const DEFAULT_ROOM_EQUIPMENT: Record<string, RoomEquipmentAsset> = {
  vault_core_rack: {
    stationId: 'vault_core_rack',
    name: 'Quantum Server Blades',
    room: 'server_vault',
    supportedTools: ['github_create_issue', 'vault_query_intel', 'osint_maritime_tracker'],
    isPowered: true,
    description: 'Encrypted blade server racks enabling repository engineering, core decryption, and live maritime AIS tracking.',
  },
  vault_laptop: {
    stationId: 'vault_laptop',
    name: 'Tactical Recon Laptop',
    room: 'server_vault',
    supportedTools: ['live_web_search', 'vault_query_intel'],
    isPowered: true,
    description: 'Secure field terminal for live web and dossier intelligence queries.',
  },
  war_center_desk: {
    stationId: 'war_center_desk',
    name: 'Tactical Command Holo-Desk',
    room: 'war_room',
    supportedTools: ['delegate_task_to_operative', 'osint_hazard_tracker'],
    isPowered: true,
    description: 'Primary strategic command desk with real-time USGS seismic feeds and global hazard telemetry overlays.',
  },
  comms_dish_console: {
    stationId: 'comms_dish_console',
    name: 'Deep-Space Satellite Dish',
    room: 'comms_tower',
    supportedTools: ['slack_post_dispatch', 'live_web_search', 'osint_spectrum_analyzer'],
    isPowered: true,
    description: 'High-gain transmission array for real-time broadcasts, spectrum surveillance, and space weather analysis.',
  },
  lib_front_desk: {
    stationId: 'lib_front_desk',
    name: 'Weather & Recon Lectern',
    room: 'library',
    supportedTools: ['weather_lookup', 'vault_query_intel', 'osint_satellite_recon'],
    isPowered: true,
    description: 'Atmospheric telemetry terminal and NASA GIBS / Copernicus satellite imagery reconnaissance desk.',
  },
  basement_omega_safe: {
    stationId: 'basement_omega_safe',
    name: 'Omega Vault Safe',
    room: 'archive_basement',
    supportedTools: ['vault_query_intel', 'github_create_issue'],
    isPowered: true,
    description: 'Subterranean security vault storing classified operational dossiers.',
  },
  lounge_holo_table: {
    stationId: 'lounge_holo_table',
    name: 'Briefing Hologram Table',
    room: 'briefing_lounge',
    supportedTools: ['calendar_schedule_event', 'slack_post_dispatch'],
    isPowered: true,
    description: 'Central tactical briefing table for scheduling field windows and briefings.',
  },
};

export function loadPlacedGearState(): Record<string, RoomEquipmentAsset> {
  try {
    const raw = localStorage.getItem(STORAGE_GEAR_KEY);
    if (!raw) return DEFAULT_ROOM_EQUIPMENT;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : DEFAULT_ROOM_EQUIPMENT;
  } catch {
    return DEFAULT_ROOM_EQUIPMENT;
  }
}

export function savePlacedGearState(state: Record<string, RoomEquipmentAsset>) {
  try {
    localStorage.setItem(STORAGE_GEAR_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

/**
 * Checks if a workstation supports a given tool and is powered on.
 * Dynamically recognizes:
 * 1. PlacedGear equipment configurations
 * 2. Workstation-specific skill bindings from the Module Registry
 * 3. Room-level skill bindings mounted by the user
 */
export function workstationSupportsTool(stationId: string, toolName: string): boolean {
  // 1. Check direct placed gear asset
  const gear = loadPlacedGearState();
  const asset = gear[stationId];
  if (asset && asset.isPowered && asset.supportedTools.includes(toolName)) {
    return true;
  }

  // 2. Check if workstation is specifically bound to a skill providing this tool
  try {
    const stationBindings = loadStationSkillBindings();
    const boundSkillId = stationBindings[stationId];
    if (boundSkillId) {
      const skill = AVAILABLE_SKILLS.find((s) => s.id === boundSkillId);
      if (skill && skill.providedTools.includes(toolName)) {
        return true;
      }
    }

    // 3. Check if the parent room of this workstation has the skill mounted
    const allStations = getAllRoomStations();
    let parentRoomId: string | null = null;
    for (const [rId, stations] of Object.entries(allStations)) {
      if (stations.some((st) => st.id === stationId)) {
        parentRoomId = rId;
        break;
      }
    }

    if (parentRoomId) {
      const roomBindings = loadRoomSkillBindings();
      const mountedSkillIds = roomBindings[parentRoomId] || [];
      for (const skillId of mountedSkillIds) {
        const skill = AVAILABLE_SKILLS.find((s) => s.id === skillId);
        if (skill && skill.providedTools.includes(toolName)) {
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('[GEAR CHECK] Error resolving dynamic skill support for tool:', err);
  }

  return false;
}

/**
 * Moves a physical workstation/gear asset to whichever room the user designates.
 */
export function moveEquipmentToRoom(stationId: string, targetRoom: RoomId): void {
  const gear = loadPlacedGearState();
  if (gear[stationId]) {
    gear[stationId].room = targetRoom;
    savePlacedGearState(gear);
  }
}

/**
 * Binds a specific tool capability to a piece of placed gear.
 */
export function bindToolToEquipment(stationId: string, toolName: string): void {
  const gear = loadPlacedGearState();
  if (gear[stationId]) {
    if (!gear[stationId].supportedTools.includes(toolName)) {
      gear[stationId].supportedTools.push(toolName);
      savePlacedGearState(gear);
    }
  }
}

/**
 * Unbinds a tool capability from a piece of placed gear.
 */
export function unbindToolFromEquipment(stationId: string, toolName: string): void {
  const gear = loadPlacedGearState();
  if (gear[stationId]) {
    gear[stationId].supportedTools = gear[stationId].supportedTools.filter((t) => t !== toolName);
    savePlacedGearState(gear);
  }
}

/**
 * Toggles equipment power state on or off.
 */
export function toggleEquipmentPower(stationId: string): boolean {
  const gear = loadPlacedGearState();
  if (gear[stationId]) {
    gear[stationId].isPowered = !gear[stationId].isPowered;
    savePlacedGearState(gear);
    return gear[stationId].isPowered;
  }
  return false;
}
