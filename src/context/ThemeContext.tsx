import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeId = 'green' | 'amber' | 'cyan' | 'ruby' | 'purple';

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  specialty: string;
  defaultStatus: 'Idle' | 'Patrol' | 'Executing';
  primaryColor: string;
  secondaryColor: string;
  accessoryColor: string;
  gridX: number;
  gridY: number;
  bio: string;
}

export interface ThemeAssetBundle {
  wallTextureStyle: string;
  floorPrimaryHex: string;
  floorSecondaryHex: string;
  furnitureSet: 'server_racks' | 'bookshelves' | 'rune_tables' | 'neon_terminals' | 'alchemy_benches';
  uiBorderFrame: string;
  phosphorGlow: string;
  agentSpriteCssFilter: string;
}

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  shortLabel: string;
  tagline: string;
  roomName: string;
  accentHex: string;
  accentTextClass: string;
  accentBgClass: string;
  accentBorderClass: string;
  surfaceBgHex: string;
  frameBorderStyle: string;
  floorTilePrimary: string;
  floorTileSecondary: string;
  wallColor: string;
  promptModifierSummary: string;
  quickDirectives: string[];
  agents: AgentProfile[];
  assets: ThemeAssetBundle;
}

export interface RoomThemeAssetDescriptor {
  backgroundTitle: string;
  furnitureAssetLabel: string;
  primaryPropType: string;
  accentColor: string;
  backdropUrl: string;
  backdropFilter: string;
}

export const THEME_ROOM_ASSET_MAPPINGS: Record<string, Record<string, RoomThemeAssetDescriptor>> = {
  green: {
    war_room: { backgroundTitle: 'Command Center', furnitureAssetLabel: 'Command Desk', primaryPropType: 'server_racks', accentColor: '#4ade80', backdropUrl: '/assets/rooms/war_room_clean.png', backdropFilter: 'sepia(1) hue-rotate(60deg) saturate(3) brightness(0.85)' },
    comms_tower: { backgroundTitle: 'Comms Array', furnitureAssetLabel: 'Satellite Console', primaryPropType: 'radar_dish', accentColor: '#4ade80', backdropUrl: '/assets/rooms/comms_tower_clean.png', backdropFilter: 'sepia(1) hue-rotate(55deg) saturate(3) brightness(0.8)' },
    server_vault: { backgroundTitle: 'Mainframe Vault', furnitureAssetLabel: 'Blade Rack', primaryPropType: 'mainframe', accentColor: '#4ade80', backdropUrl: '/assets/rooms/server_vault_clean.png', backdropFilter: 'sepia(1) hue-rotate(65deg) saturate(3) brightness(0.8)' },
    library: { backgroundTitle: 'Intel Archive', furnitureAssetLabel: 'Dossier Stacks', primaryPropType: 'bookshelves', accentColor: '#4ade80', backdropUrl: '/assets/rooms/library_clean.png', backdropFilter: 'sepia(1) hue-rotate(60deg) saturate(2.5) brightness(0.9)' },
    armory: { backgroundTitle: 'Tactical Armory', furnitureAssetLabel: 'Armor Locker', primaryPropType: 'weapon_rack', accentColor: '#4ade80', backdropUrl: '/assets/rooms/armory_clean.png', backdropFilter: 'sepia(1) hue-rotate(50deg) saturate(3) brightness(0.85)' },
    briefing_lounge: { backgroundTitle: 'Briefing Lounge', furnitureAssetLabel: 'Holo Table', primaryPropType: 'coffee_bar', accentColor: '#4ade80', backdropUrl: '/assets/rooms/briefing_lounge_clean.png', backdropFilter: 'sepia(1) hue-rotate(60deg) saturate(3) brightness(0.85)' },
    archive_basement: { backgroundTitle: 'Sub-Level Basement', furnitureAssetLabel: 'Vault Door', primaryPropType: 'vault_door', accentColor: '#4ade80', backdropUrl: '/assets/rooms/archive_basement_clean.png', backdropFilter: 'sepia(1) hue-rotate(70deg) saturate(3) brightness(0.75)' },
  },
  amber: {
    war_room: { backgroundTitle: 'Command Center', furnitureAssetLabel: 'Command Desk', primaryPropType: 'server_racks', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/war_room_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    comms_tower: { backgroundTitle: 'Comms Array', furnitureAssetLabel: 'Satellite Console', primaryPropType: 'radar_dish', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/comms_tower_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    server_vault: { backgroundTitle: 'Mainframe Vault', furnitureAssetLabel: 'Blade Rack', primaryPropType: 'mainframe', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/server_vault_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    library: { backgroundTitle: 'Intel Archive', furnitureAssetLabel: 'Dossier Stacks', primaryPropType: 'bookshelves', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/library_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    armory: { backgroundTitle: 'Tactical Armory', furnitureAssetLabel: 'Armor Locker', primaryPropType: 'weapon_rack', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/armory_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    briefing_lounge: { backgroundTitle: 'Briefing Lounge', furnitureAssetLabel: 'Holo Table', primaryPropType: 'coffee_bar', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/briefing_lounge_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
    archive_basement: { backgroundTitle: 'Sub-Level Basement', furnitureAssetLabel: 'Vault Door', primaryPropType: 'vault_door', accentColor: '#f59e0b', backdropUrl: '/assets/rooms/archive_basement_clean.png', backdropFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)' },
  },
  cyan: {
    war_room: { backgroundTitle: 'Command Center', furnitureAssetLabel: 'Command Desk', primaryPropType: 'server_racks', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/war_room_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    comms_tower: { backgroundTitle: 'Comms Array', furnitureAssetLabel: 'Satellite Console', primaryPropType: 'radar_dish', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/comms_tower_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    server_vault: { backgroundTitle: 'Mainframe Vault', furnitureAssetLabel: 'Blade Rack', primaryPropType: 'mainframe', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/server_vault_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    library: { backgroundTitle: 'Intel Archive', furnitureAssetLabel: 'Dossier Stacks', primaryPropType: 'bookshelves', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/library_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    armory: { backgroundTitle: 'Tactical Armory', furnitureAssetLabel: 'Armor Locker', primaryPropType: 'weapon_rack', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/armory_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    briefing_lounge: { backgroundTitle: 'Briefing Lounge', furnitureAssetLabel: 'Holo Table', primaryPropType: 'coffee_bar', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/briefing_lounge_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
    archive_basement: { backgroundTitle: 'Sub-Level Basement', furnitureAssetLabel: 'Vault Door', primaryPropType: 'vault_door', accentColor: '#38bdf8', backdropUrl: '/assets/rooms/archive_basement_clean.png', backdropFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)' },
  },
  ruby: {
    war_room: { backgroundTitle: 'Command Center', furnitureAssetLabel: 'Command Desk', primaryPropType: 'server_racks', accentColor: '#ef4444', backdropUrl: '/assets/rooms/war_room_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    comms_tower: { backgroundTitle: 'Comms Array', furnitureAssetLabel: 'Satellite Console', primaryPropType: 'radar_dish', accentColor: '#ef4444', backdropUrl: '/assets/rooms/comms_tower_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    server_vault: { backgroundTitle: 'Mainframe Vault', furnitureAssetLabel: 'Blade Rack', primaryPropType: 'mainframe', accentColor: '#ef4444', backdropUrl: '/assets/rooms/server_vault_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    library: { backgroundTitle: 'Intel Archive', furnitureAssetLabel: 'Dossier Stacks', primaryPropType: 'bookshelves', accentColor: '#ef4444', backdropUrl: '/assets/rooms/library_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    armory: { backgroundTitle: 'Tactical Armory', furnitureAssetLabel: 'Armor Locker', primaryPropType: 'weapon_rack', accentColor: '#ef4444', backdropUrl: '/assets/rooms/armory_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    briefing_lounge: { backgroundTitle: 'Briefing Lounge', furnitureAssetLabel: 'Holo Table', primaryPropType: 'coffee_bar', accentColor: '#ef4444', backdropUrl: '/assets/rooms/briefing_lounge_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
    archive_basement: { backgroundTitle: 'Sub-Level Basement', furnitureAssetLabel: 'Vault Door', primaryPropType: 'vault_door', accentColor: '#ef4444', backdropUrl: '/assets/rooms/archive_basement_clean.png', backdropFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)' },
  },
  purple: {
    war_room: { backgroundTitle: 'Command Center', furnitureAssetLabel: 'Command Desk', primaryPropType: 'server_racks', accentColor: '#c084fc', backdropUrl: '/assets/rooms/war_room_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    comms_tower: { backgroundTitle: 'Comms Array', furnitureAssetLabel: 'Satellite Console', primaryPropType: 'radar_dish', accentColor: '#c084fc', backdropUrl: '/assets/rooms/comms_tower_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    server_vault: { backgroundTitle: 'Mainframe Vault', furnitureAssetLabel: 'Blade Rack', primaryPropType: 'mainframe', accentColor: '#c084fc', backdropUrl: '/assets/rooms/server_vault_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    library: { backgroundTitle: 'Intel Archive', furnitureAssetLabel: 'Dossier Stacks', primaryPropType: 'bookshelves', accentColor: '#c084fc', backdropUrl: '/assets/rooms/library_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    armory: { backgroundTitle: 'Tactical Armory', furnitureAssetLabel: 'Armor Locker', primaryPropType: 'weapon_rack', accentColor: '#c084fc', backdropUrl: '/assets/rooms/armory_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    briefing_lounge: { backgroundTitle: 'Briefing Lounge', furnitureAssetLabel: 'Holo Table', primaryPropType: 'coffee_bar', accentColor: '#c084fc', backdropUrl: '/assets/rooms/briefing_lounge_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
    archive_basement: { backgroundTitle: 'Sub-Level Basement', furnitureAssetLabel: 'Vault Door', primaryPropType: 'vault_door', accentColor: '#c084fc', backdropUrl: '/assets/rooms/archive_basement_clean.png', backdropFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)' },
  },
};

const DEFAULT_AGENTS: AgentProfile[] = [
  {
    id: 'vance',
    name: 'Agent Vance',
    role: 'War Room Watch Commander',
    specialty: 'Multi-Source Pre-Media Threat Fusion & Executive SITREP Alerting',
    defaultStatus: 'Idle',
    primaryColor: '#4ade80',
    secondaryColor: '#334155',
    accessoryColor: '#f8fafc',
    gridX: 3,
    gridY: 4,
    bio: 'War Room C2 commander fusing municipal CAD, scanner traffic, ADS-B airspace, and geofenced sensors into corroborated threat alerts ahead of mainstream media.',
  },
  {
    id: 'nyx',
    name: 'Agent Nyx',
    role: 'Pre-Media SIGINT & Recon',
    specialty: 'Municipal 911 CAD, Radio Scanner Triage, NWS Polygons & Local Sensors',
    defaultStatus: 'Executing',
    primaryColor: '#38bdf8',
    secondaryColor: '#1e293b',
    accessoryColor: '#a5f3fc',
    gridX: 8,
    gridY: 3,
    bio: 'Comms Tower SIGINT listener continuously polling emergency dispatch CAD, live radio scanner transcripts, and geofenced hazard feeds.',
  },
  {
    id: 'cipher',
    name: 'Agent Cipher',
    role: 'Corroboration & RF Forensics',
    specialty: 'ADS-B Airspace Patterning, Plume Sensors, BGP/DNS Diffs & Vault Dossiers',
    defaultStatus: 'Patrol',
    primaryColor: '#34d399',
    secondaryColor: '#0f172a',
    accessoryColor: '#fde047',
    gridX: 6,
    gridY: 6,
    bio: 'Server Vault corroboration specialist cross-checking dispatch chatter against orbiting medevac/police ADS-B transponders, atmospheric plume spikes, and network telemetry.',
  },
];

export const THEMES: Record<ThemeId, ThemeConfig> = {
  green: {
    id: 'green',
    name: 'Phosphor Green',
    shortLabel: 'Green',
    tagline: 'Classic monochrome green phosphor display terminal',
    roomName: 'Sector Green · Terminal Bay',
    accentHex: '#4ade80',
    accentTextClass: 'text-emerald-400',
    accentBgClass: 'bg-emerald-500',
    accentBorderClass: 'border-emerald-500/40',
    surfaceBgHex: '#040d08',
    frameBorderStyle: 'border-emerald-900/60',
    floorTilePrimary: '#061a0f',
    floorTileSecondary: '#0a2919',
    wallColor: '#113d26',
    promptModifierSummary: 'Phosphor green terminal intelligence persona',
    quickDirectives: [
      'Sweep live pre-media municipal 911 CAD, NWS polygons, ADS-B airspace & plume sensors inside our geofence',
      'Scan overhead ADS-B transponders for orbiting medevac/police rotorcraft or emergency squawks',
      'Inspect active multi-source corroborated threat clusters and SHA-256 evidence provenance',
      'Triage live emergency radio scanner dispatch traffic for HAZMAT, lockdowns, or perimeter alerts',
    ],
    agents: DEFAULT_AGENTS,
    assets: {
      wallTextureStyle: 'linear-gradient(180deg, #113d26 0%, #040d08 100%)',
      floorPrimaryHex: '#061a0f',
      floorSecondaryHex: '#0a2919',
      furnitureSet: 'server_racks',
      uiBorderFrame: 'border-emerald-500/40 shadow-[0_0_20px_rgba(74,222,128,0.2)]',
      phosphorGlow: '0 0 20px rgba(74,222,128,0.35)',
      agentSpriteCssFilter: 'sepia(1) hue-rotate(60deg) saturate(3) brightness(0.9)',
    },
  },
  amber: {
    id: 'amber',
    name: 'Amber CRT',
    shortLabel: 'Amber',
    tagline: 'Warm vintage amber phosphor tactical display',
    roomName: 'Sector Amber · Terminal Bay',
    accentHex: '#f59e0b',
    accentTextClass: 'text-amber-400',
    accentBgClass: 'bg-amber-500',
    accentBorderClass: 'border-amber-500/40',
    surfaceBgHex: '#110d06',
    frameBorderStyle: 'border-amber-900/60',
    floorTilePrimary: '#1c150b',
    floorTileSecondary: '#281f10',
    wallColor: '#3a2d18',
    promptModifierSummary: 'Vintage amber terminal intelligence persona',
    quickDirectives: [
      'Schedule tactical reconnaissance on Calendar for Monday at dawn',
      'Send an encrypted dispatch to #ops-command on Slack',
      'Log a system repair ticket in pixelops/field-gear on GitHub',
      'Consult the vault for northern navigation charts',
    ],
    agents: DEFAULT_AGENTS,
    assets: {
      wallTextureStyle: 'linear-gradient(180deg, #3a2d18 0%, #110d06 100%)',
      floorPrimaryHex: '#1c150b',
      floorSecondaryHex: '#281f10',
      furnitureSet: 'neon_terminals',
      uiBorderFrame: 'border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.2)]',
      phosphorGlow: '0 0 20px rgba(245,158,11,0.35)',
      agentSpriteCssFilter: 'sepia(0.8) hue-rotate(-15deg) saturate(1.8) brightness(0.9)',
    },
  },
  cyan: {
    id: 'cyan',
    name: 'Neon Cyan',
    shortLabel: 'Cyan',
    tagline: 'High-contrast electric cyan and deep blue interface',
    roomName: 'Sector Cyan · Terminal Bay',
    accentHex: '#38bdf8',
    accentTextClass: 'text-cyan-400',
    accentBgClass: 'bg-cyan-500',
    accentBorderClass: 'border-cyan-500/40',
    surfaceBgHex: '#060f18',
    frameBorderStyle: 'border-cyan-900/60',
    floorTilePrimary: '#091828',
    floorTileSecondary: '#0e243c',
    wallColor: '#153456',
    promptModifierSummary: 'Electric cyan netrunner intelligence persona',
    quickDirectives: [
      'Schedule a dark-net node sync on Calendar for midnight',
      'Broadcast a packet leak warning to #ops-command on Slack',
      'Open a security vulnerability ticket in cyber/net-kernel on GitHub',
      'Query the encrypted vault for corporate dossiers',
    ],
    agents: DEFAULT_AGENTS,
    assets: {
      wallTextureStyle: 'linear-gradient(180deg, #153456 0%, #060f18 100%)',
      floorPrimaryHex: '#091828',
      floorSecondaryHex: '#0e243c',
      furnitureSet: 'neon_terminals',
      uiBorderFrame: 'border-cyan-500/40 shadow-[0_0_20px_rgba(56,189,248,0.2)]',
      phosphorGlow: '0 0 20px rgba(56,189,248,0.35)',
      agentSpriteCssFilter: 'hue-rotate(160deg) saturate(1.6) contrast(1.1)',
    },
  },
  ruby: {
    id: 'ruby',
    name: 'Crimson Ruby',
    shortLabel: 'Ruby',
    tagline: 'Striking crimson and dark obsidian interface',
    roomName: 'Sector Ruby · Terminal Bay',
    accentHex: '#ef4444',
    accentTextClass: 'text-red-400',
    accentBgClass: 'bg-red-500',
    accentBorderClass: 'border-red-500/40',
    surfaceBgHex: '#14080a',
    frameBorderStyle: 'border-red-900/60',
    floorTilePrimary: '#220e12',
    floorTileSecondary: '#32141a',
    wallColor: '#481d26',
    promptModifierSummary: 'Crimson tactical command intelligence persona',
    quickDirectives: [
      'Schedule a high-level strategy review on Calendar for Friday 14:00',
      'Send a threat sighting dispatch to #ops-command on Slack',
      'Log a critical firmware bug in pixelops/core-os on GitHub',
      'Search the research vault for rare asset data',
    ],
    agents: DEFAULT_AGENTS,
    assets: {
      wallTextureStyle: 'linear-gradient(180deg, #481d26 0%, #14080a 100%)',
      floorPrimaryHex: '#220e12',
      floorSecondaryHex: '#32141a',
      furnitureSet: 'server_racks',
      uiBorderFrame: 'border-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.2)]',
      phosphorGlow: '0 0 20px rgba(239,68,68,0.35)',
      agentSpriteCssFilter: 'hue-rotate(330deg) saturate(1.5) brightness(0.95)',
    },
  },
  purple: {
    id: 'purple',
    name: 'Amethyst Purple',
    shortLabel: 'Purple',
    tagline: 'Deep ultraviolet and vibrant amethyst interface',
    roomName: 'Sector Purple · Terminal Bay',
    accentHex: '#c084fc',
    accentTextClass: 'text-purple-400',
    accentBgClass: 'bg-purple-500',
    accentBorderClass: 'border-purple-500/40',
    surfaceBgHex: '#0d0814',
    frameBorderStyle: 'border-purple-900/60',
    floorTilePrimary: '#180e24',
    floorTileSecondary: '#241536',
    wallColor: '#351f4e',
    promptModifierSummary: 'Amethyst occult intelligence persona',
    quickDirectives: [
      'Schedule a classified briefing on Calendar for tomorrow at dusk',
      'Broadcast an encrypted dispatch to #ops-command on Slack',
      'Open a secure research ticket in arcane/core-runes on GitHub',
      'Query the esoteric vault for forbidden dossiers',
    ],
    agents: DEFAULT_AGENTS,
    assets: {
      wallTextureStyle: 'linear-gradient(180deg, #351f4e 0%, #0d0814 100%)',
      floorPrimaryHex: '#180e24',
      floorSecondaryHex: '#241536',
      furnitureSet: 'bookshelves',
      uiBorderFrame: 'border-purple-500/40 shadow-[0_0_20px_rgba(192,132,252,0.2)]',
      phosphorGlow: '0 0 20px rgba(192,132,252,0.35)',
      agentSpriteCssFilter: 'hue-rotate(240deg) saturate(1.5) brightness(0.95)',
    },
  },
};

export interface CustomThemeColorConfig {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
  hex: string; // e.g. '#4ade80'
  ambientBrightness: number; // 0.65..1.35 (default 1.0)
  ambientSaturation: number; // 0.5..2.0 (default 1.15)
  ambientGlowIntensity: number; // 0..1.0 (default 0.45)
  isCustomOverride: boolean;
}

export function clampChannel(val: number, min: number, max: number): number {
  if (Number.isNaN(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clampChannel(n, 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

export function rgbToHsl(
  rIn: number,
  gIn: number,
  bIn: number
): { h: number; s: number; l: number } {
  const r = clampChannel(rIn, 0, 255) / 255;
  const g = clampChannel(gIn, 0, 255) / 255;
  const b = clampChannel(bIn, 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb(
  hIn: number,
  sIn: number,
  lIn: number
): { r: number; g: number; b: number } {
  const h = (((hIn % 360) + 360) % 360) / 360;
  const s = clampChannel(sIn, 0, 100) / 100;
  const l = clampChannel(lIn, 0, 100) / 100;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return { r, g, b };
}

export function buildColorConfigFromHex(
  hex: string,
  overrides?: Partial<CustomThemeColorConfig>
): CustomThemeColorConfig {
  const parsed = hexToRgb(hex) || { r: 74, g: 222, b: 128 };
  const hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);
  return {
    r: parsed.r,
    g: parsed.g,
    b: parsed.b,
    h: hsl.h,
    s: hsl.s,
    l: hsl.l,
    hex: rgbToHex(parsed.r, parsed.g, parsed.b),
    ambientBrightness: overrides?.ambientBrightness ?? 1.0,
    ambientSaturation: overrides?.ambientSaturation ?? 1.12,
    ambientGlowIntensity: overrides?.ambientGlowIntensity ?? 0.45,
    isCustomOverride: overrides?.isCustomOverride ?? false,
  };
}

/**
 * Baseline safehouse room pixel art has a warm-amber/teal base (~140deg phosphor reference).
 * Computing the relative hue shift lets `hue-rotate()`, `brightness()`, `saturate()`, and `drop-shadow()`
 * tint the room canvas wrapper smoothly without distorting pixel definition.
 */
export function computeRoomCanvasFilter(color: CustomThemeColorConfig): {
  hueRotateDeg: number;
  filterCss: string;
} {
  // Reference hue 142deg (Phosphor Green baseline) -> 0deg shift when default green is active
  const baseHue = 142;
  const rawDelta = color.h - baseHue;
  const hueRotateDeg = ((rawDelta + 540) % 360) - 180;
  const brightness = Number(color.ambientBrightness.toFixed(2));
  const saturate = Number(color.ambientSaturation.toFixed(2));
  const glowAlpha = Number(Math.max(0.08, Math.min(0.85, color.ambientGlowIntensity)).toFixed(2));
  const dropShadowRadius = Math.round(8 + glowAlpha * 14);

  const filterCss = `hue-rotate(${hueRotateDeg}deg) brightness(${brightness}) saturate(${saturate}) drop-shadow(0 0 ${dropShadowRadius}px rgba(${color.r}, ${color.g}, ${color.b}, ${glowAlpha}))`;
  return { hueRotateDeg, filterCss };
}

interface ThemeContextValue {
  themeId: ThemeId;
  theme: ThemeConfig;
  setThemeId: (id: ThemeId) => void;
  customColor: CustomThemeColorConfig;
  setCustomRgb: (r: number, g: number, b: number) => void;
  setCustomHsl: (h: number, s: number, l: number) => void;
  setCustomHex: (hex: string) => void;
  setAmbientFilterParams: (params: {
    ambientBrightness?: number;
    ambientSaturation?: number;
    ambientGlowIntensity?: number;
  }) => void;
  resetCustomColorToTheme: () => void;
  roomCanvasFilter: string;
  activeAgent: AgentProfile;
  setActiveAgentId: (id: string) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  playBeep: (type: 'tap' | 'complete' | 'tick' | 'switch' | 'error') => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_THEME_KEY = 'pixelops_active_theme_v1';
const STORAGE_SOUND_KEY = 'pixelops_sound_enabled_v1';
const STORAGE_ACTIVE_AGENT_KEY = 'pixelops_active_agent_id_v1';
export const STORAGE_CUSTOM_THEME_RGB_KEY = 'pixelops_custom_theme_rgb_v1';

let sharedAudioCtx: AudioContext | null = null;
function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_THEME_KEY);
      if (saved && THEMES[saved as ThemeId]) {
        return saved as ThemeId;
      }
    } catch {
      // Ignore storage access errors in sandboxed iframes
    }
    return 'green';
  });

  const theme = THEMES[themeId] || THEMES.green;

  const [customColor, setCustomColorState] = useState<CustomThemeColorConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CUSTOM_THEME_RGB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CustomThemeColorConfig>;
        if (
          typeof parsed.r === 'number' &&
          typeof parsed.g === 'number' &&
          typeof parsed.b === 'number'
        ) {
          const r = clampChannel(parsed.r, 0, 255);
          const g = clampChannel(parsed.g, 0, 255);
          const b = clampChannel(parsed.b, 0, 255);
          const hsl = rgbToHsl(r, g, b);
          return {
            r,
            g,
            b,
            h: typeof parsed.h === 'number' ? clampChannel(parsed.h, 0, 360) : hsl.h,
            s: typeof parsed.s === 'number' ? clampChannel(parsed.s, 0, 100) : hsl.s,
            l: typeof parsed.l === 'number' ? clampChannel(parsed.l, 0, 100) : hsl.l,
            hex: rgbToHex(r, g, b),
            ambientBrightness:
              typeof parsed.ambientBrightness === 'number' ? parsed.ambientBrightness : 1.0,
            ambientSaturation:
              typeof parsed.ambientSaturation === 'number' ? parsed.ambientSaturation : 1.12,
            ambientGlowIntensity:
              typeof parsed.ambientGlowIntensity === 'number'
                ? parsed.ambientGlowIntensity
                : 0.45,
            isCustomOverride: Boolean(parsed.isCustomOverride),
          };
        }
      }
    } catch {
      // Ignore corrupt storage
    }
    return buildColorConfigFromHex(theme.accentHex);
  });

  const persistCustomColor = useCallback((next: CustomThemeColorConfig) => {
    setCustomColorState(next);
    try {
      localStorage.setItem(STORAGE_CUSTOM_THEME_RGB_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }, []);

  // Inject dynamic CSS variables and room filter onto document.documentElement whenever customColor changes
  const { hueRotateDeg, filterCss: roomCanvasFilter } = computeRoomCanvasFilter(customColor);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const rgbTuple = `${customColor.r}, ${customColor.g}, ${customColor.b}`;
    const glowAlpha = Math.max(0.15, Math.min(0.9, customColor.ambientGlowIntensity));
    const softAlpha = Math.max(0.08, Math.min(0.45, glowAlpha * 0.45));

    root.style.setProperty('--theme-primary-rgb', rgbTuple);
    root.style.setProperty('--theme-primary-hex', customColor.hex);
    root.style.setProperty(
      '--theme-glow-color',
      `rgba(${rgbTuple}, ${glowAlpha.toFixed(2)})`
    );
    root.style.setProperty(
      '--theme-glow-soft',
      `rgba(${rgbTuple}, ${softAlpha.toFixed(2)})`
    );
    root.style.setProperty(
      '--theme-border-color',
      `rgba(${rgbTuple}, ${Math.min(0.95, glowAlpha + 0.25).toFixed(2)})`
    );
    root.style.setProperty('--theme-hue-rotate', `${hueRotateDeg}deg`);
    root.style.setProperty('--theme-room-filter', roomCanvasFilter);
  }, [customColor, hueRotateDeg, roomCanvasFilter]);

  const setCustomRgb = useCallback(
    (rIn: number, gIn: number, bIn: number) => {
      const r = clampChannel(rIn, 0, 255);
      const g = clampChannel(gIn, 0, 255);
      const b = clampChannel(bIn, 0, 255);
      const hsl = rgbToHsl(r, g, b);
      persistCustomColor({
        ...customColor,
        r,
        g,
        b,
        h: hsl.h,
        s: hsl.s,
        l: hsl.l,
        hex: rgbToHex(r, g, b),
        isCustomOverride: true,
      });
    },
    [customColor, persistCustomColor]
  );

  const setCustomHsl = useCallback(
    (hIn: number, sIn: number, lIn: number) => {
      const h = clampChannel(hIn, 0, 360);
      const s = clampChannel(sIn, 0, 100);
      const l = clampChannel(lIn, 0, 100);
      const rgb = hslToRgb(h, s, l);
      persistCustomColor({
        ...customColor,
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        h,
        s,
        l,
        hex: rgbToHex(rgb.r, rgb.g, rgb.b),
        isCustomOverride: true,
      });
    },
    [customColor, persistCustomColor]
  );

  const setCustomHex = useCallback(
    (hexIn: string) => {
      const rgb = hexToRgb(hexIn);
      if (!rgb) return;
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      persistCustomColor({
        ...customColor,
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        h: hsl.h,
        s: hsl.s,
        l: hsl.l,
        hex: rgbToHex(rgb.r, rgb.g, rgb.b),
        isCustomOverride: true,
      });
    },
    [customColor, persistCustomColor]
  );

  const setAmbientFilterParams = useCallback(
    (params: {
      ambientBrightness?: number;
      ambientSaturation?: number;
      ambientGlowIntensity?: number;
    }) => {
      persistCustomColor({
        ...customColor,
        ambientBrightness:
          params.ambientBrightness !== undefined
            ? Math.max(0.6, Math.min(1.4, params.ambientBrightness))
            : customColor.ambientBrightness,
        ambientSaturation:
          params.ambientSaturation !== undefined
            ? Math.max(0.4, Math.min(2.2, params.ambientSaturation))
            : customColor.ambientSaturation,
        ambientGlowIntensity:
          params.ambientGlowIntensity !== undefined
            ? Math.max(0.05, Math.min(1.0, params.ambientGlowIntensity))
            : customColor.ambientGlowIntensity,
        isCustomOverride: true,
      });
    },
    [customColor, persistCustomColor]
  );

  const resetCustomColorToTheme = useCallback(() => {
    const next = buildColorConfigFromHex(THEMES[themeId].accentHex, {
      ambientBrightness: 1.0,
      ambientSaturation: 1.12,
      ambientGlowIntensity: 0.45,
      isCustomOverride: false,
    });
    persistCustomColor(next);
  }, [themeId, persistCustomColor]);

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SOUND_KEY);
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const [activeAgentId, setActiveAgentIdState] = useState<string>(() => {
    try {
      const savedAgent = localStorage.getItem(STORAGE_ACTIVE_AGENT_KEY);
      if (
        savedAgent &&
        (theme.agents.some((a) => a.id === savedAgent) || savedAgent.startsWith('rec_'))
      ) {
        return savedAgent;
      }
    } catch {
      // Ignore storage access errors in sandboxed iframes
    }
    return theme.agents[0].id;
  });

  const setActiveAgentId = useCallback((id: string) => {
    setActiveAgentIdState(id);
    try {
      localStorage.setItem(STORAGE_ACTIVE_AGENT_KEY, id);
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    if (
      !theme.agents.some((a) => a.id === activeAgentId) &&
      !activeAgentId.startsWith('rec_')
    ) {
      setActiveAgentId(theme.agents[0].id);
    }
  }, [theme, activeAgentId, setActiveAgentId]);

  const playBeep = useCallback(
    (type: 'tap' | 'complete' | 'tick' | 'switch' | 'error') => {
      if (!soundEnabled || typeof window === 'undefined') return;
      try {
        const ctx = getSharedAudioContext();
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type === 'error' ? 'sawtooth' : 'square';
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'tick') {
          osc.frequency.setValueAtTime(680, now);
          gain.gain.setValueAtTime(0.015, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
          osc.start(now);
          osc.stop(now + 0.025);
        } else if (type === 'tap') {
          osc.frequency.setValueAtTime(520, now);
          gain.gain.setValueAtTime(0.035, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
          osc.start(now);
          osc.stop(now + 0.06);
        } else if (type === 'switch') {
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.setValueAtTime(660, now + 0.06);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
          osc.start(now);
          osc.stop(now + 0.14);
        } else if (type === 'complete') {
          osc.frequency.setValueAtTime(587.33, now);
          osc.frequency.setValueAtTime(880, now + 0.08);
          gain.gain.setValueAtTime(0.05, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.22);
        } else if (type === 'error') {
          osc.frequency.setValueAtTime(220, now);
          osc.frequency.setValueAtTime(155, now + 0.11);
          osc.frequency.setValueAtTime(195, now + 0.22);
          osc.frequency.setValueAtTime(130, now + 0.32);
          gain.gain.setValueAtTime(0.055, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
          osc.start(now);
          osc.stop(now + 0.44);
        }
      } catch {
        // Ignore audio errors when user hasn't interacted yet
      }
    },
    [soundEnabled]
  );

  const setThemeId = (id: ThemeId) => {
    setThemeIdState(id);
    try {
      localStorage.setItem(STORAGE_THEME_KEY, id);
    } catch {
      // Ignore storage errors
    }
    setActiveAgentId(THEMES[id].agents[0].id);
    // Sync custom RGB/HSL engine to the selected preset's phosphor accent
    const nextColor = buildColorConfigFromHex(THEMES[id].accentHex, {
      ambientBrightness: customColor.ambientBrightness,
      ambientSaturation: customColor.ambientSaturation,
      ambientGlowIntensity: customColor.ambientGlowIntensity,
      isCustomOverride: false,
    });
    persistCustomColor(nextColor);
    playBeep('switch');
  };

  const setSoundEnabled = (enabled: boolean) => {
    setSoundEnabledState(enabled);
    try {
      localStorage.setItem(STORAGE_SOUND_KEY, String(enabled));
    } catch {
      // Ignore storage errors
    }
  };

  const activeAgent: AgentProfile =
    theme.agents.find((a) => a.id === activeAgentId) || {
      ...theme.agents[0],
      id: activeAgentId,
    };

  return (
    <ThemeContext.Provider
      value={{
        themeId,
        theme,
        setThemeId,
        customColor,
        setCustomRgb,
        setCustomHsl,
        setCustomHex,
        setAmbientFilterParams,
        resetCustomColorToTheme,
        roomCanvasFilter,
        activeAgent,
        setActiveAgentId,
        soundEnabled,
        setSoundEnabled,
        playBeep,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

