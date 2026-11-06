import React, { useState, useEffect, useMemo } from 'react';
import {
  Crosshair,
  Globe,
  Layers,
  ZoomIn,
  ZoomOut,
  Compass,
  Radar,
  Calendar,
  Eye,
  Send,
  Terminal,
  RefreshCw,
} from 'lucide-react';

export type SatelliteFeedLayerId =
  | 'nasa_gibs_modis_terra'
  | 'nasa_gibs_viirs_snpp'
  | 'esri_world_imagery';

export type PhosphorShaderMode = 'green_nvg' | 'amber_crt' | 'thermal_flir' | 'true_color';

export interface TacticalTargetPreset {
  id: string;
  label: string;
  sectorCode: string;
  lat: number;
  lon: number;
  defaultZoom: number;
  telemetryNote: string;
}

export const TACTICAL_SECTOR_PRESETS: TacticalTargetPreset[] = [
  {
    id: 'north_america',
    label: 'US-East Backbone & PJM Grid (Ashburn, VA)',
    sectorCode: 'SECTOR-14 // CONUS-EAST',
    lat: 39.0438,
    lon: -77.4874,
    defaultZoom: 7,
    telemetryNote: 'Equinix Ashburn IXP & PJM high-voltage transmission corridor.',
  },
  {
    id: 'med_red_sea',
    label: 'Suez Canal & Red Sea Subsea Cable Corridor',
    sectorCode: 'SECTOR-54 // SUEZ-CHOKELINE',
    lat: 30.5852,
    lon: 32.2654,
    defaultZoom: 7,
    telemetryNote: 'AAE-1 / SEACOM / EIG submarine fiber trunk & maritime transit chokepoint.',
  },
  {
    id: 'western_europe',
    label: 'DE-CIX Frankfurt & ENTSO-E Core Grid',
    sectorCode: 'SECTOR-22 // EU-CENTRAL',
    lat: 50.1109,
    lon: 8.6821,
    defaultZoom: 7,
    telemetryNote: 'European continental synchronous grid & primary internet exchange node.',
  },
  {
    id: 'strait_hormuz',
    label: 'Strait of Hormuz & Persian Gulf Energy Corridor',
    sectorCode: 'SECTOR-39 // HORMUZ-WATCH',
    lat: 26.5667,
    lon: 56.25,
    defaultZoom: 7,
    telemetryNote: 'AIS tanker chokepoint & regional GNSS L1 interference zone.',
  },
  {
    id: 'indo_pacific',
    label: 'Strait of Malacca & Singapore Maritime Hub',
    sectorCode: 'SECTOR-71 // APAC-MALACCA',
    lat: 1.3521,
    lon: 103.8198,
    defaultZoom: 7,
    telemetryNote: 'Trans-Pacific / Intra-Asia submarine cable landing & container port hub.',
  },
  {
    id: 'taiwan_strait',
    label: 'Taiwan Strait & Hsinchu Semiconductor Sector',
    sectorCode: 'SECTOR-88 // APAC-NORTH',
    lat: 24.8138,
    lon: 120.9675,
    defaultZoom: 7,
    telemetryNote: 'Foundry power grid stability & high-density ADIZ/maritime telemetry.',
  },
];

/**
 * Web Mercator (EPSG:3857) Slippy Map Tile Math:
 * Converts (latitude, longitude, zoom) -> fractional and integer (x, y, z) tile coordinates.
 */
export function latLonToTileXYZ(lat: number, lon: number, zoom: number): {
  x: number;
  y: number;
  z: number;
  fracX: number;
  fracY: number;
} {
  const z = Math.max(1, Math.min(17, Math.round(zoom)));
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const n = Math.pow(2, z);

  const exactX = ((lon + 180) / 360) * n;
  const exactY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const x = ((Math.floor(exactX) % n) + n) % n;
  const y = Math.max(0, Math.min(n - 1, Math.floor(exactY)));

  return {
    x,
    y,
    z,
    fracX: exactX - Math.floor(exactX),
    fracY: exactY - Math.floor(exactY),
  };
}

/**
 * Parses natural language directives or sector commands into target coordinates.
 * e.g. "Inspect grid stability coordinates near Sector 54" or "30.04, 31.23" or "Frankfurt"
 */
export function parseReconTargetToCoords(input: string): {
  lat: number;
  lon: number;
  label: string;
  sectorCode: string;
  zoom?: number;
} | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // 1. Explicit lat, lon pair (e.g. "30.58, 32.26" or "38.90N 77.03W")
  const coordRegex = /(-?\d{1,2}(?:\.\d+)?)\s*([NSns])?\s*[,/\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*([EWew])?/;
  const match = raw.match(coordRegex);
  if (match) {
    let lat = parseFloat(match[1]);
    let lon = parseFloat(match[3]);
    if (match[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (match[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return {
        lat,
        lon,
        label: `Custom Target (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`,
        sectorCode: 'SECTOR-CUSTOM // LOCKED',
      };
    }
  }

  const lower = raw.toLowerCase();

  // 2. Named Sector Numbers or Keywords
  if (lower.includes('sector 54') || lower.includes('suez') || lower.includes('red sea') || lower.includes('cairo') || lower.includes('egypt')) {
    return TACTICAL_SECTOR_PRESETS[1];
  }
  if (lower.includes('sector 14') || lower.includes('ashburn') || lower.includes('virginia') || lower.includes('washington') || lower.includes('us-east')) {
    return TACTICAL_SECTOR_PRESETS[0];
  }
  if (lower.includes('sector 22') || lower.includes('frankfurt') || lower.includes('germany') || lower.includes('europe')) {
    return TACTICAL_SECTOR_PRESETS[2];
  }
  if (lower.includes('sector 39') || lower.includes('hormuz') || lower.includes('persian gulf') || lower.includes('dubai')) {
    return TACTICAL_SECTOR_PRESETS[3];
  }
  if (lower.includes('sector 71') || lower.includes('malacca') || lower.includes('singapore')) {
    return TACTICAL_SECTOR_PRESETS[4];
  }
  if (lower.includes('sector 88') || lower.includes('taiwan') || lower.includes('taipei') || lower.includes('hsinchu')) {
    return TACTICAL_SECTOR_PRESETS[5];
  }
  if (lower.includes('london') || lower.includes('uk')) {
    return { lat: 51.5074, lon: -0.1278, label: 'LINX London & UK Grid Sector', sectorCode: 'SECTOR-24 // UK-CORE', zoom: 8 };
  }
  if (lower.includes('tokyo') || lower.includes('japan')) {
    return { lat: 35.6762, lon: 139.6503, label: 'TEPCO Tokyo & Trans-Pacific Cable Hub', sectorCode: 'SECTOR-79 // JP-EAST', zoom: 8 };
  }
  if (lower.includes('new york') || lower.includes('nyc')) {
    return { lat: 40.7128, lon: -74.006, label: 'NYISO Grid & Trans-Atlantic Landing', sectorCode: 'SECTOR-12 // NY-METRO', zoom: 8 };
  }
  if (lower.includes('los angeles') || lower.includes('long beach') || lower.includes('california')) {
    return { lat: 33.7405, lon: -118.2719, label: 'Port of Los Angeles / Long Beach Chokepoint', sectorCode: 'SECTOR-19 // US-WEST', zoom: 8 };
  }
  if (lower.includes('panama')) {
    return { lat: 9.08, lon: -79.68, label: 'Panama Canal Maritime Lock Complex', sectorCode: 'SECTOR-44 // PANAMA', zoom: 8 };
  }

  return null;
}

/**
 * Returns default ISO date string (YYYY-MM-DD) for NASA GIBS daily imagery (yesterday UTC guarantees complete global orbital swath).
 */
function getDefaultNasaGibsDate(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

/**
 * Builds the zero-key tile URL for either NASA GIBS WMTS or Esri World Imagery XYZ.
 */
export function buildSatelliteTileUrl(
  layer: SatelliteFeedLayerId,
  z: number,
  y: number,
  x: number,
  dateStr: string
): string {
  if (layer === 'nasa_gibs_modis_terra') {
    // NASA GIBS MODIS_Terra_CorrectedReflectance_TrueColor supports GoogleMapsCompatible_Level9 (z <= 9)
    const clampedZ = Math.min(9, Math.max(1, z));
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/${clampedZ}/${y}/${x}.jpg`;
  }
  if (layer === 'nasa_gibs_viirs_snpp') {
    const clampedZ = Math.min(9, Math.max(1, z));
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/${clampedZ}/${y}/${x}.jpg`;
  }
  // Esri World Imagery (high-resolution down to street level z=17, zero key required)
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

export interface TacticalSatelliteMonitorProps {
  initialLat?: number;
  initialLon?: number;
  initialLabel?: string;
  initialSectorCode?: string;
  activeOperativeName?: string;
  threatBadgeText?: string;
  onDispatchReconDirective?: (directive: string, coords: { lat: number; lon: number; label: string }) => void;
  compact?: boolean;
}

export const TacticalSatelliteMonitor: React.FC<TacticalSatelliteMonitorProps> = ({
  initialLat = 30.5852,
  initialLon = 32.2654,
  initialLabel = 'Suez Canal & Red Sea Subsea Cable Corridor',
  initialSectorCode = 'SECTOR-54 // SUEZ-CHOKELINE',
  activeOperativeName = 'Agent Nyx',
  threatBadgeText = 'THREAT LEVEL: BRAVO - REGIONAL GRID STRAIN',
  onDispatchReconDirective,
  compact = false,
}) => {
  const [lat, setLat] = useState<number>(initialLat);
  const [lon, setLon] = useState<number>(initialLon);
  const [targetLabel, setTargetLabel] = useState<string>(initialLabel);
  const [sectorCode, setSectorCode] = useState<string>(initialSectorCode);
  const [zoom, setZoom] = useState<number>(7);
  const [feedLayer, setFeedLayer] = useState<SatelliteFeedLayerId>('nasa_gibs_modis_terra');
  const [shaderMode, setShaderMode] = useState<PhosphorShaderMode>('green_nvg');
  const [gibsDate, setGibsDate] = useState<string>(getDefaultNasaGibsDate);
  const [commandInput, setCommandInput] = useState<string>('');
  const [isFlyToLocking, setIsFlyToLocking] = useState<boolean>(false);
  const [tileErrors, setTileErrors] = useState<Record<string, boolean>>({});

  // Sync when parent props change (e.g. Operational Zone dropdown in ThreatMonitorModal)
  useEffect(() => {
    setIsFlyToLocking(true);
    setLat(initialLat);
    setLon(initialLon);
    if (initialLabel) setTargetLabel(initialLabel);
    if (initialSectorCode) setSectorCode(initialSectorCode);
    const t = setTimeout(() => setIsFlyToLocking(false), 650);
    return () => clearTimeout(t);
  }, [initialLat, initialLon, initialLabel, initialSectorCode]);

  // Automatically clamp zoom to 9 when using NASA GIBS Level9 layers, or allow up to 16 on Esri World Imagery
  const effectiveZoom = useMemo(() => {
    if (feedLayer.startsWith('nasa_gibs_')) {
      return Math.min(9, Math.max(2, zoom));
    }
    return Math.min(16, Math.max(2, zoom));
  }, [feedLayer, zoom]);

  const centerTile = useMemo(
    () => latLonToTileXYZ(lat, lon, effectiveZoom),
    [lat, lon, effectiveZoom]
  );

  // Build 3x3 surrounding tile matrix for seamless wide tactical raster viewport
  const tileGrid = useMemo(() => {
    const n = Math.pow(2, centerTile.z);
    const tiles: Array<{
      rowOffset: number;
      colOffset: number;
      x: number;
      y: number;
      z: number;
      url: string;
      fallbackEsriUrl: string;
      key: string;
    }> = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tileX = ((centerTile.x + dx) % n + n) % n;
        const tileY = Math.max(0, Math.min(n - 1, centerTile.y + dy));
        const url = buildSatelliteTileUrl(feedLayer, centerTile.z, tileY, tileX, gibsDate);
        const fallbackEsriUrl = buildSatelliteTileUrl('esri_world_imagery', centerTile.z, tileY, tileX, gibsDate);
        tiles.push({
          rowOffset: dy,
          colOffset: dx,
          x: tileX,
          y: tileY,
          z: centerTile.z,
          url,
          fallbackEsriUrl,
          key: `${feedLayer}_${gibsDate}_${centerTile.z}_${tileY}_${tileX}`,
        });
      }
    }
    return tiles;
  }, [centerTile, feedLayer, gibsDate]);

  const handleSelectPreset = (preset: TacticalTargetPreset) => {
    setIsFlyToLocking(true);
    setLat(preset.lat);
    setLon(preset.lon);
    setTargetLabel(preset.label);
    setSectorCode(preset.sectorCode);
    setZoom(preset.defaultZoom);
    setTimeout(() => setIsFlyToLocking(false), 650);
  };

  const handleCommandLockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;

    const parsed = parseReconTargetToCoords(commandInput);
    if (parsed) {
      setIsFlyToLocking(true);
      setLat(parsed.lat);
      setLon(parsed.lon);
      setTargetLabel(parsed.label);
      setSectorCode(parsed.sectorCode);
      if (parsed.zoom) setZoom(parsed.zoom);
      setTimeout(() => setIsFlyToLocking(false), 650);
    }

    if (onDispatchReconDirective) {
      const targetCoords = parsed || { lat, lon, label: targetLabel };
      onDispatchReconDirective(commandInput.trim(), targetCoords);
    }
  };

  const panByDegrees = (dLat: number, dLon: number) => {
    const scale = Math.max(0.05, 8 / Math.pow(2, effectiveZoom - 3));
    setLat((prev) => Math.max(-84, Math.min(84, Number((prev + dLat * scale).toFixed(4)))));
    setLon((prev) => {
      let next = prev + dLon * scale;
      if (next > 180) next -= 360;
      if (next < -180) next += 360;
      return Number(next.toFixed(4));
    });
  };

  const shaderClass =
    shaderMode === 'amber_crt'
      ? 'phosphor-amber'
      : shaderMode === 'thermal_flir'
      ? 'phosphor-thermal'
      : shaderMode === 'true_color'
      ? 'phosphor-truecolor'
      : '';

  return (
    <div className="w-full bg-[#070b11] border-2 border-emerald-500/60 rounded-lg shadow-[0_0_35px_rgba(16,185,129,0.2)] overflow-hidden font-mono text-slate-100">
      {/* Top Recon Monitor Control Header */}
      <div className="px-3.5 py-2.5 bg-gradient-to-r from-[#06120e] via-[#0b1f17] to-[#06120e] border-b border-emerald-500/40 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300">
            <Radar className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-bold tracking-wider uppercase text-emerald-300">
                🛰️ TACTICAL SATELLITE RECON MONITOR // NASA GIBS &amp; ESRI ORBITAL FEED
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                ZERO-KEY LIVE WMTS
              </span>
            </div>
            <p className="text-[10px] text-emerald-400/80">
              {sectorCode} • Target Lock: {targetLabel} ({lat.toFixed(4)}°, {lon.toFixed(4)}°) • Tile [Z:{centerTile.z} Y:{centerTile.y} X:{centerTile.x}]
            </p>
          </div>
        </div>

        {/* Feed Layer & Shader Mode Switchers */}
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={feedLayer}
            onChange={(e) => {
              const nextLayer = e.target.value as SatelliteFeedLayerId;
              setFeedLayer(nextLayer);
              if (nextLayer === 'esri_world_imagery' && zoom < 11) {
                setZoom(12);
              } else if (nextLayer.startsWith('nasa_gibs_') && zoom > 9) {
                setZoom(8);
              }
            }}
            className="px-2 py-1 text-[11px] bg-[#040a07] border border-emerald-500/50 rounded text-emerald-200 focus:outline-none"
            title="Select Zero-Key Satellite Imagery Source"
          >
            <option value="nasa_gibs_modis_terra">NASA GIBS: MODIS Terra TrueColor (Daily Weather/Plumes)</option>
            <option value="nasa_gibs_viirs_snpp">NASA GIBS: Suomi NPP VIIRS TrueColor (Daily Orbital)</option>
            <option value="esri_world_imagery">Esri World Imagery (High-Res Street/Facility Level)</option>
          </select>

          <select
            value={shaderMode}
            onChange={(e) => setShaderMode(e.target.value as PhosphorShaderMode)}
            className="px-2 py-1 text-[11px] bg-[#040a07] border border-emerald-500/50 rounded text-emerald-200 focus:outline-none"
            title="Select Tactical CRT / Phosphor Filter"
          >
            <option value="green_nvg">CRT Green Night-Vision (NVG)</option>
            <option value="amber_crt">Amber Phosphor Command CRT</option>
            <option value="thermal_flir">Thermal / FLIR Inversion</option>
            <option value="true_color">Raw True-Color Optical</option>
          </select>

          {feedLayer.startsWith('nasa_gibs_') && (
            <div className="flex items-center gap-1 bg-[#040a07] border border-emerald-500/40 rounded px-1.5 py-0.5">
              <Calendar className="w-3 h-3 text-emerald-400" />
              <input
                type="date"
                value={gibsDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setGibsDate(e.target.value || getDefaultNasaGibsDate())}
                className="bg-transparent text-[10px] text-emerald-200 focus:outline-none"
                title="NASA GIBS Orbital Pass Date"
              />
            </div>
          )}
        </div>
      </div>

      {/* Quick Sector Coordinate Lock Bar + Agent Coordinate Binding Input */}
      <div className="px-3.5 py-2 bg-[#0a1118] border-b border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] uppercase font-bold text-emerald-400 shrink-0 mr-1 flex items-center gap-1">
            <Compass className="w-3 h-3" /> Lock Sector:
          </span>
          {TACTICAL_SECTOR_PRESETS.map((preset) => {
            const isSelected =
              Math.abs(preset.lat - lat) < 0.05 && Math.abs(preset.lon - lon) < 0.05;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-2 py-1 rounded text-[10px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400'
                    : 'bg-slate-900 text-slate-400 hover:text-emerald-200 border border-slate-800'
                }`}
              >
                {preset.sectorCode.split(' // ')[0]} ({preset.label.split(' (')[0].slice(0, 18)})
              </button>
            );
          })}
        </div>

        {/* Agent Coordinate Fly-To Directive Input */}
        <form onSubmit={handleCommandLockSubmit} className="flex items-center gap-1.5 shrink-0">
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder='e.g. "Inspect grid near Sector 54" or 30.58, 32.26'
            className="w-full sm:w-64 px-2.5 py-1 text-[11px] bg-slate-950 border border-emerald-500/40 rounded text-emerald-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/60 text-emerald-200 text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer"
            title="Fly-to coordinates and lock agent telemetry"
          >
            <Crosshair className="w-3 h-3" />
            <span>Lock / Recon</span>
          </button>
        </form>
      </div>

      {/* Main 2D Tactical Raster Viewport + Night-Vision CRT Shader + Radar Overlay */}
      <div className={`relative w-full ${compact ? 'h-72 sm:h-80' : 'h-80 sm:h-[420px]'} bg-[#020804] select-none overflow-hidden`}>
        {/* Filtered Tile Raster Container (.tactical-satellite-monitor) */}
        <div className={`tactical-satellite-monitor ${shaderClass} w-full h-full relative`}>
          <div className="grid grid-cols-3 grid-rows-3 w-full h-full">
            {tileGrid.map((tile) => {
              const useFallback = tileErrors[tile.key];
              return (
                <div key={tile.key} className="relative w-full h-full overflow-hidden bg-[#030b06]">
                  <img
                    src={useFallback ? tile.fallbackEsriUrl : tile.url}
                    alt={`Satellite Tile Z${tile.z} Y${tile.y} X${tile.x}`}
                    crossOrigin="anonymous"
                    loading="eager"
                    onError={() => {
                      if (!useFallback) {
                        setTileErrors((prev) => ({ ...prev, [tile.key]: true }));
                      }
                    }}
                    className="w-full h-full object-cover block"
                  />
                  {/* Subtle Tile Grid Coordinate Watermark */}
                  <span className="absolute bottom-1 right-1.5 text-[8px] text-emerald-300/50 font-mono pointer-events-none">
                    [{tile.z}/{tile.y}/{tile.x}]
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tactical HUD Overlays (Rendered above the CSS filter so HUD text & vector boxes stay razor-sharp) */}
        <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3">
          {/* Top-Left & Top-Right HUD Telemetry Callouts */}
          <div className="flex items-start justify-between gap-2">
            <div className="bg-black/75 border border-emerald-500/60 px-2.5 py-1.5 rounded text-[10px] text-emerald-300 space-y-0.5 shadow-[0_0_15px_rgba(0,0,0,0.8)]">
              <div className="font-bold text-emerald-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>ORBITAL FEED: {feedLayer === 'esri_world_imagery' ? 'ESRI WORLD IMAGERY (HI-RES)' : 'NASA GIBS WMTS (MODIS/VIIRS)'}</span>
              </div>
              <div>
                LAT: <strong className="text-white">{lat.toFixed(4)}°</strong> | LON:{' '}
                <strong className="text-white">{lon.toFixed(4)}°</strong> | ZOOM:{' '}
                <strong className="text-white">L{effectiveZoom}</strong>
              </div>
              <div className="text-emerald-400/90">
                WMTS TILE: X={centerTile.x}, Y={centerTile.y}, Z={centerTile.z}
              </div>
            </div>

            <div className="bg-black/75 border border-amber-500/60 px-2.5 py-1.5 rounded text-[10px] text-amber-300 text-right shadow-[0_0_15px_rgba(0,0,0,0.8)]">
              <div className="font-bold uppercase">{threatBadgeText}</div>
              <div className="text-emerald-300">OPERATIVE OVERWATCH: {activeOperativeName.toUpperCase()}</div>
              <div className="text-[9px] text-slate-300">PASS DATE: {gibsDate} UTC</div>
            </div>
          </div>

          {/* Center Glowing Green Radar Sweep, Target Reticle & Bounding Box */}
          <div className="relative flex items-center justify-center my-auto">
            {/* Rotating Radar Sweep Circle */}
            <div className="relative w-44 h-44 sm:w-56 sm:h-56 rounded-full border border-emerald-400/40 flex items-center justify-center">
              <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full border border-dashed border-emerald-400/35" />
              {/* Rotating Conic Radar Beam */}
              <div
                className="tactical-radar-cone absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, rgba(16, 185, 129, 0.28) 0deg, rgba(16, 185, 129, 0.0) 65deg, transparent 360deg)',
                }}
              />
              {/* Target Lock Bounding Box */}
              <div
                className={`relative w-16 h-16 border-2 ${
                  isFlyToLocking ? 'border-amber-400 scale-125' : 'border-emerald-400 scale-100'
                } transition-all duration-300 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.5)]`}
              >
                <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
                <span className="absolute -top-4 left-0 text-[8px] font-bold bg-black/80 text-emerald-300 px-1 border border-emerald-500/40 whitespace-nowrap">
                  {isFlyToLocking ? 'FLY-TO ACQUIRING...' : 'LOCKED TARGET'}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom HUD Controls: Pan / Zoom + Telemetry Note */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="bg-black/80 border border-emerald-500/50 px-2.5 py-1.5 rounded text-[10px] text-emerald-200 max-w-md">
              <span className="font-bold text-emerald-400 uppercase block text-[9px]">
                {sectorCode} // LIVE AGENT TELEMETRY:
              </span>
              <span>
                {TACTICAL_SECTOR_PRESETS.find((p) => p.sectorCode === sectorCode)?.telemetryNote ||
                  `Real-time orbital raster locked on ${targetLabel}. Ready for operative sweep.`}
              </span>
            </div>

            {/* Interactive Map Controls (pointer-events-auto) */}
            <div className="pointer-events-auto flex items-center gap-1 bg-black/85 border border-emerald-500/60 p-1 rounded">
              <button
                type="button"
                onClick={() => panByDegrees(1, 0)}
                className="px-2 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Pan North"
              >
                N
              </button>
              <button
                type="button"
                onClick={() => panByDegrees(-1, 0)}
                className="px-2 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Pan South"
              >
                S
              </button>
              <button
                type="button"
                onClick={() => panByDegrees(0, -1)}
                className="px-2 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Pan West"
              >
                W
              </button>
              <button
                type="button"
                onClick={() => panByDegrees(0, 1)}
                className="px-2 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Pan East"
              >
                E
              </button>
              <div className="h-4 w-[1px] bg-emerald-500/30 mx-0.5" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(2, z - 1))}
                className="p-1 bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Zoom Out (Orbital Macro View)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 text-[10px] font-bold text-emerald-300">Z:{effectiveZoom}</span>
              <button
                type="button"
                onClick={() => {
                  if (feedLayer.startsWith('nasa_gibs_') && effectiveZoom >= 9) {
                    // Automatically switch to Esri World Imagery for street-level zoom > 9
                    setFeedLayer('esri_world_imagery');
                    setZoom(11);
                  } else {
                    setZoom((z) => Math.min(16, z + 1));
                  }
                }}
                className="p-1 bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Zoom In (Auto-switches to Esri High-Res above Level 9)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TacticalSatelliteMonitor;
