import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowRightLeft,
  UserPlus,
  Sparkles,
  Footprints,
  Radar,
  Maximize2,
  Minimize2,
  Compass,
  Layers,
} from 'lucide-react';
import { useTheme, AgentProfile, ThemeId } from '../context/ThemeContext';
import {
  useCrew,
  SpriteVariant,
  SPRITE_VARIANTS,
} from '../context/CrewContext';
import { GameOverlay } from './GameOverlay';
import { loadLiveAgentsSnapshot, saveLiveAgentsSnapshot } from '../services/AppStatePersistence';
import {
  getAllRooms,
  getAllRoomIds,
  getAllRoomStations,
  getAllRoomObstacles,
  subscribeRoomRegistry,
} from '../engine/roomManager';
import {
  resolveAgentOperationalState,
  getStationBoundSkill,
  getRoomBoundSkills,
  subscribeModuleRegistry,
} from '../engine/moduleRegistry';
import { RoomSpawnerModal } from './RoomSpawnerModal';

export type RoomId =
  | 'comms_tower'
  | 'war_room'
  | 'server_vault'
  | 'armory'
  | 'briefing_lounge'
  | 'library'
  | 'archive_basement'
  | (string & {});

export const ROOM_ORDER: RoomId[] = [
  'comms_tower',
  'war_room',
  'server_vault',
  'armory',
  'briefing_lounge',
  'library',
  'archive_basement',
];

export type StationPose = 'desk' | 'laptop' | 'stand' | 'work' | 'walk' | 'walking';
export type SpriteAnimationState = 'idle' | 'walking' | 'executing' | 'working';

export interface WorkstationDef {
  id: string;
  label: string;
  xPct: number; // Center X in room (0..100)
  yPct: number; // Top Y in room (0..100)
  corridorXPct: number; // Floor corridor waypoint X directly in front of station
  corridorYPct: number; // Floor corridor walkway Y (0..100)
  pose: StationPose;
  facing: 'left' | 'right';
  taskTag: string;
}

export interface WaypointNode {
  xPct: number;
  yPct: number;
  room: RoomId;
  label?: string;
}

// Coordinate-based Floor Corridor & Ambient Wander Waypoints per Sector (All on Walkable Isometric Floor Tiles)
export const ROOM_CORRIDOR_WAYPOINTS: Record<
  RoomId,
  Array<{ id: string; label: string; xPct: number; yPct: number }>
> = {
  comms_tower: [
    { id: 'wp_comms_west', label: 'Dish Array Console Floor', xPct: 37.0, yPct: 75.0 },
    { id: 'wp_comms_mid', label: 'Transceiver South Walkway', xPct: 45.0, yPct: 83.0 },
    { id: 'wp_comms_center', label: 'Radar Deck Floor', xPct: 54.0, yPct: 84.0 },
    { id: 'wp_comms_east', label: 'East Airlock Threshold', xPct: 68.0, yPct: 73.0 },
  ],
  war_room: [
    { id: 'wp_war_west', label: 'Recon Walkway', xPct: 36.0, yPct: 77.0 },
    { id: 'wp_war_center', label: 'Command Floor', xPct: 48.0, yPct: 84.0 },
    { id: 'wp_war_east', label: 'Mainframe Floor', xPct: 64.0, yPct: 77.0 },
    { id: 'wp_war_door', label: 'Blast Door Threshold', xPct: 48.0, yPct: 64.0 },
  ],
  server_vault: [
    { id: 'wp_vault_door', label: 'Vault Airlock Floor', xPct: 52.0, yPct: 63.0 },
    { id: 'wp_vault_west', label: 'Breaker Aisle', xPct: 38.0, yPct: 77.0 },
    { id: 'wp_vault_center', label: 'Core Catwalk Floor', xPct: 50.0, yPct: 83.0 },
    { id: 'wp_vault_east', label: 'Blade Aisle', xPct: 62.0, yPct: 77.0 },
  ],
  armory: [
    { id: 'wp_arm_west', label: 'Ballistic Locker Floor', xPct: 37.0, yPct: 76.0 },
    { id: 'wp_arm_locker', label: 'Gear Staging Grating', xPct: 43.0, yPct: 68.0 },
    { id: 'wp_arm_bench', label: 'Armory Center Grating', xPct: 50.0, yPct: 82.0 },
    { id: 'wp_arm_drone', label: 'Surveillance Floor', xPct: 62.0, yPct: 77.0 },
  ],
  briefing_lounge: [
    { id: 'wp_lng_west', label: 'Radio Desk Floor', xPct: 36.0, yPct: 76.0 },
    { id: 'wp_lng_center', label: 'Briefing Floorboard', xPct: 48.0, yPct: 85.0 },
    { id: 'wp_lng_east', label: 'Espresso Bar Floor', xPct: 64.0, yPct: 77.0 },
    { id: 'wp_lng_door', label: 'Vault Door Threshold', xPct: 42.0, yPct: 66.0 },
  ],
  library: [
    { id: 'wp_lib_door', label: 'Archive Entry', xPct: 48.0, yPct: 84.0 },
    { id: 'wp_lib_west', label: 'West Lectern Walkway', xPct: 37.0, yPct: 76.0 },
    { id: 'wp_lib_center', label: 'Reading Floor', xPct: 50.0, yPct: 80.0 },
    { id: 'wp_lib_east', label: 'East Stacks Walkway', xPct: 63.0, yPct: 76.0 },
  ],
  archive_basement: [
    { id: 'wp_base_entry', label: 'Sub-Level Hatch', xPct: 35.0, yPct: 74.0 },
    { id: 'wp_base_west', label: 'Workbench Floor', xPct: 38.0, yPct: 78.0 },
    { id: 'wp_base_center', label: 'Vault Floor Stones', xPct: 48.0, yPct: 81.0 },
    { id: 'wp_base_east', label: 'Cold Storage Floor', xPct: 61.0, yPct: 78.0 },
  ],
};

// Interactive Workstation Floor Positions (Positioned on walkable floor tiles immediately adjacent to furniture props)
export const ROOM_STATIONS: Record<RoomId, WorkstationDef[]> = {
  comms_tower: [
    {
      id: 'comms_dish_console',
      label: 'Dish Array Console',
      xPct: 38.5,
      yPct: 79.0,
      corridorXPct: 38.5,
      corridorYPct: 79.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'UPLINKING',
    },
    {
      id: 'comms_cipher_rig',
      label: 'Signal Transceiver',
      xPct: 48.0,
      yPct: 83.5,
      corridorXPct: 48.0,
      corridorYPct: 83.5,
      pose: 'laptop',
      facing: 'right',
      taskTag: 'DISPATCHING',
    },
    {
      id: 'comms_radar_scope',
      label: 'Blast Door Relay',
      xPct: 66.0,
      yPct: 74.5,
      corridorXPct: 66.0,
      corridorYPct: 74.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'SWEEPING',
    },
  ],
  war_room: [
    {
      id: 'war_left_desk',
      label: 'Recon Monitors',
      xPct: 37.0,
      yPct: 78.5,
      corridorXPct: 37.0,
      corridorYPct: 78.5,
      pose: 'desk',
      facing: 'left',
      taskTag: 'SCANNING',
    },
    {
      id: 'war_center_desk',
      label: 'Holo Globe Table',
      xPct: 48.0,
      yPct: 83.5,
      corridorXPct: 48.0,
      corridorYPct: 83.5,
      pose: 'desk',
      facing: 'right',
      taskTag: 'EXECUTING',
    },
    {
      id: 'war_server_rack',
      label: 'Mainframe Consoles',
      xPct: 63.5,
      yPct: 78.5,
      corridorXPct: 63.5,
      corridorYPct: 78.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'HACKING',
    },
    {
      id: 'war_aux_rack',
      label: 'Server Bank #4',
      xPct: 55.0,
      yPct: 67.5,
      corridorXPct: 55.0,
      corridorYPct: 67.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'DIAGNOSTICS',
    },
  ],
  server_vault: [
    {
      id: 'vault_laptop',
      label: 'Rack Terminal',
      xPct: 39.5,
      yPct: 67.5,
      corridorXPct: 39.5,
      corridorYPct: 67.5,
      pose: 'laptop',
      facing: 'left',
      taskTag: 'COMPILING',
    },
    {
      id: 'vault_core_rack',
      label: 'Cryo Core Column',
      xPct: 50.0,
      yPct: 81.5,
      corridorXPct: 50.0,
      corridorYPct: 81.5,
      pose: 'work',
      facing: 'right',
      taskTag: 'HACKING',
    },
    {
      id: 'vault_breakers',
      label: 'Power Relays',
      xPct: 38.5,
      yPct: 78.5,
      corridorXPct: 38.5,
      corridorYPct: 78.5,
      pose: 'stand',
      facing: 'left',
      taskTag: 'MONITORING',
    },
  ],
  armory: [
    {
      id: 'armory_gear_rack',
      label: 'Ballistic Rack',
      xPct: 37.5,
      yPct: 78.5,
      corridorXPct: 37.5,
      corridorYPct: 78.5,
      pose: 'stand',
      facing: 'left',
      taskTag: 'GEAR CHECK',
    },
    {
      id: 'armory_workbench',
      label: 'Vault Blast Door',
      xPct: 44.0,
      yPct: 66.0,
      corridorXPct: 44.0,
      corridorYPct: 66.0,
      pose: 'work',
      facing: 'left',
      taskTag: 'CALIBRATING',
    },
    {
      id: 'armory_drone_bay',
      label: 'Calibration Rig',
      xPct: 61.0,
      yPct: 80.0,
      corridorXPct: 61.0,
      corridorYPct: 80.0,
      pose: 'laptop',
      facing: 'right',
      taskTag: 'SURVEILLANCE',
    },
  ],
  briefing_lounge: [
    {
      id: 'lounge_coffee_bar',
      label: 'Espresso Station',
      xPct: 63.5,
      yPct: 78.0,
      corridorXPct: 63.5,
      corridorYPct: 78.0,
      pose: 'stand',
      facing: 'right',
      taskTag: 'COFFEE BREAK',
    },
    {
      id: 'lounge_holo_table',
      label: 'Comms & Map Desk',
      xPct: 36.5,
      yPct: 77.0,
      corridorXPct: 36.5,
      corridorYPct: 77.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'SCHEDULING',
    },
    {
      id: 'lounge_sofa',
      label: 'Chesterfield Sofa',
      xPct: 48.0,
      yPct: 85.0,
      corridorXPct: 48.0,
      corridorYPct: 85.0,
      pose: 'stand',
      facing: 'left',
      taskTag: 'STANDBY',
    },
  ],
  library: [
    {
      id: 'lib_front_desk',
      label: 'Archivist Desk',
      xPct: 50.0,
      yPct: 81.5,
      corridorXPct: 50.0,
      corridorYPct: 81.5,
      pose: 'desk',
      facing: 'left',
      taskTag: 'INDEXING',
    },
    {
      id: 'lib_east_stacks',
      label: 'East Book Stacks',
      xPct: 62.5,
      yPct: 77.0,
      corridorXPct: 62.5,
      corridorYPct: 77.0,
      pose: 'work',
      facing: 'right',
      taskTag: 'DECRYPTING',
    },
    {
      id: 'lib_west_stacks',
      label: 'Cipher Lectern',
      xPct: 38.0,
      yPct: 77.0,
      corridorXPct: 38.0,
      corridorYPct: 77.0,
      pose: 'stand',
      facing: 'left',
      taskTag: 'SEARCHING',
    },
  ],
  archive_basement: [
    {
      id: 'basement_microfiche',
      label: 'Microfiche Workbench',
      xPct: 38.0,
      yPct: 78.0,
      corridorXPct: 38.0,
      corridorYPct: 78.0,
      pose: 'desk',
      facing: 'left',
      taskTag: 'COLD ARCHIVE',
    },
    {
      id: 'basement_omega_safe',
      label: 'Omega Vault Door',
      xPct: 46.0,
      yPct: 65.0,
      corridorXPct: 46.0,
      corridorYPct: 65.0,
      pose: 'work',
      facing: 'left',
      taskTag: 'UNSEALING',
    },
    {
      id: 'basement_pneumatic',
      label: 'Cold Storage Crates',
      xPct: 59.0,
      yPct: 80.0,
      corridorXPct: 59.0,
      corridorYPct: 80.0,
      pose: 'stand',
      facing: 'right',
      taskTag: 'ROUTING',
    },
  ],
};

export interface RoomMetadataDef {
  id: RoomId;
  spyTitle: string;
  monsterTitle: string;
  vikingTitle: string;
  shortBadge: string;
  sectorCode: string;
  wingLabel: 'UPPER DECK' | 'LOWER DECK';
  gridCol: number; // 0..3
  gridRow: number; // 0..1
  neighbors: RoomId[];
  defaultAgentIndex: number;
  idleTag: string;
  activeTag: string;
  defaultBriefing: string;
  cleanBackdropUrl: string;
  backdropFilter: string;
  objectPosition?: string;
  doorX: number;
  doorY: number;
}

export const ROOM_METADATA: Record<RoomId, RoomMetadataDef> = {
  comms_tower: {
    id: 'comms_tower',
    spyTitle: 'Spy Safehouse · Comms Tower [W-01]',
    monsterTitle: 'Monster Lab · Radio Tower [W-01]',
    vikingTitle: 'Viking Longhall · Signal Beacon [W-01]',
    shortBadge: 'COMMS TOWER',
    sectorCode: 'SEC-A1',
    wingLabel: 'UPPER DECK',
    gridCol: 0,
    gridRow: 0,
    neighbors: ['war_room', 'briefing_lounge'],
    defaultAgentIndex: 1,
    idleTag: 'SIGNAL WATCH',
    activeTag: 'DISPATCHING',
    defaultBriefing:
      'Comms Tower dish array locked onto orbital relay. Shortwave and Slack frequencies clear.',
    cleanBackdropUrl: '/assets/rooms/comms_tower_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 68.0,
    doorY: 73.0,
  },
  war_room: {
    id: 'war_room',
    spyTitle: 'Spy Safehouse · War Room [C-01]',
    monsterTitle: 'Monster Lab · Command Deck [C-01]',
    vikingTitle: 'Viking Longhall · War Table [C-01]',
    shortBadge: 'WAR ROOM',
    sectorCode: 'SEC-B1',
    wingLabel: 'UPPER DECK',
    gridCol: 1,
    gridRow: 0,
    neighbors: ['comms_tower', 'server_vault', 'library'],
    defaultAgentIndex: 0,
    idleTag: 'IDLE',
    activeTag: 'EXECUTING',
    defaultBriefing:
      'Target acquired. Scanning web nodes for flight data... [2/3] Parsing JSON.',
    cleanBackdropUrl: '/assets/rooms/war_room_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 64.0,
  },
  server_vault: {
    id: 'server_vault',
    spyTitle: 'Spy Safehouse · Server Vault [E-01]',
    monsterTitle: 'Monster Lab · Mainframe Vault [E-01]',
    vikingTitle: 'Viking Longhall · Rune Vault [E-01]',
    shortBadge: 'SERVER VAULT',
    sectorCode: 'SEC-C1',
    wingLabel: 'UPPER DECK',
    gridCol: 2,
    gridRow: 0,
    neighbors: ['war_room', 'armory', 'archive_basement'],
    defaultAgentIndex: 1,
    idleTag: 'IDLE',
    activeTag: 'HACKING',
    defaultBriefing:
      'Mainframe link established. Routing encrypted packets through Server Vault nodes.',
    cleanBackdropUrl: '/assets/rooms/server_vault_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 52.0,
    doorY: 63.0,
  },
  armory: {
    id: 'armory',
    spyTitle: 'Spy Safehouse · Tactical Armory [E-02]',
    monsterTitle: 'Monster Lab · Battle Gear Bay [E-02]',
    vikingTitle: 'Viking Longhall · Weapon Forge [E-02]',
    shortBadge: 'ARMORY',
    sectorCode: 'SEC-D1',
    wingLabel: 'UPPER DECK',
    gridCol: 3,
    gridRow: 0,
    neighbors: ['server_vault', 'archive_basement'],
    defaultAgentIndex: 0,
    idleTag: 'GEAR CHECK',
    activeTag: 'CALIBRATING',
    defaultBriefing:
      'Tactical Armory online. Ballistic vests, field drones, and bypass rigs calibrated.',
    cleanBackdropUrl: '/assets/rooms/armory_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 43.0,
    doorY: 67.0,
  },
  briefing_lounge: {
    id: 'briefing_lounge',
    spyTitle: 'Spy Safehouse · Briefing Lounge [W-02]',
    monsterTitle: 'Monster Lab · Trainer Lounge [W-02]',
    vikingTitle: 'Viking Longhall · Mead Hearth [W-02]',
    shortBadge: 'LOUNGE',
    sectorCode: 'SEC-A2',
    wingLabel: 'LOWER DECK',
    gridCol: 0,
    gridRow: 1,
    neighbors: ['comms_tower', 'library'],
    defaultAgentIndex: 0,
    idleTag: 'COFFEE BREAK',
    activeTag: 'SCHEDULING',
    defaultBriefing:
      'Briefing Lounge quiet. Espresso machine steaming; operatives reviewing calendar schedules.',
    cleanBackdropUrl: '/assets/rooms/briefing_lounge_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 42.0,
    doorY: 66.0,
  },
  library: {
    id: 'library',
    spyTitle: 'Spy Safehouse · Intel Library [C-02]',
    monsterTitle: 'Monster Lab · Archive Library [C-02]',
    vikingTitle: 'Viking Longhall · Saga Library [C-02]',
    shortBadge: 'LIBRARY',
    sectorCode: 'SEC-B2',
    wingLabel: 'LOWER DECK',
    gridCol: 1,
    gridRow: 1,
    neighbors: ['briefing_lounge', 'war_room', 'archive_basement'],
    defaultAgentIndex: 2,
    idleTag: 'IDLE',
    activeTag: 'DECRYPTING',
    defaultBriefing:
      'Front desk duty. All systems nominal. Monitoring library archives.',
    cleanBackdropUrl: '/assets/rooms/library_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 48.0,
    doorY: 84.0,
  },
  archive_basement: {
    id: 'archive_basement',
    spyTitle: 'Spy Safehouse · Archive Basement [E-03]',
    monsterTitle: 'Monster Lab · Deep Laboratory [E-03]',
    vikingTitle: 'Viking Longhall · Runic Crypt [E-03]',
    shortBadge: 'BASEMENT',
    sectorCode: 'SEC-C2',
    wingLabel: 'LOWER DECK',
    gridCol: 2,
    gridRow: 1,
    neighbors: ['library', 'server_vault', 'armory'],
    defaultAgentIndex: 2,
    idleTag: 'COLD STORAGE',
    activeTag: 'UNSEALING',
    defaultBriefing:
      'Sub-level Archive Basement sealed at Omega clearance. Microfiche & cold dossiers verified.',
    cleanBackdropUrl: '/assets/rooms/archive_basement_clean.png',
    backdropFilter: 'none',
    objectPosition: 'center center',
    doorX: 46.0,
    doorY: 64.0,
  },
};

export interface ObstacleBox {
  id: string;
  label: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  isCentralStructure?: boolean;
}

export const AGENT_CLEARANCE_X = 2.4; // Horizontal clearance margin (~19-20px)
export const AGENT_CLEARANCE_Y = 1.8; // Vertical clearance margin (~14-16px)
export const CENTRAL_EXTRA_CLEARANCE_X = 0.8; // Additional clearance buffer for central structures (~6px)
export const CENTRAL_EXTRA_CLEARANCE_Y = 0.6; // Additional clearance buffer for central structures (~5px)
export const SAFE_PERIMETER_OFFSET = 3.2; // Safe stopping perimeter offset (16-32px away from structure edge)

/**
 * Static Furniture & Structural Prop Collision Bounding Boxes per Sector.
 * Defines explicit blocking bounding boxes for central room structures (War Room Holo-Table,
 * Server Vault Cryo Core, Armory Weapon Consoles, Lounge Sofas, etc.) and wall assets.
 */
export const ROOM_OBSTACLES: Record<RoomId, ObstacleBox[]> = {
  comms_tower: [
    { id: 'obs_comms_west_desk', label: 'Dish Array Console', xMin: 24.0, xMax: 35.5, yMin: 66.0, yMax: 78.0 },
    { id: 'obs_comms_transceiver', label: 'Central Signal Transceiver & Terminal', xMin: 43.0, xMax: 57.0, yMin: 67.0, yMax: 79.0, isCentralStructure: true },
  ],
  war_room: [
    { id: 'obs_war_holo_table', label: 'Central Holo-Globe Command Table', xMin: 43.0, xMax: 57.0, yMin: 70.0, yMax: 79.5, isCentralStructure: true },
    { id: 'obs_war_west_desk', label: 'West Recon Desk', xMin: 24.0, xMax: 33.5, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_war_east_rack', label: 'East Mainframe Rack', xMin: 66.5, xMax: 76.0, yMin: 68.0, yMax: 79.0 },
  ],
  server_vault: [
    { id: 'obs_vault_cryo_core', label: 'Central Cryo Core Column & Server Racks', xMin: 44.0, xMax: 56.0, yMin: 67.0, yMax: 77.0, isCentralStructure: true },
    { id: 'obs_vault_west_breakers', label: 'West Power Relays', xMin: 24.0, xMax: 35.5, yMin: 66.0, yMax: 78.0 },
    { id: 'obs_vault_east_blades', label: 'East Server Blades', xMin: 64.0, xMax: 76.0, yMin: 66.0, yMax: 78.0 },
  ],
  armory: [
    { id: 'obs_arm_central_rack', label: 'Central Weapon Console & Inspection Bench', xMin: 43.0, xMax: 57.0, yMin: 69.0, yMax: 78.5, isCentralStructure: true },
    { id: 'obs_arm_west_lockers', label: 'West Ballistic Lockers', xMin: 24.0, xMax: 34.5, yMin: 68.0, yMax: 80.0 },
    { id: 'obs_arm_east_rig', label: 'East Calibration Rig & Crates', xMin: 64.0, xMax: 76.0, yMin: 70.0, yMax: 81.0 },
  ],
  briefing_lounge: [
    { id: 'obs_lng_sofa', label: 'Central Chesterfield Sofa & Coffee Table', xMin: 42.0, xMax: 58.0, yMin: 71.0, yMax: 81.5, isCentralStructure: true },
    { id: 'obs_lng_west_desk', label: 'West Comms & Map Desk', xMin: 24.0, xMax: 33.5, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_lng_east_bar', label: 'East Espresso Bar', xMin: 66.0, xMax: 76.0, yMin: 68.0, yMax: 79.0 },
  ],
  library: [
    { id: 'obs_lib_archivist_desk', label: 'Central Archivist Desk & Reading Table', xMin: 43.0, xMax: 57.0, yMin: 68.0, yMax: 77.5, isCentralStructure: true },
    { id: 'obs_lib_west_stacks', label: 'West Book Stacks', xMin: 24.0, xMax: 35.0, yMin: 65.0, yMax: 77.0 },
    { id: 'obs_lib_east_stacks', label: 'East Book Stacks', xMin: 65.5, xMax: 76.0, yMin: 65.0, yMax: 77.0 },
  ],
  archive_basement: [
    { id: 'obs_base_central_generator', label: 'Central Power Generator & Sub-Level Core', xMin: 43.0, xMax: 57.0, yMin: 68.0, yMax: 77.5, isCentralStructure: true },
    { id: 'obs_base_west_bench', label: 'Microfiche Workbench', xMin: 24.0, xMax: 35.0, yMin: 68.0, yMax: 79.0 },
    { id: 'obs_base_east_crates', label: 'Cold Storage Crates', xMin: 62.0, xMax: 76.0, yMin: 70.0, yMax: 82.0 },
  ],
};

export function getRoomMeta(roomId: RoomId): RoomMetadataDef {
  const all = getAllRooms();
  return all[roomId] || ROOM_METADATA[roomId] || ROOM_METADATA.war_room;
}

export function getRoomObs(roomId: RoomId): ObstacleBox[] {
  const all = getAllRoomObstacles();
  return all[roomId] || ROOM_OBSTACLES[roomId] || [];
}

export function getRoomStns(roomId: RoomId): WorkstationDef[] {
  const all = getAllRoomStations();
  return all[roomId] || ROOM_STATIONS[roomId] || ROOM_STATIONS.war_room;
}

/**
 * Checks whether a coordinate `(x, y)` lies strictly inside the 2:1 isometric
 * floor diamond of the cutaway box-room, respecting back perimeter walls and front cutaway edges.
 */
export function isInsideIsometricFloor(_room: RoomId, x: number, y: number): boolean {
  if (x < 28 || x > 72) return false;
  const distFromCenter = Math.abs(x - 50);
  // Angled back-left and back-right walls slope downward at ~0.46 Y per X unit from (50, 61.5)
  const yMinWall = 61.5 + distFromCenter * 0.46;
  // Front-left and front-right cutaway floor edges slope upward at ~0.46 Y per X unit from (50, 88.5)
  const yMaxFloor = 88.5 - distFromCenter * 0.46;
  return y >= yMinWall && y <= yMaxFloor;
}

/**
 * Checks whether `(x, y)` collides with any static furniture/prop bounding box in `room`,
 * taking into account horizontal and vertical agent clearance exclusion zones.
 */
export function isCollidingWithObstacle(
  room: RoomId,
  x: number,
  y: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  const obstacles = getRoomObs(room);
  for (const box of obstacles) {
    const isCentral = box.isCentralStructure;
    const padX = clearanceX + (isCentral ? CENTRAL_EXTRA_CLEARANCE_X : 0);
    const padY = clearanceY + (isCentral ? CENTRAL_EXTRA_CLEARANCE_Y : 0);
    if (
      x >= box.xMin - padX &&
      x <= box.xMax + padX &&
      y >= box.yMin - padY &&
      y <= box.yMax + padY
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `(x, y)` is both strictly inside the isometric room floor diamond
 * AND free of static furniture / central structure collisions within exclusion clearances.
 */
export function isWalkablePoint(
  room: RoomId,
  x: number,
  y: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  return (
    isInsideIsometricFloor(room, x, y) &&
    !isCollidingWithObstacle(room, x, y, clearanceX, clearanceY)
  );
}

/**
 * Calculates Euclidean distance from point (x, y) to the nearest central structure's bounding box.
 * Used for soft node-weighting so pathfinding naturally curves around central tables.
 */
export function distanceToCentralStructure(room: RoomId, x: number, y: number): number {
  const obstacles = getRoomObs(room);
  let minDist = Infinity;
  for (const box of obstacles) {
    if (!box.isCentralStructure) continue;
    const dx = Math.max(box.xMin - x, 0, x - box.xMax);
    const dy = Math.max(box.yMin - y, 0, y - box.yMax);
    const d = Math.hypot(dx, dy);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Ensures agents stop at a safe interaction perimeter (16-32 pixels away from the edge of the structure)
 * rather than snapping directly onto or inside the asset.
 */
export function snapToSafeInteractionPerimeter(
  room: RoomId,
  x: number,
  y: number
): { xPct: number; yPct: number } {
  const obstacles = getRoomObs(room);
  for (const box of obstacles) {
    const padX = AGENT_CLEARANCE_X + (box.isCentralStructure ? CENTRAL_EXTRA_CLEARANCE_X : 0);
    const padY = AGENT_CLEARANCE_Y + (box.isCentralStructure ? CENTRAL_EXTRA_CLEARANCE_Y : 0);
    if (
      x >= box.xMin - padX &&
      x <= box.xMax + padX &&
      y >= box.yMin - padY &&
      y <= box.yMax + padY
    ) {
      const candidates = [
        { x: x, y: box.yMax + SAFE_PERIMETER_OFFSET }, // South perimeter (facing North)
        { x: x, y: box.yMin - SAFE_PERIMETER_OFFSET }, // North perimeter (facing South)
        { x: box.xMin - SAFE_PERIMETER_OFFSET, y: y }, // West perimeter (facing East)
        { x: box.xMax + SAFE_PERIMETER_OFFSET, y: y }, // East perimeter (facing West)
      ];
      let best = candidates[0];
      let bestDist = Infinity;
      for (const cand of candidates) {
        if (
          isInsideIsometricFloor(room, cand.x, cand.y) &&
          !isCollidingWithObstacle(room, cand.x, cand.y)
        ) {
          const d = Math.hypot(cand.x - x, cand.y - y);
          if (d < bestDist) {
            bestDist = d;
            best = cand;
          }
        }
      }
      return { xPct: Number(best.x.toFixed(2)), yPct: Number(best.y.toFixed(2)) };
    }
  }
  return { xPct: Number(x.toFixed(2)), yPct: Number(y.toFixed(2)) };
}

/**
 * Snaps any arbitrary `(x, y)` coordinate to the nearest valid walkable isometric floor position
 * so agents never stand inside walls, outside cutaway edges, or on top of furniture props.
 */
export function snapToWalkableFloor(
  room: RoomId,
  x: number,
  y: number
): { xPct: number; yPct: number } {
  const safePerimeter = snapToSafeInteractionPerimeter(room, x, y);
  if (isWalkablePoint(room, safePerimeter.xPct, safePerimeter.yPct)) {
    return safePerimeter;
  }

  let bestX = 48.0;
  let bestY = 83.0;
  let bestDist = Infinity;

  for (let gx = 30; gx <= 70; gx += 1.0) {
    for (let gy = 62; gy <= 87; gy += 1.0) {
      if (isWalkablePoint(room, gx, gy)) {
        const d = Math.hypot(gx - x, gy - y);
        if (d < bestDist) {
          bestDist = d;
          bestX = gx;
          bestY = gy;
        }
      }
    }
  }

  return { xPct: Number(bestX.toFixed(2)), yPct: Number(bestY.toFixed(2)) };
}

/**
 * Checks if the straight segment from `(x1, y1)` to `(x2, y2)` stays completely inside
 * the walkable isometric floor and never clips through any furniture or central structure exclusion zone.
 */
function isLineOfSightWalkable(
  room: RoomId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  clearanceX: number = AGENT_CLEARANCE_X,
  clearanceY: number = AGENT_CLEARANCE_Y
): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(4, Math.ceil(dist / 1.6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ix = x1 + (x2 - x1) * t;
    const iy = y1 + (y2 - y1) * t;
    if (!isWalkablePoint(room, ix, iy, clearanceX, clearanceY)) {
      return false;
    }
  }
  return true;
}

/**
 * Geometric line-segment vs 2D axis-aligned bounding box collision test.
 * Used by vector waypoint flushing to detect whether a straight trajectory cuts across a central structure.
 */
function lineSegmentIntersectsBox(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  box: ObstacleBox,
  padX: number = AGENT_CLEARANCE_X,
  padY: number = AGENT_CLEARANCE_Y
): boolean {
  const minX = box.xMin - padX;
  const maxX = box.xMax + padX;
  const minY = box.yMin - padY;
  const maxY = box.yMax + padY;

  // Segment bounding box reject test
  if (
    Math.max(p1.x, p2.x) < minX ||
    Math.min(p1.x, p2.x) > maxX ||
    Math.max(p1.y, p2.y) < minY ||
    Math.min(p1.y, p2.y) > maxY
  ) {
    return false;
  }

  // Point inside box test
  if (
    (p1.x >= minX && p1.x <= maxX && p1.y >= minY && p1.y <= maxY) ||
    (p2.x >= minX && p2.x <= maxX && p2.y >= minY && p2.y <= maxY)
  ) {
    return true;
  }

  const edges = [
    { a: { x: minX, y: minY }, b: { x: maxX, y: minY } },
    { a: { x: maxX, y: minY }, b: { x: maxX, y: maxY } },
    { a: { x: maxX, y: maxY }, b: { x: minX, y: maxY } },
    { a: { x: minX, y: maxY }, b: { x: minX, y: minY } },
  ];

  function ccw(A: { x: number; y: number }, B: { x: number; y: number }, C: { x: number; y: number }) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }
  function intersect(
    A: { x: number; y: number },
    B: { x: number; y: number },
    C: { x: number; y: number },
    D: { x: number; y: number }
  ) {
    return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
  }

  for (const edge of edges) {
    if (intersect(p1, p2, edge.a, edge.b)) return true;
  }
  return false;
}

/**
 * Vector Waypoint Flushing (Avoidance Routing):
 * Scans path segments and dynamically injects intermediate curved offset nodes if any trajectory
 * cuts through a central structure's bounding box.
 */
function injectCentralStructureAvoidanceWaypoints(
  room: RoomId,
  rawPoints: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  const obstacles = getRoomObs(room);
  const centralBox = obstacles.find((b) => b.isCentralStructure);
  if (!centralBox || rawPoints.length < 2) return rawPoints;

  const result: Array<{ x: number; y: number }> = [rawPoints[0]];
  for (let i = 0; i < rawPoints.length - 1; i++) {
    const p1 = rawPoints[i];
    const p2 = rawPoints[i + 1];

    if (lineSegmentIntersectsBox(p1, p2, centralBox)) {
      const padX = AGENT_CLEARANCE_X + CENTRAL_EXTRA_CLEARANCE_X + 1.0;
      const padY = AGENT_CLEARANCE_Y + CENTRAL_EXTRA_CLEARANCE_Y + 0.8;

      const nw = { x: centralBox.xMin - padX, y: centralBox.yMin - padY };
      const ne = { x: centralBox.xMax + padX, y: centralBox.yMin - padY };
      const sw = { x: centralBox.xMin - padX, y: centralBox.yMax + padY };
      const se = { x: centralBox.xMax + padX, y: centralBox.yMax + padY };

      const westArc = [nw, sw].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const eastArc = [ne, se].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const northArc = [nw, ne].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );
      const southArc = [sw, se].filter(
        (p) => isInsideIsometricFloor(room, p.x, p.y) && !isCollidingWithObstacle(room, p.x, p.y)
      );

      const candidates = [westArc, eastArc, northArc, southArc].filter((arc) => arc.length > 0);
      let bestArc = westArc;
      let bestArcDist = Infinity;

      for (const arc of candidates) {
        let total = Math.hypot(arc[0].x - p1.x, arc[0].y - p1.y);
        for (let j = 0; j < arc.length - 1; j++) {
          total += Math.hypot(arc[j + 1].x - arc[j].x, arc[j + 1].y - arc[j].y);
        }
        total += Math.hypot(p2.x - arc[arc.length - 1].x, p2.y - arc[arc.length - 1].y);
        if (total < bestArcDist) {
          bestArcDist = total;
          bestArc = arc;
        }
      }

      if (bestArc && bestArc.length > 0) {
        result.push(...bestArc);
      }
    }
    result.push(p2);
  }
  return result;
}

/**
 * Computes an A* obstacle-avoiding & wall-respecting waypoint path within a single isometric room
 * from `(startX, startY)` to `(endX, endY)`, utilizing high-resolution grid pathfinding,
 * proximity node-weighting, vector waypoint flushing, and clearance-preserving string pulling.
 */
function buildSingleRoomWaypoints(
  room: RoomId,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  endLabel?: string
): WaypointNode[] {
  const safeStart = snapToWalkableFloor(room, startX, startY);
  const safeEnd = snapToWalkableFloor(room, endX, endY);

  if (Math.hypot(safeEnd.xPct - safeStart.xPct, safeEnd.yPct - safeStart.yPct) < 1.0) {
    return [
      {
        xPct: safeEnd.xPct,
        yPct: safeEnd.yPct,
        room,
        label: endLabel || 'Target Station',
      },
    ];
  }

  // Fast path if line of sight is completely clear of walls, furniture, and central structures
  if (
    isLineOfSightWalkable(
      room,
      safeStart.xPct,
      safeStart.yPct,
      safeEnd.xPct,
      safeEnd.yPct
    )
  ) {
    return [
      {
        xPct: safeEnd.xPct,
        yPct: safeEnd.yPct,
        room,
        label: endLabel || 'Target Station',
      },
    ];
  }

  // High-resolution 1.25% 8-directional A* navigation grid over the isometric floor
  const STEP = 1.25;
  const toKey = (gx: number, gy: number) => `${gx.toFixed(1)},${gy.toFixed(1)}`;
  const snapGrid = (val: number) => Math.round(val / STEP) * STEP;

  const startGX = snapGrid(safeStart.xPct);
  const startGY = snapGrid(safeStart.yPct);
  const endGX = snapGrid(safeEnd.xPct);
  const endGY = snapGrid(safeEnd.yPct);

  interface AStarNode {
    gx: number;
    gy: number;
    g: number;
    f: number;
    parent: AStarNode | null;
  }

  const open: AStarNode[] = [
    {
      gx: startGX,
      gy: startGY,
      g: 0,
      f: Math.hypot(endGX - startGX, endGY - startGY),
      parent: null,
    },
  ];
  const bestG = new Map<string, number>();
  bestG.set(toKey(startGX, startGY), 0);

  const dirs = [
    [STEP, 0],
    [-STEP, 0],
    [0, STEP],
    [0, -STEP],
    [STEP, STEP],
    [STEP, -STEP],
    [-STEP, STEP],
    [-STEP, -STEP],
  ];

  let foundGoal: AStarNode | null = null;
  let closestNode: AStarNode = open[0];
  let closestDist = Math.hypot(endGX - startGX, endGY - startGY);
  let iterations = 0;

  while (open.length > 0 && iterations < 350) {
    iterations++;
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    const distToGoal = Math.hypot(endGX - current.gx, endGY - current.gy);
    if (distToGoal < closestDist) {
      closestDist = distToGoal;
      closestNode = current;
    }

    if (distToGoal <= STEP * 1.2) {
      foundGoal = current;
      break;
    }

    for (const [dx, dy] of dirs) {
      const nx = current.gx + dx;
      const ny = current.gy + dy;

      const isGoalTile = Math.hypot(endGX - nx, endGY - ny) <= STEP;
      if (!isGoalTile && !isWalkablePoint(room, nx, ny)) continue;

      // Prevent diagonal corner cutting across furniture or walls
      if (dx !== 0 && dy !== 0) {
        if (
          !isWalkablePoint(room, current.gx + dx, current.gy) ||
          !isWalkablePoint(room, current.gx, current.gy + dy)
        ) {
          continue;
        }
      }

      // Proximity node weighting: soft cost penalty for walking directly against central structures
      const distToCentral = distanceToCentralStructure(room, nx, ny);
      const proximityPenalty = distToCentral < 5.0 ? (5.0 - distToCentral) * 2.8 : 0;

      const stepCost = Math.hypot(dx, dy) + proximityPenalty;
      const tentativeG = current.g + stepCost;
      const key = toKey(nx, ny);
      if (tentativeG < (bestG.get(key) ?? Infinity)) {
        bestG.set(key, tentativeG);
        open.push({
          gx: nx,
          gy: ny,
          g: tentativeG,
          f: tentativeG + Math.hypot(endGX - nx, endGY - ny),
          parent: current,
        });
      }
    }
  }

  const rawPoints: Array<{ x: number; y: number }> = [];
  let trace: AStarNode | null = foundGoal || closestNode;
  while (trace) {
    rawPoints.unshift({ x: trace.gx, y: trace.gy });
    trace = trace.parent;
  }
  rawPoints.push({ x: safeEnd.xPct, y: safeEnd.yPct });

  // Vector waypoint flushing: inject intermediate clearance nodes if any segment clips the central structure
  const flushed = injectCentralStructureAvoidanceWaypoints(room, rawPoints);

  // String-pulling path smoothing: collapse collinear/visible waypoints while strictly preserving obstacle clearance
  const smoothed: Array<{ x: number; y: number }> = [flushed[0]];
  let anchorIdx = 0;
  while (anchorIdx < flushed.length - 1) {
    let nextIdx = anchorIdx + 1;
    for (let probe = flushed.length - 1; probe > anchorIdx + 1; probe--) {
      if (
        isLineOfSightWalkable(
          room,
          flushed[anchorIdx].x,
          flushed[anchorIdx].y,
          flushed[probe].x,
          flushed[probe].y
        )
      ) {
        nextIdx = probe;
        break;
      }
    }
    smoothed.push(flushed[nextIdx]);
    anchorIdx = nextIdx;
  }

  const waypoints: WaypointNode[] = smoothed.slice(1).map((pt, idx, arr) => ({
    xPct: Number(pt.x.toFixed(2)),
    yPct: Number(pt.y.toFixed(2)),
    room,
    label: idx === arr.length - 1 ? endLabel || 'Target Station' : 'Floor Route',
  }));

  if (waypoints.length === 0) {
    waypoints.push({
      xPct: safeEnd.xPct,
      yPct: safeEnd.yPct,
      room,
      label: endLabel || 'Target Station',
    });
  }

  return waypoints;
}

/**
 * Finds a shortest sector-to-sector path across the 7-sector overworld graph
 * so agents visibly traverse intermediate corridors/lifts when moving across the facility.
 */
function findSectorRoute(fromRoom: RoomId, toRoom: RoomId): RoomId[] {
  if (fromRoom === toRoom) return [fromRoom];
  const queue: RoomId[][] = [[fromRoom]];
  const visited = new Set<RoomId>([fromRoom]);
  let iters = 0;

  while (queue.length > 0 && iters++ < 50) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    const neighbors = getRoomMeta(current)?.neighbors || [];
    for (const next of neighbors) {
      if (next === toRoom) {
        return [...path, next];
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return [fromRoom, toRoom];
}

/**
 * Computes a complete autonomous waypoint path from an agent's current position/sector
 * to the target workstation in `destRoom` across the multi-wing overworld.
 */
export function buildAgentWaypointPath(
  fromRoom: RoomId,
  startX: number,
  startY: number,
  destRoom: RoomId,
  destStation: WorkstationDef
): WaypointNode[] {
  const targetX = destStation.corridorXPct ?? destStation.xPct;
  const targetY = destStation.corridorYPct ?? destStation.yPct;

  if (fromRoom === destRoom) {
    return buildSingleRoomWaypoints(
      fromRoom,
      startX,
      startY,
      targetX,
      targetY,
      destStation.label
    );
  }

  const sectorRoute = findSectorRoute(fromRoom, destRoom);
  const fullNodes: WaypointNode[] = [];

  // 1. Walk to exit door/lift of starting room
  const exitMeta = getRoomMeta(fromRoom);
  fullNodes.push(
    ...buildSingleRoomWaypoints(
      fromRoom,
      startX,
      startY,
      exitMeta.doorX,
      exitMeta.doorY,
      `${exitMeta.shortBadge} Transit`
    )
  );

  // 2. If traversing an intermediate corridor sector, route cleanly across its walkable floor diamond
  for (let i = 1; i < sectorRoute.length - 1; i++) {
    const midRoom = sectorRoute[i];
    const midMeta = getRoomMeta(midRoom);
    const transitPath = buildSingleRoomWaypoints(
      midRoom,
      36.0,
      76.0,
      64.0,
      76.0,
      `${midMeta.shortBadge} Transit`
    );
    fullNodes.push({
      xPct: 36.0,
      yPct: 76.0,
      room: midRoom,
      label: `${midMeta.shortBadge} West Walkway`,
    });
    fullNodes.push(...transitPath);
  }

  // 3. Spawn at destination sector threshold and walk along its corridor to target workstation
  const entryMeta = getRoomMeta(destRoom);
  const safeEntry = snapToWalkableFloor(destRoom, entryMeta.doorX, entryMeta.doorY);
  fullNodes.push({
    xPct: safeEntry.xPct,
    yPct: safeEntry.yPct,
    room: destRoom,
    label: `${entryMeta.shortBadge} Entry`,
  });

  fullNodes.push(
    ...buildSingleRoomWaypoints(
      destRoom,
      safeEntry.xPct,
      safeEntry.yPct,
      targetX,
      targetY,
      destStation.label
    )
  );

  return fullNodes;
}

export interface LiveAgentState {
  agentIndex: number; // 0 = Vance, 1 = Nyx, 2 = Cipher, 3+ = Recruited Operatives
  room: RoomId;
  stationId: string;
  xPct: number;
  yPct: number;
  targetXPct: number;
  targetYPct: number;
  targetRoom: RoomId;
  targetStationId: string;
  pose: StationPose;
  facing: 'left' | 'right';
  statusTag: string;
  isMoving: boolean;
  phase: 'at_station' | 'walking_to_door' | 'walking_to_station';
  waypoints?: WaypointNode[];
}

/**
 * Reusable Pixel-Art Sprite Renderer that accepts `spriteVariant` and `spriteState` props
 * and uses a 4-phase sprite walking cycle (`walk_1` -> `stand` -> `walk_2` -> `stand`) when moving.
 */
export const AgentSpriteFigure: React.FC<{
  spriteVariant: SpriteVariant;
  pose: StationPose;
  walkFrame: 0 | 1 | 2 | 3;
  facing: 'left' | 'right';
  isMoving?: boolean;
  isWalkingTransition?: boolean;
  spriteState?: SpriteAnimationState;
  isExecuting?: boolean;
  themeId?: ThemeId;
  alt: string;
  className?: string;
}> = ({
  spriteVariant,
  pose,
  walkFrame,
  facing,
  isMoving = false,
  isWalkingTransition = false,
  spriteState,
  isExecuting = false,
  themeId = 'green',
  alt,
  className = '',
}) => {
  const variantMeta = SPRITE_VARIANTS[spriteVariant] || SPRITE_VARIANTS.trenchcoat;
  const family = variantMeta.baseSpriteFamily;

  const isWalkingState =
    spriteState === 'walking' ||
    isWalkingTransition ||
    isMoving ||
    pose === 'walk' ||
    pose === 'walking';

  const resolvedSpriteState: SpriteAnimationState = isWalkingState
    ? 'walking'
    : isExecuting || spriteState === 'executing'
    ? 'executing'
    : pose === 'work' || pose === 'laptop' || spriteState === 'working'
    ? 'working'
    : 'idle';

  // 4-step walking stride cycle: 0 -> walk_1 (left stride), 1 -> stand (pass), 2 -> walk_2 (right stride), 3 -> stand (pass)
  const resolveWalkCycleUrl = (fam: string): string => {
    if (walkFrame === 0) return `/assets/agents/${fam}_walk_1.png`;
    if (walkFrame === 2) return `/assets/agents/${fam}_walk_2.png`;
    return `/assets/agents/${fam}_stand.png`;
  };

  const resolveSpriteUrl = (): string => {
    if (family === 'safecracker') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('safecracker');
      }
      if (pose === 'work' || pose === 'laptop' || isExecuting) {
        return '/assets/agents/safecracker_work.png';
      }
      return '/assets/agents/safecracker_stand.png';
    }

    if (family === 'exo_hacker') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('exo_hacker');
      }
      if (pose === 'work' || pose === 'laptop' || isExecuting) {
        return '/assets/agents/exo_hacker_work.png';
      }
      return '/assets/agents/exo_hacker_stand.png';
    }

    if (family === 'tactical_tech_ops') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('tactical_tech_ops');
      }
      if (pose === 'work' || pose === 'laptop' || isExecuting) {
        return '/assets/agents/tactical_tech_ops_work.png';
      }
      return '/assets/agents/tactical_tech_ops_stand.png';
    }

    const customFamilies = new Set([
      'archivist_crimson',
      'undercover_field',
      'comms_ops',
      'cyber_security',
      'intel_analyst',
      'undercover_infiltration',
      'sleeper_agent',
      'heavy_sniper',
      'crimson_grapple',
      'hazmat_cloak',
      'ghillie_sniper',
      'recon_grey',
      'recon_blue',
      'recon_brown',
    ]);

    if (customFamilies.has(family)) {
      if (isWalkingState) {
        return resolveWalkCycleUrl(family);
      }
      return `/assets/agents/${family}_stand.png`;
    }

    if (family === 'nyx') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('nyx');
      }
      if (pose === 'work' || isExecuting) {
        return '/assets/agents/nyx_work.png';
      }
      return '/assets/agents/nyx_stand.png';
    }

    if (family === 'cipher') {
      if (isWalkingState) {
        return resolveWalkCycleUrl('cipher');
      }
      return '/assets/agents/cipher_stand.png';
    }

    // Default 'vance' family
    if (isWalkingState) {
      return resolveWalkCycleUrl('vance');
    }
    return '/assets/agents/vance_stand.png';
  };

  const isWorkPose = pose === 'work' || isExecuting;
  const shouldFlipLeft =
    facing === 'left' &&
    pose !== 'laptop' &&
    !(family === 'nyx' && pose === 'work' && !isWalkingState) &&
    !(
      (family === 'safecracker' || family === 'exo_hacker' || family === 'tactical_tech_ops') &&
      isWorkPose &&
      !isWalkingState
    );

  const getCombinedFilter = () => {
    const parts: string[] = [];
    if (variantMeta.cssFilter && variantMeta.cssFilter !== 'none') {
      parts.push(variantMeta.cssFilter);
    }
    return parts.length > 0 ? parts.join(' ') : 'none';
  };

  return (
    <div
      data-sprite-state={resolvedSpriteState}
      className={`relative select-none pointer-events-none h-full flex items-end justify-center ${className}`}
      style={{
        transform: shouldFlipLeft ? 'scaleX(-1)' : 'none',
      }}
    >
      {/* Framer Motion Pixel Footstep Dust Puffs when in 'walking' state */}
      <AnimatePresence>
        {resolvedSpriteState === 'walking' && (
          <motion.div
            key="walking-dust"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{
              opacity: [0.25, 0.85, 0.2],
              x: [-2, -7, -11],
              y: [0, -2, -4],
              scale: [0.75, 1.1, 0.7],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.36,
              repeat: Infinity,
              ease: 'easeOut',
            }}
            className="absolute bottom-0.5 left-1/4 z-0 flex items-center gap-0.5 pointer-events-none"
          >
            <span
              className="w-1.5 h-1.5 block"
              style={{ backgroundColor: variantMeta.accentHex, opacity: 0.75 }}
            />
            <span className="w-1 h-1 block bg-[#e59838]/70" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Framer Motion Animated Sprite Body Wrapper */}
      <motion.div
        animate={
          resolvedSpriteState === 'walking'
            ? {
                y: [0, -3.5, 0, -2.5, 0],
                rotate: [0, 1.8, 0, -1.4, 0],
                scaleY: [1, 0.97, 1, 0.98, 1],
              }
            : resolvedSpriteState === 'executing'
            ? {
                y: [0, -1.5, 0],
                scale: [1, 1.02, 1],
              }
            : {
                y: 0,
                rotate: 0,
                scaleY: 1,
                scale: 1,
              }
        }
        transition={
          resolvedSpriteState === 'walking'
            ? {
                duration: 0.36,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : resolvedSpriteState === 'executing'
            ? {
                duration: 0.8,
                repeat: Infinity,
                ease: 'easeInOut',
              }
            : { duration: 0.2 }
        }
        className="relative z-10 h-full w-full flex items-end justify-center"
      >
        {/* Base High-Res Pixel-Art Character Sprite */}
        <img
          src={resolveSpriteUrl()}
          alt={alt}
          referrerPolicy="no-referrer"
          className="h-full w-full max-h-full max-w-none pixelated block select-none object-contain"
          style={{
            aspectRatio: '2 / 3',
            filter: getCombinedFilter(),
          }}
        />
      </motion.div>
    </div>
  );
};

interface SpriteCanvasProps {
  currentRoom: RoomId;
  onChangeRoom: (room: RoomId) => void;
  agentRooms: Record<string, RoomId>;
  onMoveAgentToRoom: (
    agentId: string,
    targetRoom: RoomId,
    preferredStationId?: string,
    taskTag?: string
  ) => void;
  walkingTransition: {
    agentId: string;
    fromRoom: RoomId;
    toRoom: RoomId;
    preferredStationId?: string;
    taskTag?: string;
  } | null;
  isRoutingCamera?: boolean;
  isExecuting: boolean;
  completionAlertAgentId: string | null;
  lastActionSummary: string | null;
  isGameActive?: boolean;
  isGameClosing?: boolean;
  onGameBoostChange?: (boostPct: number) => void;
  onGameSequenceComplete?: (finalBoostPct: number) => void;
  onStartManualBypass?: () => void;
  onAbortGame?: () => void;
  isMinimapOpen?: boolean;
  onToggleMinimap?: () => void;
  townHallSummonNonce?: number;
  isMeetingActive?: boolean;
  activeSpeakerAgentIndex?: number | null;
  onCallMeeting?: () => void;
}

const UPPER_DECK_ROOMS: RoomId[] = ['comms_tower', 'war_room', 'server_vault', 'armory'];
const LOWER_DECK_ROOMS: RoomId[] = ['briefing_lounge', 'library', 'archive_basement'];

// Central War Room "Town Hall" Roundtable Formation Coordinates (Positioned on Walkable Floor around the Holo-Table)
export const TOWN_HALL_PRESET_SEATS: WorkstationDef[] = [
  { id: 'war_seat_0', label: 'Town Hall West Seat', xPct: 36.0, yPct: 75.0, corridorXPct: 36.0, corridorYPct: 79.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_1', label: 'Town Hall Center Podium', xPct: 50.0, yPct: 83.5, corridorXPct: 50.0, corridorYPct: 84.5, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_2', label: 'Town Hall East Seat', xPct: 64.0, yPct: 75.0, corridorXPct: 64.0, corridorYPct: 79.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_3', label: 'Town Hall North-West Flank', xPct: 38.0, yPct: 68.0, corridorXPct: 40.0, corridorYPct: 70.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_4', label: 'Town Hall North-East Flank', xPct: 62.0, yPct: 68.0, corridorXPct: 60.0, corridorYPct: 70.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_5', label: 'Town Hall South-West Guard', xPct: 42.0, yPct: 82.0, corridorXPct: 44.0, corridorYPct: 83.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_6', label: 'Town Hall South-East Guard', xPct: 58.0, yPct: 82.0, corridorXPct: 56.0, corridorYPct: 83.0, pose: 'work', facing: 'left', taskTag: 'ROUNDTABLE' },
  { id: 'war_seat_7', label: 'Town Hall High Council Bench', xPct: 50.0, yPct: 65.0, corridorXPct: 50.0, corridorYPct: 67.0, pose: 'desk', facing: 'right', taskTag: 'ROUNDTABLE' },
];

export function getTownHallSeat(idx: number, total: number = 3): WorkstationDef {
  if (idx < TOWN_HALL_PRESET_SEATS.length) {
    return TOWN_HALL_PRESET_SEATS[idx];
  }
  // Dynamic elliptical distribution around the central War Room holo-table for large recruited crews
  const count = Math.max(8, total);
  const angle = (idx * (2 * Math.PI)) / count;
  const x = Math.max(28, Math.min(72, Math.round(50 + 18 * Math.cos(angle))));
  const y = Math.max(65, Math.min(84, Math.round(75 + 9 * Math.sin(angle))));
  return {
    id: `war_seat_${idx}`,
    label: `Town Hall Seat #${idx + 1}`,
    xPct: x,
    yPct: y,
    corridorXPct: x,
    corridorYPct: Math.min(85, y + 2),
    pose: idx % 2 === 0 ? 'desk' : 'work',
    facing: x >= 50 ? 'left' : 'right',
    taskTag: 'ROUNDTABLE',
  };
}

export const TOWN_HALL_SEATS: Record<number, WorkstationDef> = {
  0: TOWN_HALL_PRESET_SEATS[0],
  1: TOWN_HALL_PRESET_SEATS[1],
  2: TOWN_HALL_PRESET_SEATS[2],
};

const AMBIENT_IDLE_TAGS = [
  'PATROL',
  'COMM BREAK',
  'GEAR CHECK',
  'SIGNAL WATCH',
  'ACTIVE',
  'STANDBY',
];

const PIXEL_TEXT_SHADOW_GREEN =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_var(--theme-glow-color)]';
const PIXEL_TEXT_SHADOW_AMBER =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_rgba(229,152,56,0.65)]';
const PIXEL_TEXT_SHADOW_CYAN =
  '[text-shadow:0_2px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000,0_0_8px_rgba(56,189,248,0.65)]';

export const SpriteCanvas: React.FC<SpriteCanvasProps> = ({
  currentRoom,
  onChangeRoom,
  onMoveAgentToRoom,
  walkingTransition,
  isRoutingCamera = false,
  isExecuting,
  completionAlertAgentId,
  isGameActive = false,
  isGameClosing = false,
  onGameBoostChange,
  onGameSequenceComplete,
  onStartManualBypass,
  onAbortGame,
  isMinimapOpen = false,
  onToggleMinimap,
  townHallSummonNonce = 0,
  isMeetingActive = false,
  activeSpeakerAgentIndex = null,
  onCallMeeting,
}) => {
  const { theme, themeId, activeAgent, setActiveAgentId, playBeep } = useTheme();
  const { crewAgents, getCrewAgentByIndex, updateAgentRoom } = useCrew();
  const [tick, setTick] = useState(0);
  const [walkFrame, setWalkFrame] = useState<0 | 1 | 2 | 3>(0);
  const [isOverviewZoom, setIsOverviewZoom] = useState(false);
  const [localMinimapOpen, setLocalMinimapOpen] = useState(false);
  const [hoveredStation, setHoveredStation] = useState<WorkstationDef | null>(null);
  const [registryRevision, setRegistryRevision] = useState(0);
  const [isRoomSpawnerOpen, setIsRoomSpawnerOpen] = useState(false);

  useEffect(() => {
    const unsub1 = subscribeRoomRegistry(() => setRegistryRevision((v) => v + 1));
    const unsub2 = subscribeModuleRegistry(() => setRegistryRevision((v) => v + 1));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const showMinimap = isMinimapOpen || localMinimapOpen;
  const handleToggleRadar = () => {
    playBeep('tap');
    if (onToggleMinimap) {
      onToggleMinimap();
    } else {
      setLocalMinimapOpen((prev) => !prev);
    }
  };

  const [autoRoam, setAutoRoam] = useState<boolean>(() => {
    const saved = loadLiveAgentsSnapshot();
    return saved ? saved.autoRoam : true;
  });

  // Drag / Pan state for scrollable 2D overworld canvas
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragOffsetPx, setDragOffsetPx] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Initialize individual autonomous state for the operatives across distinct sectors
  const [liveAgents, setLiveAgents] = useState<Record<number, LiveAgentState>>(() => {
    const saved = loadLiveAgentsSnapshot();
    if (
      saved &&
      saved.liveAgents &&
      saved.liveAgents[0] &&
      saved.liveAgents[1] &&
      saved.liveAgents[2]
    ) {
      const a0 = saved.liveAgents[0];
      const a1 = saved.liveAgents[1];
      const a2 = saved.liveAgents[2];
      const allValidRooms =
        Boolean(getRoomMeta(a0.room) && getRoomMeta(a1.room) && getRoomMeta(a2.room));
      const allCrowdedInOneRoom = a0.room === a1.room && a1.room === a2.room;

      const allOnWalkableFloor =
        isWalkablePoint(a0.room, a0.xPct, a0.yPct) &&
        isWalkablePoint(a1.room, a1.xPct, a1.yPct) &&
        isWalkablePoint(a2.room, a2.xPct, a2.yPct);

      if (allValidRooms && !allCrowdedInOneRoom && allOnWalkableFloor) {
        return saved.liveAgents;
      }
    }

    return {
      0: {
        agentIndex: 0,
        room: 'war_room',
        stationId: 'war_center_desk',
        xPct: 48.0,
        yPct: 83.5,
        targetXPct: 48.0,
        targetYPct: 83.5,
        targetRoom: 'war_room',
        targetStationId: 'war_center_desk',
        pose: 'desk',
        facing: 'right',
        statusTag: 'ACTIVE',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
      1: {
        agentIndex: 1,
        room: 'comms_tower',
        stationId: 'comms_dish_console',
        xPct: 38.5,
        yPct: 79.0,
        targetXPct: 38.5,
        targetYPct: 79.0,
        targetRoom: 'comms_tower',
        targetStationId: 'comms_dish_console',
        pose: 'desk',
        facing: 'left',
        statusTag: 'SIGNAL WATCH',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
      2: {
        agentIndex: 2,
        room: 'library',
        stationId: 'lib_front_desk',
        xPct: 50.0,
        yPct: 81.5,
        targetXPct: 50.0,
        targetYPct: 81.5,
        targetRoom: 'library',
        targetStationId: 'lib_front_desk',
        pose: 'desk',
        facing: 'left',
        statusTag: 'INDEXING',
        isMoving: false,
        phase: 'at_station',
        waypoints: [],
      },
    };
  });

  // Synchronize liveAgents whenever crewAgents changes (e.g., when new operatives are recruited or dismissed)
  useEffect(() => {
    setLiveAgents((prev) => {
      let changed = false;
      const next: Record<number, LiveAgentState> = { ...prev };

      // Prune any indices beyond current crewAgents length (e.g. after dismissing a recruited operative)
      Object.keys(next).forEach((key) => {
        const numKey = Number(key);
        if (numKey >= crewAgents.length) {
          delete next[numKey];
          changed = true;
        }
      });

      // Spawn any newly recruited or missing crewAgents onto the map in their assigned room
      crewAgents.forEach((crewMember, idx) => {
        if (!next[idx]) {
          changed = true;
          const assignedRoom: RoomId =
            crewMember.currentRoom && getRoomMeta(crewMember.currentRoom)
              ? crewMember.currentRoom
              : 'war_room';
          const roomStations = getRoomStns(assignedRoom);
          const occupiedStationIds = Object.values(next)
            .filter((a) => a.room === assignedRoom)
            .map((a) => a.stationId);

          const chosenStation =
            roomStations.find(
              (s) =>
                s.id === crewMember.preferredStationId &&
                !occupiedStationIds.includes(s.id)
            ) ||
            roomStations.find((s) => !occupiedStationIds.includes(s.id)) ||
            roomStations[idx % roomStations.length] ||
            roomStations[0];

          // Slight offset if another agent is already standing on the exact same station coordinates
          const overlappingCount = Object.values(next).filter(
            (a) =>
              a.room === assignedRoom &&
              Math.hypot(a.xPct - chosenStation.xPct, a.yPct - chosenStation.yPct) < 3
          ).length;
          const offsetX = overlappingCount > 0 ? ((idx % 2 === 0 ? 1 : -1) * 4.5) : 0;
          const offsetY = overlappingCount > 0 ? 2.0 : 0;
          const safeSpawn = snapToWalkableFloor(
            assignedRoom,
            chosenStation.xPct + offsetX,
            chosenStation.yPct + offsetY
          );

          next[idx] = {
            agentIndex: idx,
            room: assignedRoom,
            stationId: chosenStation.id,
            xPct: safeSpawn.xPct,
            yPct: safeSpawn.yPct,
            targetXPct: safeSpawn.xPct,
            targetYPct: safeSpawn.yPct,
            targetRoom: assignedRoom,
            targetStationId: chosenStation.id,
            pose: chosenStation.pose,
            facing: chosenStation.facing,
            statusTag: chosenStation.taskTag || 'ACTIVE',
            isMoving: false,
            phase: 'at_station',
            waypoints: [],
          };
        }
      });

      return changed ? next : prev;
    });
  }, [crewAgents]);

  const latestAgentsRef = useRef({ liveAgents, autoRoam });
  latestAgentsRef.current = { liveAgents, autoRoam };

  useEffect(() => {
    saveLiveAgentsSnapshot(liveAgents, autoRoam);
  }, [liveAgents, autoRoam]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saveLiveAgentsSnapshot(
          latestAgentsRef.current.liveAgents,
          latestAgentsRef.current.autoRoam
        );
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      saveLiveAgentsSnapshot(
        latestAgentsRef.current.liveAgents,
        latestAgentsRef.current.autoRoam
      );
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Global animation clock for progress bars & 4-phase walking leg stride cycle
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 12);
      setWalkFrame((f) => ((f + 1) % 4) as 0 | 1 | 2 | 3);
    }, 135);
    return () => clearInterval(interval);
  }, []);

  // Command an individual agent (by index 0..crewAgents.length-1) to pathfind along sector waypoints
  const commandAgentWalkTo = (
    agentIdx: number,
    destRoom: RoomId,
    destStationId?: string,
    overrideTag?: string
  ) => {
    const crewMember = crewAgents[agentIdx];
    if (
      crewMember &&
      (crewMember.currentRoom !== destRoom ||
        (destStationId && crewMember.preferredStationId !== destStationId))
    ) {
      updateAgentRoom(crewMember.id, destRoom, destStationId);
    }

    setLiveAgents((prev) => {
      const curr = prev[agentIdx];
      if (!curr) return prev;

      const roomStations = getRoomStns(destRoom);
      const occupiedIds = Object.values(prev)
        .filter((a) => a.agentIndex !== agentIdx && a.targetRoom === destRoom)
        .map((a) => a.targetStationId);

      const chosenStation =
        roomStations.find((s) => s.id === destStationId) ||
        roomStations.find((s) => !occupiedIds.includes(s.id)) ||
        roomStations[agentIdx % roomStations.length] ||
        roomStations[0];

      const chosenX = chosenStation.corridorXPct || chosenStation.xPct;
      const chosenY = chosenStation.corridorYPct || chosenStation.yPct;
      const path = buildAgentWaypointPath(
        curr.room,
        curr.xPct,
        curr.yPct,
        destRoom,
        chosenStation
      );
      const firstWp = path[0] || {
        xPct: chosenX,
        yPct: chosenY,
        room: destRoom,
      };

      const nextState: Record<number, LiveAgentState> = {
        ...prev,
        [agentIdx]: {
          ...curr,
          targetRoom: destRoom,
          targetStationId: chosenStation.id,
          targetXPct: firstWp.xPct,
          targetYPct: firstWp.yPct,
          pose: 'walking',
          facing: firstWp.xPct >= curr.xPct ? 'right' : 'left',
          statusTag:
            overrideTag ||
            (curr.room !== destRoom
              ? `TO ${getRoomMeta(destRoom).shortBadge}`
              : 'MOVING'),
          isMoving: true,
          phase: curr.room === destRoom ? 'walking_to_station' : 'walking_to_door',
          waypoints: path,
        },
      };

      const otherIdleInDest = Object.values(nextState).filter(
        (a) =>
          a.agentIndex !== agentIdx &&
          !a.isMoving &&
          (a.room === destRoom || a.targetRoom === destRoom)
      );

      if (otherIdleInDest.length >= 2) {
        const crowdedAgent = otherIdleInDest[0];
        const occupiedRooms = new Set(
          Object.values(nextState).map((a) => a.targetRoom)
        );
        const neighborCandidates = (getRoomMeta(destRoom).neighbors || []).filter(
          (r) => !occupiedRooms.has(r)
        );
        const fallbackUncrowded = getAllRoomIds().filter((r) => !occupiedRooms.has(r));
        const disperseRoom =
          (neighborCandidates[0] as RoomId) || (fallbackUncrowded[0] as RoomId) || 'briefing_lounge';

        if (disperseRoom && disperseRoom !== destRoom) {
          const disperseStation = getRoomStns(disperseRoom)[0];
          const dispersePath = buildAgentWaypointPath(
            crowdedAgent.room,
            crowdedAgent.xPct,
            crowdedAgent.yPct,
            disperseRoom,
            disperseStation
          );
          const disperseX = disperseStation.corridorXPct || disperseStation.xPct;
          const disperseY = disperseStation.corridorYPct || disperseStation.yPct;
          const dFirst = dispersePath[0] || {
            xPct: disperseX,
            yPct: disperseY,
            room: disperseRoom,
          };
          nextState[crowdedAgent.agentIndex] = {
            ...crowdedAgent,
            targetRoom: disperseRoom,
            targetStationId: disperseStation.id,
            targetXPct: dFirst.xPct,
            targetYPct: dFirst.yPct,
            pose: 'walking',
            facing: dFirst.xPct >= crowdedAgent.xPct ? 'right' : 'left',
            statusTag: `TO ${getRoomMeta(disperseRoom).shortBadge}`,
            isMoving: true,
            phase: 'walking_to_door',
            waypoints: dispersePath,
          };
        }
      }

      return nextState;
    });
  };

  const lastHandledTransitionRef = useRef<any>(null);
  const crewAgentsRef = useRef(crewAgents);
  useEffect(() => {
    crewAgentsRef.current = crewAgents;
  }, [crewAgents]);

  // Sync task-driven walkingTransition from App.tsx (processed strictly ONCE per transition instance)
  useEffect(() => {
    if (!walkingTransition) return;
    if (lastHandledTransitionRef.current === walkingTransition) return;
    lastHandledTransitionRef.current = walkingTransition;

    const currentCrew = crewAgentsRef.current;
    const idx = currentCrew.findIndex((a) => a.id === walkingTransition.agentId);
    if (idx !== -1) {
      commandAgentWalkTo(
        idx,
        walkingTransition.toRoom,
        walkingTransition.preferredStationId,
        walkingTransition.taskTag
      );
    }
  }, [walkingTransition]);

  // Town Hall Meeting Trigger Effect (strictly triggered once per summon nonce)
  const lastHandledTownHallNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!townHallSummonNonce || townHallSummonNonce <= 0) return;
    if (lastHandledTownHallNonceRef.current === townHallSummonNonce) return;
    lastHandledTownHallNonceRef.current = townHallSummonNonce;

    const currentCrew = crewAgentsRef.current;
    currentCrew.forEach((crewMember, idx) => {
      const seat = getTownHallSeat(idx, currentCrew.length);
      if (crewMember && seat) {
        updateAgentRoom(crewMember.id, 'war_room', seat.id);
      }
    });

    setLiveAgents((prev) => {
      const next: Record<number, LiveAgentState> = { ...prev };
      currentCrew.forEach((_, idx) => {
        const curr = next[idx];
        const seat = getTownHallSeat(idx, currentCrew.length);
        if (!curr) return;

        const path = buildAgentWaypointPath(
          curr.room,
          curr.xPct,
          curr.yPct,
          'war_room',
          seat
        );
        const firstWp = path[0] || {
          xPct: seat.xPct,
          yPct: seat.yPct,
          room: 'war_room' as RoomId,
        };

        next[idx] = {
          ...curr,
          targetRoom: 'war_room',
          targetStationId: seat.id,
          targetXPct: firstWp.xPct,
          targetYPct: firstWp.yPct,
          pose: 'walking',
          facing: firstWp.xPct >= curr.xPct ? 'right' : 'left',
          statusTag: curr.room === 'war_room' ? 'ROUNDTABLE' : 'TO WAR ROOM',
          isMoving: true,
          phase: curr.room === 'war_room' ? 'walking_to_station' : 'walking_to_door',
          waypoints: path,
        };
      });
      return next;
    });
  }, [townHallSummonNonce]);

  // 60ms autonomous coordinate waypoint interpolation loop
  useEffect(() => {
    const moveTimer = setInterval(() => {
      setLiveAgents((prev) => {
        let changed = false;
        const next: Record<number, LiveAgentState> = { ...prev };

        Object.keys(next)
          .map(Number)
          .forEach((idx) => {
          const ag = next[idx];
          if (!ag || !ag.isMoving) return;
          changed = true;

          const queue =
            ag.waypoints && ag.waypoints.length > 0
              ? ag.waypoints
              : [
                  {
                    xPct: ag.targetXPct,
                    yPct: ag.targetYPct,
                    room: ag.targetRoom,
                  },
                ];

          const currentWp = queue[0];
          if (!currentWp) {
            next[idx] = { ...ag, isMoving: false, pose: 'stand', waypoints: [] };
            return;
          }

          if (currentWp.room !== ag.room) {
            const remaining = queue.slice(1);
            const nextWp = remaining[0] || currentWp;
            next[idx] = {
              ...ag,
              room: currentWp.room,
              xPct: currentWp.xPct,
              yPct: currentWp.yPct,
              targetXPct: nextWp.xPct,
              targetYPct: nextWp.yPct,
              pose: 'walk',
              facing: nextWp.xPct >= currentWp.xPct ? 'right' : 'left',
              phase: 'walking_to_station',
              waypoints: remaining,
            };
            return;
          }

          const dx = currentWp.xPct - ag.xPct;
          const dy = currentWp.yPct - ag.yPct;
          const dist = Math.hypot(dx, dy);
          const speed = 2.05;

          if (dist <= speed || dist <= 1.2) {
            const remaining = queue.slice(1);
            if (remaining.length > 0) {
              const nextWp = remaining[0];
              next[idx] = {
                ...ag,
                xPct: currentWp.xPct,
                yPct: currentWp.yPct,
                targetXPct: nextWp.xPct,
                targetYPct: nextWp.yPct,
                pose: 'walk',
                facing: nextWp.xPct >= currentWp.xPct ? 'right' : 'left',
                waypoints: remaining,
              };
            } else {
              if (isMeetingActive && ag.room === 'war_room') {
                const seat = getTownHallSeat(idx, liveAgentCount);
                next[idx] = {
                  ...ag,
                  stationId: seat.id,
                  xPct: currentWp.xPct,
                  yPct: currentWp.yPct,
                  targetXPct: currentWp.xPct,
                  targetYPct: currentWp.yPct,
                  pose: seat.pose,
                  facing: seat.facing,
                  statusTag: 'ROUNDTABLE',
                  isMoving: false,
                  phase: 'at_station',
                  waypoints: [],
                };
                return;
              }

              const roomStations = getRoomStns(ag.room);
              const destStation =
                roomStations.find((s) => s.id === ag.targetStationId) || roomStations[0];

              const isAmbientSpot =
                Math.hypot(
                  currentWp.xPct - destStation.xPct,
                  currentWp.yPct - destStation.yPct
                ) > 3.5;

              next[idx] = {
                ...ag,
                stationId: destStation.id,
                xPct: currentWp.xPct,
                yPct: currentWp.yPct,
                targetXPct: currentWp.xPct,
                targetYPct: currentWp.yPct,
                pose: isAmbientSpot ? 'stand' : destStation.pose,
                facing: destStation.facing,
                statusTag: isAmbientSpot
                  ? AMBIENT_IDLE_TAGS[idx % AMBIENT_IDLE_TAGS.length]
                  : destStation.taskTag === 'COFFEE BREAK'
                  ? 'COMM BREAK'
                  : destStation.taskTag,
                isMoving: false,
                phase: 'at_station',
                waypoints: [],
              };
            }
          } else {
            const nextX = ag.xPct + (dx / dist) * speed;
            const nextY = ag.yPct + (dy / dist) * speed;

            next[idx] = {
              ...ag,
              xPct: Number(nextX.toFixed(2)),
              yPct: Number(nextY.toFixed(2)),
              facing: Math.abs(dx) > 0.1 ? (dx >= 0 ? 'right' : 'left') : ag.facing,
              pose: 'walk',
            };
          }
        });

        return changed ? next : prev;
      });
    }, 60);

    return () => clearInterval(moveTimer);
  }, [isExecuting, isMeetingActive]);

  // Casual Ambient Wandering & Zone-Based Crowd Control Loop
  useEffect(() => {
    if (!autoRoam || isExecuting || isMeetingActive) return;

    const roamTimer = setInterval(() => {
      setLiveAgents((prev) => {
        const idleCandidates = Object.values(prev).filter((a) => !a.isMoving);
        if (idleCandidates.length === 0) return prev;

        const chosen =
          idleCandidates[Math.floor(Math.random() * idleCandidates.length)];
        const currentSectorMeta = getRoomMeta(chosen.room);

        const occupiedRooms = new Set(
          Object.values(prev)
            .filter((a) => a.agentIndex !== chosen.agentIndex)
            .map((a) => a.targetRoom)
        );
        const uncrowdedNeighbors = (currentSectorMeta.neighbors || []).filter(
          (n) => !occupiedRooms.has(n)
        );

        if (Math.random() < 0.28 && uncrowdedNeighbors.length > 0) {
          const nextRoom =
            uncrowdedNeighbors[
              Math.floor(Math.random() * uncrowdedNeighbors.length)
            ];
          const nextStations = getRoomStns(nextRoom);
          const nextStation =
            nextStations[Math.floor(Math.random() * nextStations.length)];
          const path = buildAgentWaypointPath(
            chosen.room,
            chosen.xPct,
            chosen.yPct,
            nextRoom,
            nextStation
          );
          const firstWp = path[0] || {
            xPct: nextStation.xPct,
            yPct: nextStation.yPct,
            room: nextRoom,
          };

          return {
            ...prev,
            [chosen.agentIndex]: {
              ...chosen,
              targetRoom: nextRoom,
              targetStationId: nextStation.id,
              targetXPct: firstWp.xPct,
              targetYPct: firstWp.yPct,
              pose: 'walk',
              facing: firstWp.xPct >= chosen.xPct ? 'right' : 'left',
              statusTag: `TO ${getRoomMeta(nextRoom).shortBadge}`,
              isMoving: true,
              phase: 'walking_to_door',
              waypoints: path,
            },
          };
        }

        const corridorPts =
          ROOM_CORRIDOR_WAYPOINTS[chosen.room] || ROOM_CORRIDOR_WAYPOINTS.war_room;
        const stationsInRoom = getRoomStns(chosen.room);

        const wanderToCorridorTile = Math.random() < 0.45;
        if (wanderToCorridorTile && corridorPts.length > 0) {
          const wp =
            corridorPts[Math.floor(Math.random() * corridorPts.length)];
          const safeWander = snapToWalkableFloor(
            chosen.room,
            wp.xPct + (Math.random() * 6 - 3),
            wp.yPct + (Math.random() * 2 - 1)
          );
          const path = buildSingleRoomWaypoints(
            chosen.room,
            chosen.xPct,
            chosen.yPct,
            safeWander.xPct,
            safeWander.yPct,
            wp.label
          );
          const firstWp = path[0] || {
            xPct: safeWander.xPct,
            yPct: safeWander.yPct,
            room: chosen.room,
          };

          return {
            ...prev,
            [chosen.agentIndex]: {
              ...chosen,
              targetXPct: firstWp.xPct,
              targetYPct: firstWp.yPct,
              pose: 'walk',
              facing: firstWp.xPct >= chosen.xPct ? 'right' : 'left',
              statusTag: 'PATROL',
              isMoving: true,
              phase: 'walking_to_station',
              waypoints: path,
            },
          };
        }

        const otherStations = stationsInRoom.filter(
          (s) => s.id !== chosen.stationId
        );
        const nextStation =
          otherStations[Math.floor(Math.random() * otherStations.length)] ||
          stationsInRoom[0];

        const path = buildAgentWaypointPath(
          chosen.room,
          chosen.xPct,
          chosen.yPct,
          chosen.room,
          nextStation
        );
        const targetNextX = nextStation.corridorXPct || nextStation.xPct;
        const targetNextY = nextStation.corridorYPct || nextStation.yPct;
        const firstWp = path[0] || {
          xPct: targetNextX,
          yPct: targetNextY,
          room: chosen.room,
        };

        return {
          ...prev,
          [chosen.agentIndex]: {
            ...chosen,
            targetStationId: nextStation.id,
            targetXPct: firstWp.xPct,
            targetYPct: firstWp.yPct,
            pose: 'walk',
            facing: firstWp.xPct >= chosen.xPct ? 'right' : 'left',
            statusTag: 'PATROL',
            isMoving: true,
            phase: 'walking_to_station',
            waypoints: path,
          },
        };
      });
    }, 3400);

    return () => clearInterval(roamTimer);
  }, [autoRoam, isExecuting, isMeetingActive]);

  const filledSegments = isExecuting ? (tick % 8) + 2 : 6;
  const activeRoomMeta = getRoomMeta(currentRoom);

  const formatSectorTitle = (meta: RoomMetadataDef) => meta.spyTitle;

  const handleStepRoom = (dir: -1 | 1) => {
    const allIds = getAllRoomIds();
    const idx = allIds.indexOf(currentRoom);
    const nextIdx = (idx + dir + allIds.length) % allIds.length;
    onChangeRoom(allIds[nextIdx] as RoomId);
    playBeep('switch');
  };

  const handlePanGridDirection = (dCol: number, dRow: number) => {
    const targetCol = Math.max(0, Math.min(3, activeRoomMeta.gridCol + dCol));
    const targetRow = Math.max(0, Math.min(1, activeRoomMeta.gridRow + dRow));
    const allIds = getAllRoomIds();
    const match = allIds.find((rId) => {
      const m = getRoomMeta(rId as RoomId);
      return m.gridCol === targetCol && m.gridRow === targetRow;
    });
    if (match && match !== currentRoom) {
      onChangeRoom(match as RoomId);
      playBeep('switch');
    } else if (targetRow === 1 && targetCol === 3) {
      onChangeRoom('archive_basement');
      playBeep('switch');
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || isOverviewZoom) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setDragOffsetPx({
      x: Math.max(-140, Math.min(140, dx)),
      y: Math.max(-90, Math.min(90, dy)),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = null;
    setDragOffsetPx({ x: 0, y: 0 });

    if (Math.abs(dx) > 55 || Math.abs(dy) > 45) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        handlePanGridDirection(dx < 0 ? 1 : -1, 0);
      } else {
        handlePanGridDirection(0, dy < 0 ? 1 : -1);
      }
    }
  };

  const getCombinedBackdropFilter = (roomMeta: RoomMetadataDef) => {
    const parts: string[] = [];
    if (roomMeta.backdropFilter && roomMeta.backdropFilter !== 'none') {
      parts.push(roomMeta.backdropFilter);
    }
    parts.push('var(--theme-room-filter)');
    return parts.join(' ');
  };

  const activeAgentIdx = Math.max(
    0,
    crewAgents.findIndex((a) => a.id === activeAgent.id)
  );
  const activeCrewMember = getCrewAgentByIndex(activeAgentIdx);
  const activeLiveAgent = liveAgents[activeAgentIdx] || liveAgents[0];

  // Determine the active room object readout for the bottom tactical HUD bar
  const currentRoomStations = getRoomStns(currentRoom);
  const agentsInCurrentRoom = crewAgents
    .map((crew, idx) => ({
      idx,
      state: liveAgents[idx],
      crew,
    }))
    .filter((item) => item.state && item.state.room === currentRoom);

  const interactingStationInRoom = (() => {
    if (hoveredStation) {
      return {
        station: hoveredStation,
        agentName: null,
        status: hoveredStation.taskTag,
      };
    }
    const stationaryAgent =
      agentsInCurrentRoom.find(
        (a) => a.idx === activeAgentIdx && !a.state.isMoving
      ) || agentsInCurrentRoom.find((a) => !a.state.isMoving);
    if (stationaryAgent) {
      const stObj = currentRoomStations.find(
        (s) => s.id === stationaryAgent.state.stationId
      );
      if (stObj) {
        return {
          station: stObj,
          agentName: stationaryAgent.crew.customName,
          status: stationaryAgent.state.statusTag,
        };
      }
    }
    return null;
  })();

  const agentsInOtherRooms = crewAgents
    .map((crew, idx) => ({
      idx,
      profile: theme.agents[idx] || {
        ...theme.agents[0],
        id: crew.id,
        name: crew.customName,
        role: crew.role,
        specialty: crew.specialty,
      },
      crew,
      state: liveAgents[idx],
    }))
    .filter((item) => item.crew && item.state && item.state.room !== currentRoom);

  const cameraTranslateXPct = isOverviewZoom
    ? 0
    : -activeRoomMeta.gridCol * 25 + dragOffsetPx.x * 0.03;
  const cameraTranslateYPct = isOverviewZoom
    ? 0
    : -activeRoomMeta.gridRow * 50 + dragOffsetPx.y * 0.06;

  // Render an individual Sector Cell inside the 4x2 Scrollable Overworld Grid
  const renderSectorCell = (roomId: RoomId) => {
    const meta = getRoomMeta(roomId);
    const isFocusedSector = currentRoom === roomId;
    const sectorAgents = crewAgents
      .map((_, idx) => liveAgents[idx])
      .filter((st): st is LiveAgentState => Boolean(st && st.room === roomId));

    return (
      <div
        key={roomId}
        onClick={() => {
          if (isOverviewZoom || currentRoom !== roomId) {
            onChangeRoom(roomId);
            if (isOverviewZoom) setIsOverviewZoom(false);
            playBeep('switch');
          }
        }}
        className={`relative w-full h-full overflow-hidden select-none ${
          isOverviewZoom
            ? isFocusedSector
              ? 'ring-1 ring-[#e59838] cursor-pointer'
              : 'hover:ring-1 hover:ring-[#4ade80] cursor-pointer opacity-90 hover:opacity-100'
            : ''
        }`}
      >
        {/* Clean High-Res Pixel-Art Room Backdrop (Zero blocky container overlays) */}
        <img
          src={meta.cleanBackdropUrl}
          alt={formatSectorTitle(meta)}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover pixelated pointer-events-none select-none"
          style={{
            filter: getCombinedBackdropFilter(meta),
            objectPosition: meta.objectPosition || 'center center',
          }}
        />

        {/* Subtle Interactive Room Object Hotspots (Invisible until hovered or interacted with by an agent) */}
        {!isOverviewZoom &&
          isFocusedSector &&
          (getRoomStns(roomId) || []).map((station) => {
            const interactingAgent = sectorAgents.find(
              (st) => !st.isMoving && st.stationId === station.id
            );
            const isHovered = hoveredStation?.id === station.id;
            const boundSkill = getStationBoundSkill(station.id);

            return (
              <button
                key={station.id}
                type="button"
                onMouseEnter={() => setHoveredStation(station)}
                onMouseLeave={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? null : prev))
                }
                onFocus={() => setHoveredStation(station)}
                onBlur={() =>
                  setHoveredStation((prev) => (prev?.id === station.id ? null : prev))
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (!interactingAgent) {
                    commandAgentWalkTo(activeAgentIdx, roomId, station.id);
                    playBeep('tap');
                  }
                }}
                style={{
                  left: `${station.xPct}%`,
                  top: `${station.yPct}%`,
                  transform: 'translate(-50%, -100%)',
                }}
                className="absolute z-15 w-16 h-14 flex flex-col items-center justify-end pb-1 cursor-pointer group focus:outline-none"
                aria-label={`${station.label} (${station.taskTag})`}
              >
                {/* Only render subtle glowing pixel-art tooltip when an agent is actively interacting or user hovers */}
                {(interactingAgent || isHovered) && (
                  <span
                    className={`font-mono-tabular text-[9px] sm:text-[10px] tracking-wider uppercase whitespace-nowrap pointer-events-none select-none transition-opacity ${
                      isHovered
                        ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                        : `text-[#4ade80]/90 ${PIXEL_TEXT_SHADOW_GREEN}`
                    }`}
                  >
                    ◈ {station.label} {boundSkill ? `[${boundSkill.shortCode}]` : ''}
                  </span>
                )}
              </button>
            );
          })}

        {/* Unboxed Sector Identification Callout in 7-Room Overview Mode */}
        {isOverviewZoom && (
          <div
            className={`absolute top-1.5 left-2 z-25 font-mono-tabular text-[9px] sm:text-[10px] font-bold flex items-center gap-1.5 pointer-events-none ${PIXEL_TEXT_SHADOW_AMBER}`}
          >
            <span className="text-[#e59838]">{meta.sectorCode}</span>
            <span className="text-[#f3ead8]">{meta.shortBadge}</span>
            <span className="text-[#4ade80]">[{sectorAgents.length}]</span>
          </div>
        )}

        {/* Unboxed Town Hall Roundtable Callout in War Room when Meeting is Active */}
        {isMeetingActive && roomId === 'war_room' && (
          <div
            className={`absolute left-[50%] top-[48%] -translate-x-1/2 z-15 pointer-events-none font-mono-tabular text-[10px] sm:text-[11px] font-bold tracking-wider text-[#38bdf8] whitespace-nowrap animate-pulse ${PIXEL_TEXT_SHADOW_CYAN}`}
          >
            [TOWN HALL ROUNDTABLE ACTIVE]
          </div>
        )}

        {/* Framer Motion Animated Pixel-Art Agents inside this Sector */}
        <AnimatePresence>
          {sectorAgents.map((st) => {
            const crewMember =
              crewAgents[st.agentIndex] || getCrewAgentByIndex(st.agentIndex);
            const profile: AgentProfile = theme.agents[st.agentIndex] || {
              ...theme.agents[0],
              id: crewMember.id,
              name: crewMember.customName,
              role: crewMember.role,
              specialty: crewMember.specialty,
            };
            const variantMeta =
              SPRITE_VARIANTS[crewMember.spriteVariant] ||
              SPRITE_VARIANTS.trenchcoat;
            const isSelected = activeAgent.id === crewMember.id;
            const isRoundtableSpeaker =
              isMeetingActive && activeSpeakerAgentIndex === st.agentIndex;
            const isAgentExecuting =
              (isExecuting && isSelected) || isRoundtableSpeaker;

            const isWalkingTransitionActive =
              Boolean(
                walkingTransition && walkingTransition.agentId === profile.id
              ) ||
              st.isMoving ||
              st.pose === 'walk' ||
              st.pose === 'walking';

            const activePose: StationPose = isWalkingTransitionActive
              ? 'walking'
              : st.pose;
            const spriteState: SpriteAnimationState = isWalkingTransitionActive
              ? 'walking'
              : isAgentExecuting
              ? 'executing'
              : 'idle';

            const showProgressBar =
              isAgentExecuting || st.statusTag === 'HACKING';

            // Uniform perspective-aware character height (27.5% base standing height with subtle floor depth scale + 0.82x crouching multiplier)
            const depthScale = 0.88 + Math.max(0, Math.min(30, st.yPct - 60)) * 0.008;
            const isCrouchingWork =
              !isWalkingTransitionActive &&
              (activePose === 'work' || activePose === 'laptop' || isAgentExecuting) &&
              (variantMeta.baseSpriteFamily === 'safecracker' ||
                variantMeta.baseSpriteFamily === 'exo_hacker' ||
                variantMeta.baseSpriteFamily === 'tactical_tech_ops');
            const spriteHeightPct = Number(
              (27.5 * depthScale * (isCrouchingWork ? 0.82 : 1.0)).toFixed(2)
            );

            const opState = resolveAgentOperationalState(st, meta.idleTag);
            const resolvedStatusText = isWalkingTransitionActive
              ? st.statusTag.startsWith('TO ')
                ? st.statusTag
                : 'MOVING'
              : isRoundtableSpeaker
              ? 'SPEAKING'
              : isAgentExecuting
              ? (opState.activeSkill ? `BOUND: ${opState.activeSkill.shortCode}` : 'EXECUTING')
              : opState.operationalBadge;

            return (
              <motion.div
                key={`${profile.id}-${st.room}`}
                initial={{
                  opacity: 0,
                  scale: 0.9,
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  x: '-50%',
                  y: '-100%',
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  x: '-50%',
                  y: '-100%',
                }}
                exit={{
                  opacity: 0,
                  scale: 0.88,
                  transition: { duration: 0.2 },
                }}
                transition={{
                  left: { type: 'tween', duration: 0.065, ease: 'linear' },
                  top: { type: 'tween', duration: 0.065, ease: 'linear' },
                  opacity: { duration: 0.22 },
                  scale: { type: 'spring', stiffness: 320, damping: 24 },
                }}
                style={{
                  left: `${st.xPct}%`,
                  top: `${st.yPct}%`,
                  transform: 'translate(-50%, -100%)',
                  height: `${spriteHeightPct}%`,
                  aspectRatio: isCrouchingWork ? '230 / 260' : '200 / 300',
                  zIndex: Math.round(st.yPct),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveAgentId(profile.id);
                  if (currentRoom !== roomId) {
                    onChangeRoom(roomId);
                  }
                  if (isOverviewZoom) {
                    setIsOverviewZoom(false);
                  }
                  playBeep('tap');
                }}
                className="absolute z-20 cursor-pointer group select-none flex flex-col items-center justify-end"
                title={`${crewMember.customName} (${profile.role} · ${variantMeta.label}) — Sector: ${meta.shortBadge} — [${resolvedStatusText}]`}
              >
                {/* Clean 16-Bit Isometric Sprite Callout (Zero Bulky Background Boxes) */}
                <div
                  className={`absolute bottom-[102%] left-1/2 -translate-x-1/2 pb-0.5 flex flex-col items-center pointer-events-none ${
                    isOverviewZoom ? 'scale-75 origin-bottom' : ''
                  }`}
                >
                  {/* Unboxed Codename Callout */}
                  <div
                    className={`font-mono-tabular text-[10px] sm:text-[11px] font-bold tracking-wider whitespace-nowrap flex items-center gap-1 ${
                      isRoundtableSpeaker
                        ? `text-[#38bdf8] ${PIXEL_TEXT_SHADOW_CYAN}`
                        : isSelected
                        ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                        : `text-[#f3ead8] ${PIXEL_TEXT_SHADOW_GREEN}`
                    }`}
                  >
                    <span>{isSelected ? '▼' : '·'}</span>
                    <span>{crewMember.customName}</span>
                  </div>

                  {/* Unboxed Phosphor-Green / Amber / Dynamic RGB Terminal Status Tag */}
                  <motion.span
                    animate={
                      isWalkingTransitionActive || isRoundtableSpeaker
                        ? { opacity: [0.75, 1, 0.75] }
                        : { opacity: 1 }
                    }
                    transition={
                      isWalkingTransitionActive || isRoundtableSpeaker
                        ? { duration: 0.6, repeat: Infinity }
                        : { duration: 0.15 }
                    }
                    className={`text-[9px] sm:text-[10px] font-mono-tabular font-bold tracking-wider whitespace-nowrap leading-none mt-0.5 ${
                      isRoundtableSpeaker
                        ? `text-[#38bdf8] ${PIXEL_TEXT_SHADOW_CYAN}`
                        : isWalkingTransitionActive || isAgentExecuting
                        ? `text-[#e59838] ${PIXEL_TEXT_SHADOW_AMBER}`
                        : `theme-text-primary ${PIXEL_TEXT_SHADOW_GREEN}`
                    }`}
                  >
                    [{resolvedStatusText}]
                  </motion.span>

                  {/* Sleek Unboxed 16-Bit Segmented Pixel Progress Ticks when Executing */}
                  {showProgressBar && !isOverviewZoom && (
                    <div className="mt-1 flex items-center gap-[2px] w-14 sm:w-16 h-1.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.95)]">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <div
                          key={i}
                          className={`h-full flex-1 ${
                            i < filledSegments ? '' : 'bg-[#0b1310]/80'
                          }`}
                          style={
                            i < filledSegments
                              ? {
                                  backgroundColor: 'rgb(var(--theme-primary-rgb))',
                                  boxShadow: '0 0 4px var(--theme-glow-color)',
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}

                  {completionAlertAgentId === profile.id && (
                    <span
                      className={`mt-0.5 text-[#fde047] font-mono-tabular font-bold text-[10px] ${PIXEL_TEXT_SHADOW_AMBER}`}
                    >
                      [✓ COMPLETE]
                    </span>
                  )}
                </div>

                {/* Variant-Differentiated Pixel-Art Character Sprite */}
                <AgentSpriteFigure
                  spriteVariant={crewMember.spriteVariant}
                  pose={activePose}
                  walkFrame={walkFrame}
                  facing={st.facing}
                  isMoving={st.isMoving}
                  isWalkingTransition={isWalkingTransitionActive}
                  spriteState={spriteState}
                  isExecuting={isAgentExecuting}
                  themeId={themeId}
                  alt={crewMember.customName}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div
      className="relative w-full max-w-5xl mx-auto select-none border-b bg-[#080a0f]"
      style={{ borderColor: 'var(--theme-border-color)' }}
    >
      {/* Top 16-Bit Tactical Sector Bezel Strip (Integrated above the canvas, never floating over room art) */}
      <div
        className="bg-[#0c0f16] border-b px-2.5 py-1.5 flex flex-nowrap items-center justify-between gap-2 font-mono-tabular shrink-0 overflow-x-auto no-scrollbar w-full"
        style={{ borderColor: 'var(--theme-border-color)' }}
      >
        {/* Left: Radar, 7-Room Zoom, and Active Sector Title */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleToggleRadar}
            className={`text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
              showMinimap
                ? 'text-[#e59838] font-bold'
                : 'theme-text-primary theme-glow-text hover:opacity-85'
            }`}
            title="Toggle Retro Overworld Minimap Radar"
          >
            <Radar className="w-3 h-3" />
            <span>[RADAR]</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsOverviewZoom((prev) => !prev);
              playBeep('switch');
            }}
            className={`text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
              isOverviewZoom
                ? 'text-[#38bdf8] font-bold'
                : 'text-[#94a3b8] hover:text-[#f3ead8]'
            }`}
            title="Toggle 7-Sector Full Overworld Map Zoom"
          >
            {isOverviewZoom ? (
              <Minimize2 className="w-3 h-3" />
            ) : (
              <Maximize2 className="w-3 h-3" />
            )}
            <span>{isOverviewZoom ? '[1x VIEW]' : '[7-SECTOR]'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsRoomSpawnerOpen(true);
              playBeep('tap');
            }}
            className="text-[10px] sm:text-[11px] flex items-center gap-1 cursor-pointer transition-colors text-[#38bdf8] hover:text-[#fde047] font-bold"
            title="Open Dynamic Room Spawner & Modular Skill Attachment Engine"
          >
            <Layers className="w-3 h-3" />
            <span>[+ EXPAND / SKILLS]</span>
          </button>

          <span className="text-[#334155]">·</span>

          <span className="text-[10px] theme-text-primary theme-glow-text font-bold shrink-0">
            [{activeRoomMeta.sectorCode}]
          </span>
          <span className="text-[11px] sm:text-xs font-semibold text-[#e59838] tracking-wide truncate">
            {formatSectorTitle(activeRoomMeta)}
          </span>
        </div>

        {/* Right: Sector Quick-Switch Tabs + Manual Bypass */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full no-scrollbar">
          {getAllRoomIds().map((rId) => {
            const active = rId === currentRoom;
            const meta = getRoomMeta(rId as RoomId);
            const countInRoom = Object.values(liveAgents).filter(
              (a) => a.room === rId
            ).length;
            return (
              <button
                key={rId}
                type="button"
                onClick={() => {
                  onChangeRoom(rId as RoomId);
                  if (isOverviewZoom) setIsOverviewZoom(false);
                  playBeep('switch');
                }}
                className={`px-1.5 py-0.5 text-[9px] sm:text-[10px] transition-colors flex items-center gap-0.5 cursor-pointer whitespace-nowrap ${
                  active
                    ? 'theme-text-primary theme-glow-text font-bold underline underline-offset-4'
                    : 'text-[#64748b] hover:text-[#cbd5e1]'
                }`}
              >
                <span>{meta.shortBadge}</span>
                {countInRoom > 0 && (
                  <span className="theme-text-primary">:{countInRoom}</span>
                )}
              </button>
            );
          })}

          {!isGameActive && onStartManualBypass && (
            <>
              <span className="text-[#334155]">·</span>
              <button
                type="button"
                onClick={onStartManualBypass}
                className="text-[10px] theme-text-primary theme-glow-text hover:text-[#fde047] font-bold cursor-pointer whitespace-nowrap"
                title="Launch interactive Neural Bypass mini-game"
              >
                [BYPASS]
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Scrollable / Pannable 2D Overworld Viewport (Standardized 16:9 Aspect Ratio / 960x540 Logical Virtual Grid) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative w-full aspect-[16/9] max-h-[50dvh] sm:max-h-none bg-[#080a0f] overflow-hidden mx-auto cursor-grab active:cursor-grabbing touch-pan-y"
        style={{
          boxShadow: 'inset 0 0 28px var(--theme-glow-soft)',
        }}
      >
        {/* 2D Multi-Wing Scrollable World Canvas (4 Columns x 2 Decks) with Smooth Camera Panning */}
        <motion.div
          animate={{
            x: `${cameraTranslateXPct}%`,
            y: `${cameraTranslateYPct}%`,
          }}
          transition={{
            type: 'spring',
            stiffness: 155,
            damping: 24,
            mass: 0.9,
          }}
          style={{
            width: isOverviewZoom ? '100%' : '400%',
            height: isOverviewZoom ? '100%' : '200%',
            transform: `translate(${cameraTranslateXPct}%, ${cameraTranslateYPct}%)`,
          }}
          className="grid grid-cols-4 grid-rows-2 relative"
        >
          {/* Row 0: Upper Deck Wing */}
          {UPPER_DECK_ROOMS.map((roomId) => renderSectorCell(roomId))}

          {/* Row 1: Lower Deck Wing */}
          {LOWER_DECK_ROOMS.map((roomId) => renderSectorCell(roomId))}

          {/* 4th Lower Grid Cell (Col 3, Row 1): Custom Spawned Room or Expansion Slot */}
          {(() => {
            const all = getAllRooms();
            const d2Room = Object.values(all).find(
              (r) =>
                r.gridCol === 3 &&
                r.gridRow === 1 &&
                !UPPER_DECK_ROOMS.includes(r.id) &&
                !LOWER_DECK_ROOMS.includes(r.id)
            );
            if (d2Room) {
              return renderSectorCell(d2Room.id as RoomId);
            }
            return (
              <div
                onClick={() => {
                  setIsRoomSpawnerOpen(true);
                  if (isOverviewZoom) setIsOverviewZoom(false);
                  playBeep('tap');
                }}
                className="relative w-full h-full overflow-hidden bg-[#0a0e17] cursor-pointer group"
                title="Click to spawn or configure custom sector at SEC-D2"
              >
                <img
                  src="/assets/rooms/archive_basement_clean.png"
                  alt="Sub-Level Transit Conduit"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover pixelated opacity-65 group-hover:opacity-85 transition-opacity pointer-events-none"
                  style={{
                    filter: 'var(--theme-room-filter) brightness(0.75)',
                  }}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center p-2 text-center pointer-events-none">
                  <span
                    className={`font-mono-tabular text-[10px] text-[#38bdf8] font-bold ${PIXEL_TEXT_SHADOW_CYAN}`}
                  >
                    [EXPANSION SLOT · SEC-D2]
                  </span>
                  <span
                    className={`font-mono-tabular text-[9px] text-[#4ade80] mt-0.5 ${PIXEL_TEXT_SHADOW_GREEN}`}
                  >
                    [+ CLICK TO SPAWN SECTOR]
                  </span>
                </div>
              </div>
            );
          })()}
        </motion.div>

        {/* Minimal Unboxed Edge Step Chevrons */}
        <button
          type="button"
          onClick={() => handleStepRoom(-1)}
          className={`absolute left-1.5 top-1/2 -translate-y-1/2 z-30 p-1 text-[#e59838]/75 hover:text-[#fde047] transition-colors cursor-pointer ${PIXEL_TEXT_SHADOW_AMBER}`}
          aria-label="Pan camera West"
          title="Previous sector"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => handleStepRoom(1)}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 z-30 p-1 text-[#e59838]/75 hover:text-[#fde047] transition-colors cursor-pointer ${PIXEL_TEXT_SHADOW_AMBER}`}
          aria-label="Pan camera East"
          title="Next sector"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        {/* Retro Minimap / Overview Radar Popup HUD Overlay (Only shown when explicitly toggled) */}
        <AnimatePresence>
          {showMinimap && (
            <motion.div
              key="overworld-minimap-radar"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.16 }}
              className="absolute top-2 left-2.5 z-40 w-72 sm:w-84 bg-[#070b10]/95 border border-[#4ade80]/80 shadow-[0_0_24px_rgba(0,0,0,0.9)] p-2.5 font-mono-tabular"
            >
              <div className="flex items-center justify-between border-b border-[#1e3a2f] pb-1.5 mb-2">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#4ade80]">
                  <Compass className="w-3.5 h-3.5" />
                  <span>SAFEHOUSE OVERWORLD RADAR</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleRadar}
                  className="text-[10px] text-[#94a3b8] hover:text-white px-1 cursor-pointer"
                >
                  [X]
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <div className="text-[9px] text-[#94a3b8] uppercase mb-1 flex items-center justify-between">
                    <span>Upper Tactical Wing</span>
                    <span className="text-[#4ade80]">Select Sector</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {UPPER_DECK_ROOMS.map((rId) => {
                      const m = getRoomMeta(rId);
                      const isCam = currentRoom === rId;
                      const agentsHere = crewAgents
                        .map((crew, i) => ({
                          idx: i,
                          state: liveAgents[i],
                          crew,
                        }))
                        .filter((a) => a.state && a.state.room === rId);

                      return (
                        <button
                          key={rId}
                          type="button"
                          onClick={() => {
                            onChangeRoom(rId);
                            playBeep('switch');
                          }}
                          className={`p-1.5 border text-left transition-colors relative cursor-pointer ${
                            isCam
                              ? 'bg-[#132019] border-[#e59838] text-[#f3ead8]'
                              : 'bg-[#0b111a] border-[#1e2d3d] text-[#94a3b8] hover:border-[#4ade80]'
                          }`}
                        >
                          <div className="text-[8px] text-[#e59838] font-bold">
                            {m.sectorCode}
                          </div>
                          <div className="text-[9px] font-semibold truncate">
                            {m.shortBadge}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[12px]">
                            {agentsHere.map(({ idx, crew }) => {
                              const vMeta = SPRITE_VARIANTS[crew.spriteVariant];
                              return (
                                <span
                                  key={idx}
                                  className="text-[8px] font-bold"
                                  style={{ color: vMeta.accentHex }}
                                >
                                  [{crew.customName.slice(0, 2).toUpperCase()}]
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] text-[#94a3b8] uppercase mb-1">
                    Lower Archive & Crew Wing
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {LOWER_DECK_ROOMS.map((rId) => {
                      const m = getRoomMeta(rId);
                      const isCam = currentRoom === rId;
                      const agentsHere = crewAgents
                        .map((crew, i) => ({
                          idx: i,
                          state: liveAgents[i],
                          crew,
                        }))
                        .filter((a) => a.state && a.state.room === rId);

                      return (
                        <button
                          key={rId}
                          type="button"
                          onClick={() => {
                            onChangeRoom(rId);
                            playBeep('switch');
                          }}
                          className={`p-1.5 border text-left transition-colors relative cursor-pointer ${
                            isCam
                              ? 'bg-[#132019] border-[#e59838] text-[#f3ead8]'
                              : 'bg-[#0b111a] border-[#1e2d3d] text-[#94a3b8] hover:border-[#4ade80]'
                          }`}
                        >
                          <div className="text-[8px] text-[#e59838] font-bold">
                            {m.sectorCode}
                          </div>
                          <div className="text-[9px] font-semibold truncate">
                            {m.shortBadge}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1 min-h-[12px]">
                            {agentsHere.map(({ idx, crew }) => {
                              const vMeta = SPRITE_VARIANTS[crew.spriteVariant];
                              return (
                                <span
                                  key={idx}
                                  className="text-[8px] font-bold"
                                  style={{ color: vMeta.accentHex }}
                                >
                                  [{crew.customName.slice(0, 2).toUpperCase()}]
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        onChangeRoom('archive_basement');
                        playBeep('switch');
                      }}
                      className="p-1.5 border border-[#1e293b] bg-[#090d14] text-left text-[#64748b] hover:border-[#38bdf8] cursor-pointer"
                    >
                      <div className="text-[8px] text-[#38bdf8]">SEC-D2</div>
                      <div className="text-[9px] truncate">CONDUIT</div>
                      <div className="text-[8px] mt-1 text-[#475569]">[LIFT]</div>
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modular Neural Bypass / Theme-Aware Mini-Game Overlay */}
        <GameOverlay
          isActive={isGameActive}
          isClosing={isGameClosing}
          themeId={themeId}
          onBoostChange={onGameBoostChange}
          onSequenceComplete={(boost) => onGameSequenceComplete?.(boost)}
          onAbort={onAbortGame}
        />
      </div>

      {/* Integrated 16-Bit Tactical Bottom Screen Tray:
          - Sleek phosphor-green (#4ade80) & amber (#e59838) operative status tags ([ACTIVE], [COMM BREAK], etc.)
          - Live Room Object interaction readout (only shown when an agent interacts with or user hovers a station)
          - Clean terminal text triggers for sector dispatch & deck switching with zero floating room boxes */}
      <div
        className="bg-[#0a0d13] border-t px-3 py-1.5 flex flex-col gap-1 font-mono-tabular text-[10px] sm:text-[11px]"
        style={{ borderColor: 'var(--theme-border-color)' }}
      >
        {/* Row 1: All Operatives' Terminal Status Tags + Active Room Object Readout */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Sleek Terminal-Style Dynamic RGB / Amber Agent Status Tags */}
          <div className="flex flex-wrap items-center gap-3">
            {crewAgents.map((crew, idx) => {
              const st = liveAgents[idx];
              if (!crew || !st) return null;
              const isSelected = activeAgent.id === crew.id;
              const isSpeaker =
                isMeetingActive && activeSpeakerAgentIndex === idx;
              const isExec = (isExecuting && isSelected) || isSpeaker;
              const statusLabel = st.isMoving
                ? st.statusTag
                : isSpeaker
                ? 'SPEAKING'
                : isExec
                ? 'EXECUTING'
                : st.statusTag === 'COFFEE BREAK'
                ? 'COMM BREAK'
                : st.statusTag;

              return (
                <button
                  key={crew.id}
                  type="button"
                  onClick={() => {
                    setActiveAgentId(crew.id);
                    onChangeRoom(st.room);
                    playBeep('tap');
                  }}
                  className="flex items-center gap-1 cursor-pointer group text-left"
                  title={`Focus ${crew.customName} in ${getRoomMeta(st.room).shortBadge}`}
                >
                  <span
                    className={
                      isSelected
                        ? 'text-[#e59838] font-bold'
                        : 'text-[#cbd5e1] group-hover:text-white'
                    }
                  >
                    {isSelected ? '▸' : '·'} {crew.customName.toUpperCase()}
                  </span>
                  <span
                    className={
                      isSpeaker
                        ? 'text-[#38bdf8] font-bold'
                        : st.isMoving || isExec
                        ? 'text-[#e59838] font-bold'
                        : 'theme-text-primary theme-glow-text font-semibold'
                    }
                  >
                    [{statusLabel}]
                  </span>
                  <span className="text-[#64748b] text-[9px]">
                    @{getRoomMeta(st.room).sectorCode}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Room Object Interaction Readout (Holo-Tables, Terminal Racks, etc.) */}
          <div className="flex items-center gap-2 text-[10px] truncate">
            {walkingTransition ? (
              <span className="text-[#e59838] flex items-center gap-1">
                <Footprints className="w-3 h-3 inline" />
                <span>
                  TRANSIT: {getRoomMeta(walkingTransition.fromRoom).shortBadge}{' '}
                  &rarr; {getRoomMeta(walkingTransition.toRoom).shortBadge}
                </span>
              </span>
            ) : isRoutingCamera ? (
              <span className="theme-text-primary theme-glow-text">
                CAMERA LOCK: {activeRoomMeta.shortBadge} [{activeRoomMeta.sectorCode}]
              </span>
            ) : interactingStationInRoom ? (
              <span className="theme-text-primary theme-glow-text truncate">
                OBJECT:{' '}
                <strong className="text-[#e59838]">
                  {interactingStationInRoom.station.label.toUpperCase()}
                </strong>{' '}
                · [{interactingStationInRoom.status}]
                {interactingStationInRoom.agentName
                  ? ` (${interactingStationInRoom.agentName})`
                  : ' (CLICK TO ASSIGN)'}
              </span>
            ) : (
              <span className="text-[#64748b]">
                SECTOR CLEAR · HOVER OR CLICK STATION TO ASSIGN
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Unboxed Terminal Sector-Dispatch & Deck-Lift Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#141a26] text-[10px]">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[#64748b] flex items-center gap-1 shrink-0">
              <ArrowRightLeft className="w-3 h-3 text-[#e59838]" />
              <span>DISPATCH {activeCrewMember.customName.toUpperCase()}:</span>
            </span>
            {activeRoomMeta.neighbors.map((targetRoom) => (
              <button
                key={targetRoom}
                type="button"
                onClick={() => onMoveAgentToRoom(activeCrewMember.id, targetRoom)}
                className="text-[#e59838] hover:text-[#fde047] cursor-pointer whitespace-nowrap"
              >
                [&rarr; {getRoomMeta(targetRoom).shortBadge}]
              </button>
            ))}

            {currentRoomStations.map((st) => {
              const isCurrentStation =
                activeLiveAgent?.room === currentRoom &&
                activeLiveAgent?.stationId === st.id &&
                !activeLiveAgent?.isMoving;
              return (
                <button
                  key={st.id}
                  type="button"
                  onMouseEnter={() => setHoveredStation(st)}
                  onMouseLeave={() =>
                    setHoveredStation((prev) => (prev?.id === st.id ? null : prev))
                  }
                  onClick={() => {
                    commandAgentWalkTo(activeAgentIdx, currentRoom, st.id);
                    playBeep('tap');
                  }}
                  className={`cursor-pointer whitespace-nowrap transition-colors ${
                    isCurrentStation
                      ? 'text-[#4ade80] font-bold'
                      : 'text-[#94a3b8] hover:text-[#4ade80]'
                  }`}
                >
                  [{st.label}]
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {agentsInOtherRooms.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5">
                <UserPlus className="w-3 h-3 text-[#4ade80]" />
                {agentsInOtherRooms.map(({ idx, crew, state }) => (
                  <button
                    key={crew.id}
                    type="button"
                    onClick={() => {
                      commandAgentWalkTo(idx, currentRoom);
                      onMoveAgentToRoom(crew.id, currentRoom);
                    }}
                    className="text-[#4ade80] hover:text-[#86efac] cursor-pointer whitespace-nowrap"
                    title={`Summon ${crew.customName} from ${getRoomMeta(state.room).shortBadge}`}
                  >
                    [+SUMMON {crew.customName.toUpperCase()}]
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                handlePanGridDirection(0, activeRoomMeta.gridRow === 0 ? 1 : -1)
              }
              className="text-[#38bdf8] hover:text-[#7dd3fc] flex items-center gap-0.5 cursor-pointer whitespace-nowrap"
            >
              {activeRoomMeta.gridRow === 0 ? (
                <>
                  <ChevronDown className="w-3 h-3" />
                  <span>[LOWER DECK]</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3 h-3" />
                  <span>[UPPER DECK]</span>
                </>
              )}
            </button>

            {onCallMeeting && (
              <button
                type="button"
                onClick={onCallMeeting}
                className={`cursor-pointer whitespace-nowrap ${
                  isMeetingActive
                    ? 'text-[#38bdf8] font-bold'
                    : 'text-[#e59838] hover:text-[#fde047]'
                }`}
              >
                [ROUNDTABLE]
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setAutoRoam((prev) => !prev);
                playBeep('tap');
              }}
              className={`flex items-center gap-0.5 cursor-pointer whitespace-nowrap ${
                autoRoam ? 'text-[#4ade80]' : 'text-[#64748b]'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>[ROAM:{autoRoam ? 'ON' : 'OFF'}]</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Room Expansion & Skill Binding Modal */}
      <RoomSpawnerModal
        isOpen={isRoomSpawnerOpen}
        onClose={() => setIsRoomSpawnerOpen(false)}
        currentRoom={currentRoom}
        onNavigateToRoom={(rId) => {
          onChangeRoom(rId);
          if (isOverviewZoom) setIsOverviewZoom(false);
        }}
      />
    </div>
  );
};

