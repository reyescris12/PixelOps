import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Crosshair,
  Compass,
  Radar,
  Calendar,
  ZoomIn,
  ZoomOut,
  Video,
  Wind,
  Plane,
  Globe,
  RefreshCw,
  GripHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import TacticalMapOverlay, {
  TacticalIntelPin,
  TacticalOverlayVisibility,
} from './TacticalMapOverlay';
import { listWorkspaceFiles } from '../engine/storageManager';
import {
  getCorroborationClustersWithPackets,
  clusterToTacticalPin,
  runParallelSpecialistTracks,
} from '../services/CorroborationEngine';
import {
  getActiveSensorObservations,
  sweepLocalSensorBusNow,
  getPrimaryNaiZone,
  getPrimaryNaiZoneSync,
  setPrimaryNaiZone,
  type NaiZoneConfig,
} from '../services/LocalSensorBus';
import {
  CCTV_STRATEGIC_HUBS,
  fetchLiveCctvForSector,
  fetchViewportLiveAirspace,
  fetchLocalTargetEnvironment,
  fetchGlobalMacroReconTelemetry,
  buildFreshCameraImageUrl,
  addCustomCctvCamera,
  removeCustomCctvCamera,
  panLatLonByCanvasPixels,
  type LiveCctvCamera,
  type LiveCctvSweepResult,
  type LiveAirspaceTrack,
  type LiveTargetEnvTelemetry,
  type GlobalMacroReconTelemetry,
} from '../services/LiveReconFeedService';

export type SatelliteFeedLayerId =
  | 'esri_world_imagery'
  | 'carto_dark_tactical'
  | 'nasa_gibs_modis_terra'
  | 'nasa_gibs_viirs_snpp'
  | 'nasa_gibs_wvs_composite';

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
    defaultZoom: 10,
    telemetryNote: 'Equinix Ashburn IXP & PJM high-voltage transmission corridor.',
  },
  {
    id: 'uk_london_grid',
    label: 'London LINX / Westminster Civic & JamCam Grid (UK)',
    sectorCode: 'SECTOR-20 // UK-LONDON',
    lat: 51.5074,
    lon: -0.1278,
    defaultZoom: 13,
    telemetryNote: 'LINX peering core, Thames barrier & ~900 live TfL street CCTV feeds.',
  },
  {
    id: 'med_red_sea',
    label: 'Suez Canal & Red Sea Subsea Cable Corridor',
    sectorCode: 'SECTOR-54 // SUEZ-CHOKELINE',
    lat: 30.5852,
    lon: 32.2654,
    defaultZoom: 9,
    telemetryNote: 'AAE-1 / SEACOM / EIG submarine fiber trunk & maritime transit chokepoint.',
  },
  {
    id: 'western_europe',
    label: 'DE-CIX Frankfurt & ENTSO-E Core Grid',
    sectorCode: 'SECTOR-22 // EU-CENTRAL',
    lat: 50.1109,
    lon: 8.6821,
    defaultZoom: 10,
    telemetryNote: 'European continental synchronous grid & primary internet exchange node.',
  },
  {
    id: 'strait_hormuz',
    label: 'Strait of Hormuz & Persian Gulf Energy Corridor',
    sectorCode: 'SECTOR-39 // HORMUZ-WATCH',
    lat: 26.5667,
    lon: 56.25,
    defaultZoom: 9,
    telemetryNote: 'AIS tanker chokepoint & regional GNSS L1 interference zone.',
  },
  {
    id: 'indo_pacific',
    label: 'Strait of Malacca & Singapore Maritime / CCTV Hub',
    sectorCode: 'SECTOR-71 // APAC-MALACCA',
    lat: 1.3521,
    lon: 103.8198,
    defaultZoom: 12,
    telemetryNote: 'Trans-Pacific submarine cable landing, PSA port & live LTA HD cameras.',
  },
  {
    id: 'us_west_port_la',
    label: 'Port of Los Angeles / Long Beach & Caltrans Corridor',
    sectorCode: 'SECTOR-19 // CONUS-WEST',
    lat: 33.7542,
    lon: -118.2165,
    defaultZoom: 12,
    telemetryNote: 'Primary Trans-Pacific container port & live Caltrans D07 CCTV network.',
  },
  {
    id: 'taiwan_strait',
    label: 'Taiwan Strait & Hsinchu Semiconductor Sector',
    sectorCode: 'SECTOR-88 // APAC-NORTH',
    lat: 24.8138,
    lon: 120.9675,
    defaultZoom: 9,
    telemetryNote: 'Foundry power grid stability & high-density ADIZ/maritime telemetry.',
  },
];

/**
 * Web Mercator (EPSG:3857) Slippy Map Tile Math (supports Z:1..18):
 * Converts (latitude, longitude, zoom) -> fractional and integer (x, y, z) tile coordinates.
 */
export function latLonToTileXYZ(lat: number, lon: number, zoom: number): {
  x: number;
  y: number;
  z: number;
  fracX: number;
  fracY: number;
} {
  const z = Math.max(1, Math.min(18, Math.round(zoom)));
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
 * Strict coordinate pair parser:
 * Avoids false-matching 5-digit US ZIP codes (e.g. "90210") or UK postcodes (e.g. "SW1A 1AA").
 */
export function parseExplicitLatLon(input: string): { lat: number; lon: number } | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  if (/^\d{4,6}(-\d{3,4})?$/.test(raw)) return null;
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(raw)) return null;
  if (/^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i.test(raw)) return null;

  const commaCoord = raw.match(
    /(?:^|[^\d.])(-?\d{1,2}(?:\.\d+)?)\s*([NSns])?\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*([EWew])?(?!\d)/
  );
  if (commaCoord) {
    let lat = parseFloat(commaCoord[1]);
    let lon = parseFloat(commaCoord[3]);
    if (commaCoord[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (commaCoord[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  const spaceCoord =
    raw.match(/^(-?\d{1,2}\.\d+)\s*([NSns])?\s+(-?\d{1,3}\.\d+)\s*([EWew])?$/) ||
    raw.match(/^(\d{1,2}(?:\.\d+)?)\s*([NSns])\s+(\d{1,3}(?:\.\d+)?)\s*([EWew])$/i);
  if (spaceCoord) {
    let lat = parseFloat(spaceCoord[1]);
    let lon = parseFloat(spaceCoord[3]);
    if (spaceCoord[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
    if (spaceCoord[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  return null;
}

export function parseReconTargetToCoords(input: string): {
  lat: number;
  lon: number;
  label: string;
  sectorCode: string;
  zoom?: number;
} | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  const explicitCoords = parseExplicitLatLon(raw);
  if (explicitCoords) {
    return {
      lat: explicitCoords.lat,
      lon: explicitCoords.lon,
      label: `Custom Target (${explicitCoords.lat.toFixed(5)}°, ${explicitCoords.lon.toFixed(5)}°)`,
      sectorCode: 'SECTOR-CUSTOM // LOCKED',
      zoom: 13,
    };
  }

  const lower = raw.toLowerCase();

  if (lower.includes('sector 54') || lower.includes('suez') || lower.includes('red sea')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'med_red_sea') || TACTICAL_SECTOR_PRESETS[0];
  }
  if (lower.includes('sector 14') || lower.includes('ashburn') || lower.includes('us-east')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'north_america') || TACTICAL_SECTOR_PRESETS[0];
  }
  if (lower.includes('sector 20') || lower === 'london') {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'uk_london_grid') || TACTICAL_SECTOR_PRESETS[1];
  }
  if (lower.includes('sector 22') || lower.includes('frankfurt')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'western_europe') || TACTICAL_SECTOR_PRESETS[3];
  }
  if (lower.includes('sector 39') || lower.includes('hormuz') || lower.includes('persian gulf')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'strait_hormuz') || TACTICAL_SECTOR_PRESETS[4];
  }
  if (lower.includes('sector 71') || lower.includes('malacca') || lower === 'singapore') {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'indo_pacific') || TACTICAL_SECTOR_PRESETS[5];
  }
  if (lower.includes('sector 19') || lower.includes('long beach') || lower.includes('port of la')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'us_west_port_la') || TACTICAL_SECTOR_PRESETS[6];
  }
  if (lower.includes('sector 88') || lower.includes('taiwan strait') || lower.includes('hsinchu')) {
    return TACTICAL_SECTOR_PRESETS.find((p) => p.id === 'taiwan_strait') || TACTICAL_SECTOR_PRESETS[7];
  }
  if (lower === 'chernobyl') {
    return {
      lat: 51.389,
      lon: 30.099,
      label: 'Chernobyl / Northern Black Sea Sector',
      sectorCode: 'SECTOR-61 // EE-WATCH',
      zoom: 11,
    };
  }
  if (lower === 'reykjanes') {
    return {
      lat: 63.88,
      lon: -22.43,
      label: 'Reykjanes Volcanic & Subsea Landing Zone',
      sectorCode: 'SECTOR-09 // NATL-NORTH',
      zoom: 11,
    };
  }

  return null;
}

const GEOCODE_CACHE: Record<
  string,
  { lat: number; lon: number; label: string; sectorCode: string; zoom: number }
> = {};

export function extractLocationQueryFromDirective(input: string): string {
  const trimmed = (input || '').trim();
  const stripped = trimmed
    .replace(
      /^(?:please\s+)?(?:inspect|scan|recon|check|show|view|lock(?:\s+on(?:\s+to)?)?|fly\s+to|find|search|locate|pull\s+up|satellite(?:\s+imagery)?(?:\s+of|\s+for|\s+near|\s+at)?|grid(?:\s+stability)?(?:\s+near|\s+at|\s+in)?|coordinates(?:\s+for|\s+near|\s+at)?)\s+/i,
      ''
    )
    .replace(/^(?:near|at|in|for|around|over)\s+/i, '')
    .trim();
  return stripped || trimmed;
}

export async function resolveReconLocationAsync(
  rawInput: string,
  preferredZone?: string
): Promise<{
  lat: number;
  lon: number;
  label: string;
  sectorCode: string;
  zoom: number;
} | null> {
  const cleaned = extractLocationQueryFromDirective(rawInput);
  if (!cleaned) return null;

  const cacheKey = `${cleaned.toLowerCase()}__${preferredZone || ''}`;
  if (GEOCODE_CACHE[cacheKey]) {
    return GEOCODE_CACHE[cacheKey];
  }

  const presetMatch = parseReconTargetToCoords(cleaned);
  if (presetMatch) {
    const res = {
      lat: presetMatch.lat,
      lon: presetMatch.lon,
      label: presetMatch.label,
      sectorCode: presetMatch.sectorCode,
      zoom: presetMatch.zoom ?? 10,
    };
    GEOCODE_CACHE[cacheKey] = res;
    return res;
  }

  const compact = cleaned.trim();

  const finalize = (lat: number, lon: number, label: string, codePrefix: string, zoom = 13) => {
    const result = {
      lat,
      lon,
      label,
      sectorCode: `${codePrefix} // ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
      zoom,
    };
    GEOCODE_CACHE[cacheKey] = result;
    return result;
  };

  // US 5-digit ZIP
  const usZipMatch = compact.match(/^(\d{5})(?:-\d{4})?(?:\s*,?\s*(?:usa?|united states))?$/i);
  if (usZipMatch) {
    const zip5 = usZipMatch[1];
    try {
      const zipRes = await fetch(`https://api.zippopotam.us/us/${zip5}`);
      if (zipRes.ok) {
        const zipData: any = await zipRes.json();
        const place = zipData?.places?.[0];
        if (place && place.latitude && place.longitude) {
          const lat = parseFloat(place.latitude);
          const lon = parseFloat(place.longitude);
          const placeName = `${place['place name']}, ${
            place['state abbreviation'] || place.state
          } ${zip5}, USA`;
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, placeName, `ZIP-${zip5}`, 14);
          }
        }
      }
    } catch {}

    try {
      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(
          zip5
        )}&countrycodes=us&limit=1`
      );
      if (nomRes.ok) {
        const nomData: any = await nomRes.json();
        if (Array.isArray(nomData) && nomData.length > 0) {
          const lat = parseFloat(nomData[0].lat);
          const lon = parseFloat(nomData[0].lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(
              lat,
              lon,
              nomData[0].display_name || `ZIP ${zip5}, USA`,
              `ZIP-${zip5}`,
              14
            );
          }
        }
      }
    } catch {}
  }

  // UK Postcode
  const ukFullMatch = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (ukFullMatch) {
    const formattedUk = `${ukFullMatch[1].toUpperCase()} ${ukFullMatch[2].toUpperCase()}`;
    try {
      const ukRes = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(formattedUk)}`
      );
      if (ukRes.ok) {
        const ukData: any = await ukRes.json();
        if (
          ukData?.result &&
          typeof ukData.result.latitude === 'number' &&
          typeof ukData.result.longitude === 'number'
        ) {
          const r = ukData.result;
          const label = [formattedUk, r.admin_district || r.parish, r.region, r.country || 'UK']
            .filter(Boolean)
            .join(', ');
          return finalize(r.latitude, r.longitude, label, `UK-POST`, 15);
        }
      }
    } catch {}
  }

  const ukOutcodeMatch = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)$/i);
  if (ukOutcodeMatch) {
    const outcode = ukOutcodeMatch[1].toUpperCase();
    try {
      const ukOutRes = await fetch(
        `https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`
      );
      if (ukOutRes.ok) {
        const ukOutData: any = await ukOutRes.json();
        if (
          ukOutData?.result &&
          typeof ukOutData.result.latitude === 'number' &&
          typeof ukOutData.result.longitude === 'number'
        ) {
          const r = ukOutData.result;
          const district = Array.isArray(r.admin_district) ? r.admin_district[0] : '';
          const label = [outcode, district, r.country?.[0] || 'UK'].filter(Boolean).join(', ');
          return finalize(r.latitude, r.longitude, label, `UK-${outcode}`, 13);
        }
      }
    } catch {}
  }

  // Canadian Postal Code
  const caPostalMatch = compact.match(/^([A-Z]\d[A-Z])\s*(\d[A-Z]\d)?$/i);
  if (caPostalMatch) {
    const fsa = caPostalMatch[1].toUpperCase();
    try {
      const caRes = await fetch(`https://api.zippopotam.us/ca/${fsa}`);
      if (caRes.ok) {
        const caData: any = await caRes.json();
        const place = caData?.places?.[0];
        if (place && place.latitude && place.longitude) {
          const lat = parseFloat(place.latitude);
          const lon = parseFloat(place.longitude);
          const label = `${place['place name']}, ${
            place['state abbreviation'] || place.state
          } ${compact.toUpperCase()}, Canada`;
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, label, `CA-${fsa}`, 14);
          }
        }
      }
    } catch {}
  }

  const isLikelyPostalCode = /^[A-Z0-9\s-]{3,10}$/i.test(compact) && /\d/.test(compact);
  if (isLikelyPostalCode) {
    const countryOrder =
      preferredZone === 'western_europe'
        ? ['gb', 'de', 'fr', 'nl', 'es', 'it', 'us']
        : preferredZone === 'indo_pacific'
        ? ['au', 'jp', 'sg', 'tw', 'us']
        : ['us', 'ca', 'gb', 'au', 'de', 'fr', 'mx'];

    for (const cc of countryOrder.slice(0, 3)) {
      try {
        const zipRes = await fetch(
          `https://api.zippopotam.us/${cc}/${encodeURIComponent(compact)}`
        );
        if (zipRes.ok) {
          const zipData: any = await zipRes.json();
          const place = zipData?.places?.[0];
          if (place && place.latitude && place.longitude) {
            const lat = parseFloat(place.latitude);
            const lon = parseFloat(place.longitude);
            const label = `${place['place name']}, ${
              place['state abbreviation'] || place.state || ''
            } ${compact} (${zipData.country || cc.toUpperCase()})`;
            if (!isNaN(lat) && !isNaN(lon)) {
              return finalize(lat, lon, label, `POST-${compact.toUpperCase()}`, 14);
            }
          }
        }
      } catch {}
    }

    try {
      const nomPostalRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(
          compact
        )}&addressdetails=1&limit=1`
      );
      if (nomPostalRes.ok) {
        const nomPostalData: any = await nomPostalRes.json();
        if (Array.isArray(nomPostalData) && nomPostalData.length > 0) {
          const lat = parseFloat(nomPostalData[0].lat);
          const lon = parseFloat(nomPostalData[0].lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(
              lat,
              lon,
              nomPostalData[0].display_name,
              `POST-${compact.toUpperCase()}`,
              14
            );
          }
        }
      }
    } catch {}
  }

  // Free-text street address / landmark / city via Nominatim
  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        compact
      )}&addressdetails=1&limit=1`
    );
    if (nomRes.ok) {
      const nomData: any = await nomRes.json();
      if (Array.isArray(nomData) && nomData.length > 0) {
        const lat = parseFloat(nomData[0].lat);
        const lon = parseFloat(nomData[0].lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          const isAddressOrBuilding =
            Boolean(nomData[0].address?.road) || Boolean(nomData[0].address?.house_number);
          return finalize(
            lat,
            lon,
            nomData[0].display_name || compact,
            'GEO-LOCK',
            isAddressOrBuilding ? 16 : isLikelyPostalCode ? 14 : 12
          );
        }
      }
    }
  } catch {}

  // Open-Meteo Global Geocoding Fallback
  try {
    const meteoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        compact
      )}&count=1&language=en&format=json`
    );
    if (meteoRes.ok) {
      const meteoData: any = await meteoRes.json();
      const first = meteoData?.results?.[0];
      if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
        const label = [first.name, first.admin1, first.country, first.postcodes?.[0]]
          .filter(Boolean)
          .join(', ');
        return finalize(
          first.latitude,
          first.longitude,
          label,
          'GEO-LOCK',
          isLikelyPostalCode ? 14 : 12
        );
      }
    }
  } catch {}

  return null;
}

function getDefaultNasaGibsDate(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

export function buildSatelliteTileUrl(
  layer: SatelliteFeedLayerId,
  z: number,
  y: number,
  x: number,
  dateStr: string
): string {
  if (layer === 'carto_dark_tactical') {
    return `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
  }
  if (layer === 'nasa_gibs_modis_terra') {
    const clampedZ = Math.min(9, Math.max(1, z));
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/${clampedZ}/${y}/${x}.jpg`;
  }
  if (layer === 'nasa_gibs_viirs_snpp') {
    const clampedZ = Math.min(9, Math.max(1, z));
    return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${dateStr}/GoogleMapsCompatible_Level9/${clampedZ}/${y}/${x}.jpg`;
  }
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

export function buildHybridReferenceTileUrls(z: number, y: number, x: number): {
  roadsUrl: string;
  placesUrl: string;
} {
  return {
    roadsUrl: `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}`,
    placesUrl: `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
  };
}

export function buildSeamlessNasaWvsSnapshotUrl(
  lat: number,
  lon: number,
  zoom: number,
  dateStr: string,
  gibsLayerName: string = 'MODIS_Terra_CorrectedReflectance_TrueColor,Coastlines_15m'
): string {
  const latSpan = Math.max(0.25, Math.min(25, 45 / Math.pow(2, Math.max(0, zoom - 3))));
  const lonSpan = latSpan * 2.0;

  const minLat = Math.max(-89.5, Number((lat - latSpan).toFixed(4)));
  const maxLat = Math.min(89.5, Number((lat + latSpan).toFixed(4)));
  const minLon = Math.max(-179.9, Number((lon - lonSpan).toFixed(4)));
  const maxLon = Math.min(179.9, Number((lon + lonSpan).toFixed(4)));

  return `https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&TIME=${dateStr}&BBOX=${minLat},${minLon},${maxLat},${maxLon}&CRS=EPSG:4326&LAYERS=${gibsLayerName}&WRAP=DAY&FORMAT=image/jpeg&WIDTH=1200&HEIGHT=600`;
}

export interface TacticalSatelliteMonitorProps {
  initialLat?: number;
  initialLon?: number;
  initialLabel?: string;
  initialSectorCode?: string;
  activeOperativeName?: string;
  threatBadgeText?: string;
  onDispatchReconDirective?: (
    directive: string,
    coords: { lat: number; lon: number; label: string }
  ) => void;
  onViewportTargetSync?: (coords: { lat: number; lon: number; label: string }) => void;
  compact?: boolean;
  overlayMode?: boolean;
  onCloseOverlay?: () => void;
  onOpenThreatMatrixModal?: () => void;
}

export const TacticalSatelliteMonitor: React.FC<TacticalSatelliteMonitorProps> = ({
  initialLat = 30.5852,
  initialLon = 32.2654,
  initialLabel = 'Suez Canal & Red Sea Subsea Cable Corridor',
  initialSectorCode = 'SECTOR-54 // SUEZ-CHOKELINE',
  activeOperativeName = 'Agent Nyx',
  threatBadgeText = 'THREAT LEVEL: BRAVO - REGIONAL GRID STRAIN',
  onDispatchReconDirective,
  onViewportTargetSync,
  compact = false,
  overlayMode = false,
  onCloseOverlay,
  onOpenThreatMatrixModal,
}) => {
  const [lat, setLat] = useState<number>(initialLat);
  const [lon, setLon] = useState<number>(initialLon);
  const [targetLabel, setTargetLabel] = useState<string>(initialLabel);
  const [sectorCode, setSectorCode] = useState<string>(initialSectorCode);
  const [zoom, setZoom] = useState<number>(10);
  const [feedLayer, setFeedLayer] = useState<SatelliteFeedLayerId>('esri_world_imagery');
  const [shaderMode, setShaderMode] = useState<PhosphorShaderMode>('true_color');
  const [showHybridLabels, setShowHybridLabels] = useState<boolean>(true);
  const [gibsDate, setGibsDate] = useState<string>(getDefaultNasaGibsDate);
  const [commandInput, setCommandInput] = useState<string>('');
  const [isFlyToLocking, setIsFlyToLocking] = useState<boolean>(false);
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);
  const [geocodeStatusMsg, setGeocodeStatusMsg] = useState<string | null>(null);
  const [tileErrors, setTileErrors] = useState<Record<string, boolean>>({});
  const [wvsSnapshotError, setWvsSnapshotError] = useState<boolean>(false);
  const [showTacticalPins, setShowTacticalPins] = useState<boolean>(true);
  const [pinpointMode, setPinpointMode] = useState<boolean>(false);
  const [pinpointTarget, setPinpointTarget] = useState<{
    lat: number;
    lon: number;
    label?: string;
  } | null>(null);
  const [cursorTelemetry, setCursorTelemetry] = useState<{
    lat: number;
    lon: number;
    distanceKm: number;
    bearingDeg: number;
  } | null>(null);
  const [hasActivePinDossier, setHasActivePinDossier] = useState<boolean>(false);
  const [isSweepingTracks, setIsSweepingTracks] = useState<boolean>(false);
  const [intelligencePins, setIntelligencePins] = useState<TacticalIntelPin[]>([]);
  const [activeNai, setActiveNai] = useState<NaiZoneConfig | null>(() => getPrimaryNaiZoneSync());
  const [showKeyShortcutsHelp, setShowKeyShortcutsHelp] = useState<boolean>(false);

  // Multi-Layer Live Recon Visibility
  const [overlayVisibility, setOverlayVisibility] = useState<TacticalOverlayVisibility>({
    intelPins: true,
    adsbAirspace: true,
    adsbTacticalOnly: false,
    cctvNodes: true,
    globalHazards: true,
  });

  // Live Local + Global Reconnaissance Data States
  const [airspaceData, setAirspaceData] = useState<{
    tracks: LiveAirspaceTrack[];
    totalCount: number;
    tacticalCount: number;
    observedAt: string;
  }>({ tracks: [], totalCount: 0, tacticalCount: 0, observedAt: '' });
  const [cctvSweep, setCctvSweep] = useState<LiveCctvSweepResult>({
    inSectorCameras: [],
    nearestGlobalCameras: [],
    globalHubShowcase: [],
    totalCatalogCount: 0,
    activeNetworks: [],
  });
  const [localEnv, setLocalEnv] = useState<LiveTargetEnvTelemetry | null>(null);
  const [globalMacro, setGlobalMacro] = useState<GlobalMacroReconTelemetry | null>(null);
  const [isLoadingLiveFeeds, setIsLoadingLiveFeeds] = useState<boolean>(false);

  // Live CCTV Picture-in-Picture (PiP) & Multi-Cam Dock State
  const [activePipCamera, setActivePipCamera] = useState<LiveCctvCamera | null>(null);
  const [pipVideoMode, setPipVideoMode] = useState<'VIDEO' | 'STILL'>('VIDEO');
  const [pipNvgFilter, setPipNvgFilter] = useState<boolean>(false);
  const [cctvRefreshTick, setCctvRefreshTick] = useState<number>(0);
  const [showCctvDock, setShowCctvDock] = useState<boolean>(false);
  const [showAddCustomCamForm, setShowAddCustomCamForm] = useState<boolean>(false);
  const [customCamName, setCustomCamName] = useState<string>('');
  const [customCamUrl, setCustomCamUrl] = useState<string>('');
  const [pipAnnouncement, setPipAnnouncement] = useState<string>('');

  // Draggable PiP Window State (clamped inside viewport container)
  const viewportContainerRef = useRef<HTMLDivElement | null>(null);
  const pipPanelRef = useRef<HTMLDivElement | null>(null);
  const pipHandleRef = useRef<HTMLButtonElement | null>(null);
  const [pipPos, setPipPos] = useState<{ left: number; top: number }>({ left: 12, top: 52 });
  const pipDragOffsetRef = useRef<{ offsetX: number; offsetY: number } | null>(null);

  // Track external prop target key so parent re-renders NEVER snap manual user panning back!
  const lastExternalTargetKeyRef = useRef<string>(
    `${initialLat.toFixed(4)}_${initialLon.toFixed(4)}_${initialSectorCode}`
  );

  // Auto-refresh live CCTV JPEG frames every 10 seconds while PiP or CCTV Dock is visible
  useEffect(() => {
    if (!activePipCamera && !showCctvDock) return;
    const id = setInterval(() => {
      setCctvRefreshTick((t) => t + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [activePipCamera, showCctvDock]);

  // Clamp PiP panel inside viewport container (used by pointer drag, keyboard arrows, and resize)
  const movePipClamped = useCallback((rawLeft: number, rawTop: number) => {
    const container = viewportContainerRef.current;
    const panel = pipPanelRef.current;
    if (!container || !panel) {
      setPipPos({ left: Math.max(8, rawLeft), top: Math.max(8, rawTop) });
      return;
    }
    const maxLeft = Math.max(8, container.clientWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(8, container.clientHeight - panel.offsetHeight - 8);
    setPipPos({
      left: Math.max(8, Math.min(rawLeft, maxLeft)),
      top: Math.max(8, Math.min(rawTop, maxTop)),
    });
  }, []);

  useEffect(() => {
    if (!activePipCamera) return;
    const onResize = () => movePipClamped(pipPos.left, pipPos.top);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activePipCamera, pipPos.left, pipPos.top, movePipClamped]);

  // Hydrate pins from LocalSensorBus, CorroborationEngine, and explicit-coordinate VFS dossiers
  const refreshIntelligencePins = useCallback(async () => {
    try {
      const [bundles, files, primaryNai] = await Promise.all([
        getCorroborationClustersWithPackets(),
        listWorkspaceFiles('intel'),
        getPrimaryNaiZone().catch(() => null),
      ]);
      if (primaryNai) {
        setActiveNai(primaryNai);
      }

      const sensorObservations = getActiveSensorObservations();
      const obsByPacketId = new Map<string, (typeof sensorObservations)[number]>();
      for (const obs of sensorObservations) {
        if (obs.packetId) {
          obsByPacketId.set(obs.packetId, obs);
        }
      }

      const coveredPacketIds = new Set<string>();
      const clusterPins: TacticalIntelPin[] = bundles
        .filter((b) => b.cluster.status !== 'DISMISSED')
        .map((b) => {
          const basePin = clusterToTacticalPin(b);
          const matchedObs = b.cluster.packetIds
            .map((pid) => obsByPacketId.get(pid))
            .find(Boolean);
          for (const pid of b.cluster.packetIds) {
            coveredPacketIds.add(pid);
          }
          if (matchedObs) {
            return {
              ...basePin,
              admiraltyGrade: matchedObs.admiraltyGrade,
              adapterId: matchedObs.adapterId,
              observationTime: matchedObs.observationTime,
              firstIngestedAt: matchedObs.firstIngestedAt,
              lastMaterialChangeAt: matchedObs.lastMaterialChangeAt,
              isKineticNonTectonic: matchedObs.isKineticNonTectonic,
              seismicTypeVerbatim: matchedObs.seismicTypeVerbatim,
              isLifeSafetyA1: matchedObs.isLifeSafetyA1,
              spotlightedSummary: matchedObs.spotlightedSummary,
              corroborationStatus:
                matchedObs.isLifeSafetyA1 && basePin.corroborationStatus === 'CANDIDATE'
                  ? 'CORROBORATED'
                  : basePin.corroborationStatus,
            };
          }
          return basePin;
        });

      const directSensorPins: TacticalIntelPin[] = sensorObservations
        .filter((obs) => !obs.packetId || !coveredPacketIds.has(obs.packetId))
        .map((obs) => ({
          id: `sensor-obs-${obs.id}`,
          lat: obs.lat,
          lon: obs.lon,
          title: obs.headline,
          summary: `${obs.headline} • Distance: ${obs.distanceKm} km from NAI`,
          priority:
            obs.severity === 'CRITICAL' || obs.severity === 'HIGH'
              ? 'HIGH'
              : obs.severity === 'MEDIUM'
              ? 'MEDIUM'
              : 'LOW',
          timestamp: obs.observationTime,
          capturedAt: obs.firstIngestedAt,
          expiresAt: new Date(
            Date.parse(obs.lastMaterialChangeAt || obs.firstIngestedAt) +
              (obs.adapterId === 'GEOINT_AIR' ? 300_000 : 1_800_000)
          ).toISOString(),
          category: obs.adapterId,
          corroborationScore: obs.corroborationScore,
          corroborationStatus: obs.corroborationStatus,
          sourceTracks: obs.sourceTracks,
          sourceCount: obs.sourceTracks.length,
          admiraltyGrade: obs.admiraltyGrade,
          adapterId: obs.adapterId,
          observationTime: obs.observationTime,
          firstIngestedAt: obs.firstIngestedAt,
          lastMaterialChangeAt: obs.lastMaterialChangeAt,
          isKineticNonTectonic: obs.isKineticNonTectonic,
          seismicTypeVerbatim: obs.seismicTypeVerbatim,
          isLifeSafetyA1: obs.isLifeSafetyA1,
          spotlightedSummary: obs.spotlightedSummary,
        }));

      const getFileName = (f: { path: string }) => (f.path.split('/').pop() || f.path).toLowerCase();
      const getFileTitle = (f: { path: string; content: string }) => {
        const heading = f.content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
        if (heading) return heading.replace(/[*_`]/g, '').slice(0, 90);
        return getFileName(f).replace(/\.(md|txt|json)$/i, '').replace(/[_-]+/g, ' ').trim();
      };

      const wireFiles = files
        .filter((f) => {
          if (f.path.startsWith('intel/raw/') || f.path.startsWith('intel/missions/')) return false;
          const name = getFileName(f);
          return (
            name.startsWith('s2_wire_') ||
            name.includes('s2-wire') ||
            name.includes('osint') ||
            name.startsWith('isw_') ||
            name.includes('_isw_') ||
            f.path.includes('isw_research')
          );
        })
        .slice(0, 8);

      const vfsPins: TacticalIntelPin[] = [];
      for (const file of wireFiles) {
        const fileTitle = getFileTitle(file);
        const explicitCoords = parseExplicitLatLon(`${fileTitle}\n${file.content}`);
        if (!explicitCoords) continue;

        const isISW =
          file.path.includes('isw_research') ||
          file.path.includes('isw_') ||
          fileTitle.includes('ISW') ||
          file.content.includes('understandingwar.org');
        const cleanBody = file.content
          .replace(/^#+\s+.*/gm, '')
          .replace(/\*\*.*?\*\*/g, '')
          .replace(/[-`_>#]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const summarySnippet =
          cleanBody.slice(0, 180) + (cleanBody.length > 180 ? '...' : '');

        vfsPins.push({
          id: `vfs-pin-${file.id ?? file.path}`,
          title: fileTitle || (isISW ? 'ISW Research Assessment' : 'S2 Wire Intelligence Dispatch'),
          summary: summarySnippet || 'Structured dossier archived in local VFS.',
          priority: 'MEDIUM',
          category: isISW ? 'ISW RESEARCH' : 'S2 WIRE SITREP',
          corroborationScore: 0.35,
          corroborationStatus: 'CANDIDATE',
          sourceTracks: ['WRITTEN_WIRE'],
          sourceCount: 1,
          timestamp: new Date(file.updatedAt || Date.now()).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          lat: explicitCoords.lat,
          lon: explicitCoords.lon,
        });
      }

      setIntelligencePins((prev) => {
        const manualTargets = prev.filter((p) => p.id.startsWith('recon-target-'));
        return [...clusterPins, ...directSensorPins, ...manualTargets, ...vfsPins];
      });
    } catch {}
  }, []);

  useEffect(() => {
    refreshIntelligencePins();
    const onRefresh = () => {
      refreshIntelligencePins();
    };
    const onNaiChanged = (ev: Event) => {
      const custom = ev as CustomEvent<NaiZoneConfig | undefined>;
      if (custom?.detail) {
        setActiveNai(custom.detail);
      }
      refreshIntelligencePins();
    };
    window.addEventListener('pixelops:corroboration-updated', onRefresh);
    window.addEventListener('pixelops:sensor-bus-updated', onRefresh);
    window.addEventListener('pixelops:nai-updated', onNaiChanged);
    window.addEventListener('pixelops:workspace_files_changed', onRefresh);
    return () => {
      window.removeEventListener('pixelops:corroboration-updated', onRefresh);
      window.removeEventListener('pixelops:sensor-bus-updated', onRefresh);
      window.removeEventListener('pixelops:nai-updated', onNaiChanged);
      window.removeEventListener('pixelops:workspace_files_changed', onRefresh);
    };
  }, [refreshIntelligencePins]);

  // Debounced Live Viewport & Global Reconnaissance Poller (ADS-B + CCTV + Open-Meteo + USGS/EONET/SWPC)
  const refreshLiveViewportTelemetry = useCallback(
    async (targetLat: number, targetLon: number, force = false) => {
      setIsLoadingLiveFeeds(true);
      try {
        const [airRes, cctvRes, envRes, macroRes] = await Promise.allSettled([
          fetchViewportLiveAirspace(targetLat, targetLon, 180),
          fetchLiveCctvForSector(targetLat, targetLon, 140, force),
          fetchLocalTargetEnvironment(targetLat, targetLon),
          fetchGlobalMacroReconTelemetry(force),
        ]);

        if (airRes.status === 'fulfilled') setAirspaceData(airRes.value);
        if (cctvRes.status === 'fulfilled') setCctvSweep(cctvRes.value);
        if (envRes.status === 'fulfilled' && envRes.value) setLocalEnv(envRes.value);
        if (macroRes.status === 'fulfilled') setGlobalMacro(macroRes.value);
      } finally {
        setIsLoadingLiveFeeds(false);
      }
    },
    []
  );

  useEffect(() => {
    const debounceId = setTimeout(() => {
      refreshLiveViewportTelemetry(lat, lon, false);
    }, 420);
    return () => clearTimeout(debounceId);
  }, [lat, lon, refreshLiveViewportTelemetry]);

  // Periodic 35s live airspace & CCTV refresh while monitor is mounted
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshLiveViewportTelemetry(lat, lon, false);
    }, 35_000);
    return () => clearInterval(intervalId);
  }, [lat, lon, refreshLiveViewportTelemetry]);

  const handleManualSpecialistSweep = async () => {
    if (isSweepingTracks) return;
    setIsSweepingTracks(true);
    try {
      await Promise.allSettled([
        sweepLocalSensorBusNow(),
        runParallelSpecialistTracks(),
        refreshLiveViewportTelemetry(lat, lon, true),
      ]);
      await refreshIntelligencePins();
    } finally {
      setIsSweepingTracks(false);
    }
  };

  // Sync ONLY when external target coordinates genuinely change (prevents parent re-renders from snapping manual pan!)
  useEffect(() => {
    const incomingKey = `${initialLat.toFixed(4)}_${initialLon.toFixed(4)}_${initialSectorCode}`;
    if (incomingKey === lastExternalTargetKeyRef.current) {
      return;
    }
    lastExternalTargetKeyRef.current = incomingKey;
    setIsFlyToLocking(true);
    setLat(initialLat);
    setLon(initialLon);
    if (initialLabel) setTargetLabel(initialLabel);
    if (initialSectorCode) setSectorCode(initialSectorCode);
    setWvsSnapshotError(false);
    const t = setTimeout(() => setIsFlyToLocking(false), 650);
    return () => clearTimeout(t);
  }, [initialLat, initialLon, initialLabel, initialSectorCode]);

  // Listen for live agent tool call events ('pixelops:satellite-recon-lock')
  useEffect(() => {
    const handleAgentReconLock = (ev: Event) => {
      const customEv = ev as CustomEvent<{
        lat: number;
        lon: number;
        label: string;
        layer?: string;
        date?: string;
      }>;
      const detail = customEv.detail;
      if (!detail || typeof detail.lat !== 'number' || typeof detail.lon !== 'number') return;

      setIsFlyToLocking(true);
      setLat(detail.lat);
      setLon(detail.lon);
      setTargetLabel(detail.label || `Target (${detail.lat.toFixed(4)}, ${detail.lon.toFixed(4)})`);
      setSectorCode(`AGENT-LOCK // ${detail.lat.toFixed(2)}°, ${detail.lon.toFixed(2)}°`);
      if (detail.date && /^\d{4}-\d{2}-\d{2}$/.test(detail.date)) {
        setGibsDate(detail.date);
      }
      setWvsSnapshotError(false);
      setTimeout(() => setIsFlyToLocking(false), 800);
    };

    window.addEventListener('pixelops:satellite-recon-lock', handleAgentReconLock);
    return () => window.removeEventListener('pixelops:satellite-recon-lock', handleAgentReconLock);
  }, []);

  // Support street-level Z:18 on Esri & Carto, clamp to Z:9 on NASA GIBS Level9 daily weather tiles
  const maxLayerZoom =
    feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp' ? 9 : 18;

  const effectiveZoom = useMemo(() => {
    return Math.min(maxLayerZoom, Math.max(2, zoom));
  }, [maxLayerZoom, zoom]);

  const centerTile = useMemo(
    () => latLonToTileXYZ(lat, lon, effectiveZoom),
    [lat, lon, effectiveZoom]
  );

  /**
   * 7x5 Seamless Uncropped 256x256 Slippy Tile Matrix (1792x1280px)
   * Zero CSS transition lag during drag-panning so crossing integer tile boundaries never bounces!
   */
  const TILE_SIZE_PX = 256;
  const GRID_COLS = 7; // dx from -3 to +3
  const GRID_ROWS = 5; // dy from -2 to +2

  const seamlessTileCanvas = useMemo(() => {
    const n = Math.pow(2, centerTile.z);
    const tiles: Array<{
      dx: number;
      dy: number;
      x: number;
      y: number;
      z: number;
      url: string;
      fallbackEsriUrl: string;
      roadsRefUrl: string;
      placesRefUrl: string;
      key: string;
    }> = [];

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tileX = (((centerTile.x + dx) % n) + n) % n;
        const tileY = Math.max(0, Math.min(n - 1, centerTile.y + dy));
        const activeLayerForTiles: SatelliteFeedLayerId =
          feedLayer === 'nasa_gibs_wvs_composite' ? 'nasa_gibs_modis_terra' : feedLayer;
        const url = buildSatelliteTileUrl(activeLayerForTiles, centerTile.z, tileY, tileX, gibsDate);
        const fallbackEsriUrl = buildSatelliteTileUrl(
          'esri_world_imagery',
          centerTile.z,
          tileY,
          tileX,
          gibsDate
        );
        const refs = buildHybridReferenceTileUrls(centerTile.z, tileY, tileX);
        tiles.push({
          dx,
          dy,
          x: tileX,
          y: tileY,
          z: centerTile.z,
          url,
          fallbackEsriUrl,
          roadsRefUrl: refs.roadsUrl,
          placesRefUrl: refs.placesUrl,
          key: `${activeLayerForTiles}_${gibsDate}_${centerTile.z}_${tileY}_${tileX}`,
        });
      }
    }
    return tiles;
  }, [centerTile, feedLayer, gibsDate]);

  const wvsCompositeUrl = useMemo(
    () => buildSeamlessNasaWvsSnapshotUrl(lat, lon, effectiveZoom, gibsDate),
    [lat, lon, effectiveZoom, gibsDate]
  );

  // Exact continuous sub-tile pixel offset so (lat, lon) stays locked 1:1 under crosshair
  const offsetX = (0.5 - centerTile.fracX) * TILE_SIZE_PX;
  const offsetY = (0.5 - centerTile.fracY) * TILE_SIZE_PX;

  const handleSelectPreset = (preset: TacticalTargetPreset) => {
    setIsFlyToLocking(true);
    setLat(preset.lat);
    setLon(preset.lon);
    setTargetLabel(preset.label);
    setSectorCode(preset.sectorCode);
    setZoom(preset.defaultZoom);
    if (
      preset.defaultZoom > 9 &&
      (feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp')
    ) {
      setFeedLayer('esri_world_imagery');
    }
    setWvsSnapshotError(false);
    setTimeout(() => setIsFlyToLocking(false), 650);
  };

  const handleLockNaiAtCoords = async (coords: { lat: number; lon: number; label?: string }) => {
    try {
      const naiLabel =
        coords.label || `NAI Lock (${coords.lat.toFixed(4)}°, ${coords.lon.toFixed(4)}°)`;
      const updated = await setPrimaryNaiZone({
        lat: coords.lat,
        lon: coords.lon,
        label: naiLabel,
      });
      setActiveNai(updated);
      setGeocodeStatusMsg(
        `NAI Geofence locked at ${coords.lat.toFixed(5)}°, ${coords.lon.toFixed(5)}° (${updated.radiusKm}km radius)`
      );
      onViewportTargetSync?.({ lat: coords.lat, lon: coords.lon, label: naiLabel });
      sweepLocalSensorBusNow().then(() => refreshIntelligencePins()).catch(() => {});
      setTimeout(() => setGeocodeStatusMsg(null), 4500);
    } catch (err: any) {
      setGeocodeStatusMsg(err?.message || 'Could not update NAI geofence.');
      setTimeout(() => setGeocodeStatusMsg(null), 4500);
    }
  };

  const handleCommandLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawQuery = commandInput.trim();
    if (!rawQuery) return;

    setIsGeocoding(true);
    setGeocodeStatusMsg(`Resolving precision coordinates for "${rawQuery}"...`);

    const resolved = await resolveReconLocationAsync(rawQuery);
    setIsGeocoding(false);

    if (resolved) {
      setIsFlyToLocking(true);
      setLat(resolved.lat);
      setLon(resolved.lon);
      setTargetLabel(resolved.label);
      setSectorCode(resolved.sectorCode);
      if (resolved.zoom) {
        setZoom(resolved.zoom);
        if (
          resolved.zoom > 9 &&
          (feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp')
        ) {
          setFeedLayer('esri_world_imagery');
        }
      }
      setPinpointTarget({ lat: resolved.lat, lon: resolved.lon, label: resolved.label });
      setWvsSnapshotError(false);
      setGeocodeStatusMsg(
        `Locked: ${resolved.label} (${resolved.lat.toFixed(5)}°, ${resolved.lon.toFixed(5)}°)`
      );
      setIntelligencePins((prev) => {
        const customPin: TacticalIntelPin = {
          id: `recon-target-${resolved.lat.toFixed(4)}-${resolved.lon.toFixed(4)}`,
          title: resolved.label,
          summary: `Active reconnaissance lock acquired at ${resolved.lat.toFixed(5)}°, ${resolved.lon.toFixed(5)}°.`,
          priority: 'HIGH',
          category: 'RECON TARGET',
          timestamp: 'Just now',
          lat: resolved.lat,
          lon: resolved.lon,
        };
        const filtered = prev.filter((p) => p.id !== customPin.id);
        return [customPin, ...filtered];
      });
      onViewportTargetSync?.({ lat: resolved.lat, lon: resolved.lon, label: resolved.label });
      setTimeout(() => setIsFlyToLocking(false), 650);
      setTimeout(() => setGeocodeStatusMsg(null), 5000);
    } else {
      setGeocodeStatusMsg(
        `Could not resolve "${rawQuery}" — try adding country or city (e.g. "90210, US")`
      );
      setTimeout(() => setGeocodeStatusMsg(null), 5000);
    }
  };

  // Smooth zoom-proportional pixel pan (scales all the way down to ~35m at Z:18, or ~9m with Shift!)
  const handleDirectionalPan = (dirX: number, dirY: number, fineShift = false) => {
    const pxStep = fineShift ? 24 : 96;
    const panned = panLatLonByCanvasPixels(lat, lon, effectiveZoom, -dirX * pxStep, -dirY * pxStep);
    setLat(panned.lat);
    setLon(panned.lon);
    setSectorCode(`PAN-LOCK // ${panned.lat.toFixed(3)}°, ${panned.lon.toFixed(3)}°`);
  };

  const handleOpenCameraInPip = (cam: LiveCctvCamera) => {
    setActivePipCamera(cam);
    setPipVideoMode(cam.videoUrl && cam.streamType === 'MP4_CLIP' ? 'VIDEO' : 'STILL');
    setCctvRefreshTick((t) => t + 1);
  };

  const handleAddCustomCamSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCamUrl.trim()) return;
    const targetCoords = pinpointTarget || { lat, lon };
    const updatedList = addCustomCctvCamera({
      name: customCamName.trim() || `Custom Recon Cam (${targetCoords.lat.toFixed(4)}, ${targetCoords.lon.toFixed(4)})`,
      lat: targetCoords.lat,
      lon: targetCoords.lon,
      streamUrl: customCamUrl.trim(),
    });
    setCustomCamName('');
    setCustomCamUrl('');
    setShowAddCustomCamForm(false);
    refreshLiveViewportTelemetry(lat, lon, true);
    if (updatedList[0]) {
      handleOpenCameraInPip(updatedList[0]);
    }
  };

  const mapCctvNodes = useMemo(() => {
    return cctvSweep.inSectorCameras.length > 0
      ? cctvSweep.inSectorCameras
      : cctvSweep.globalHubShowcase;
  }, [cctvSweep]);

  const dockCameras = useMemo(() => {
    return cctvSweep.inSectorCameras.length > 0
      ? cctvSweep.inSectorCameras.slice(0, 8)
      : cctvSweep.globalHubShowcase.slice(0, 8);
  }, [cctvSweep]);

  const shaderClass =
    shaderMode === 'amber_crt'
      ? 'phosphor-amber'
      : shaderMode === 'thermal_flir'
      ? 'phosphor-thermal'
      : shaderMode === 'true_color'
      ? 'phosphor-truecolor'
      : '';

  return (
    <div
      className={`w-full ${
        overlayMode
          ? 'h-full flex flex-col rounded-none border-0'
          : 'rounded-lg border-2 border-emerald-500/60 shadow-[0_0_35px_rgba(16,185,129,0.2)]'
      } bg-[#070b11] overflow-hidden font-mono text-slate-100`}
    >
      {/* Screen-reader live region for PiP panel movement */}
      <div className="visually-hidden" aria-live="polite">
        {pipAnnouncement}
      </div>

      {/* Top Recon Monitor Control Header */}
      <div className="px-2.5 py-1.5 sm:px-3.5 sm:py-2 bg-gradient-to-r from-[#06120e] via-[#0b1f17] to-[#06120e] border-b border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="p-1.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-300 shrink-0">
            <Radar className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span className="text-[11px] sm:text-sm font-bold tracking-wider uppercase text-emerald-300 truncate">
                🛰️ LIVE MULTI-INT RECON MONITOR
              </span>
              <span className="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 whitespace-nowrap">
                PINS: {intelligencePins.length} • AIR: {airspaceData.totalCount} • CCTV:{' '}
                {cctvSweep.inSectorCameras.length || cctvSweep.totalCatalogCount}
              </span>
            </div>
            <p className="text-[9.5px] sm:text-[10px] text-emerald-400/80 truncate">
              {sectorCode} • {targetLabel} ({lat.toFixed(5)}°, {lon.toFixed(5)}°) • [Z:{centerTile.z}{' '}
              Y:{centerTile.y} X:{centerTile.x}]
            </p>
          </div>
        </div>

        {/* Feed Layer, Shader & Action Controls */}
        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 w-full sm:w-auto justify-end">
          <select
            id="satellite-feed-layer"
            name="satellite_feed_layer"
            value={feedLayer}
            onChange={(e) => {
              const nextLayer = e.target.value as SatelliteFeedLayerId;
              setFeedLayer(nextLayer);
              setWvsSnapshotError(false);
              if (
                (nextLayer === 'nasa_gibs_modis_terra' || nextLayer === 'nasa_gibs_viirs_snpp') &&
                zoom > 9
              ) {
                setZoom(7);
              }
            }}
            className="px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] bg-[#040a07] border border-emerald-500/50 rounded text-emerald-200 focus:outline-none max-w-[170px] sm:max-w-none truncate"
            title="Select Satellite Optical, C2 Dark Vector, or NASA Orbital Layer"
          >
            <option value="esri_world_imagery">Esri World Imagery (Street-Level Optical Z:18)</option>
            <option value="carto_dark_tactical">C2 Dark Vector Tactical Street &amp; Infra Map</option>
            <option value="nasa_gibs_wvs_composite">NASA GIBS Worldview Daily Composite</option>
            <option value="nasa_gibs_modis_terra">NASA GIBS WMTS: MODIS Terra (Daily Plumes)</option>
            <option value="nasa_gibs_viirs_snpp">NASA GIBS WMTS: Suomi NPP VIIRS (Orbital)</option>
          </select>

          <select
            id="satellite-shader-mode"
            name="satellite_shader_mode"
            value={shaderMode}
            onChange={(e) => setShaderMode(e.target.value as PhosphorShaderMode)}
            className="px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px] bg-[#040a07] border border-emerald-500/50 rounded text-emerald-200 focus:outline-none max-w-[135px] sm:max-w-none truncate"
            title="Select Optical / Night-Vision / Thermal Filter"
          >
            <option value="true_color">True-Color HD Optical</option>
            <option value="green_nvg">CRT Green Night-Vision (NVG)</option>
            <option value="amber_crt">Amber Phosphor CRT</option>
            <option value="thermal_flir">Thermal / FLIR Inversion</option>
          </select>

          {feedLayer.startsWith('nasa_gibs_') && (
            <div className="flex items-center gap-1 bg-[#040a07] border border-emerald-500/40 rounded px-1.5 py-0.5">
              <Calendar className="w-3 h-3 text-emerald-400" />
              <input
                id="satellite-gibs-date"
                name="satellite_gibs_date"
                type="date"
                value={gibsDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => {
                  setGibsDate(e.target.value || getDefaultNasaGibsDate());
                  setWvsSnapshotError(false);
                }}
                className="bg-transparent text-[10px] text-emerald-200 focus:outline-none"
                title="NASA GIBS Orbital Pass Date"
              />
            </div>
          )}

          <button
            type="button"
            disabled={isSweepingTracks || isLoadingLiveFeeds}
            onClick={handleManualSpecialistSweep}
            className="px-2 py-1 text-[10px] font-bold rounded border bg-emerald-950/70 hover:bg-emerald-900 text-emerald-200 border-emerald-500/50 cursor-pointer whitespace-nowrap flex items-center gap-1 disabled:opacity-50"
            title="Sweep Live ADS-B, CCTV, Sensor Bus & Specialist Corroboration Tracks"
          >
            <RefreshCw
              className={`w-3 h-3 ${isSweepingTracks || isLoadingLiveFeeds ? 'animate-spin' : ''}`}
            />
            <span>⚡ SWEEP LIVE</span>
          </button>

          {onOpenThreatMatrixModal && (
            <button
              type="button"
              onClick={onOpenThreatMatrixModal}
              className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-400/60 cursor-pointer whitespace-nowrap"
              title="Open 4-Pillar Threat Matrix & Multi-Cam Recon"
            >
              [🛡️ Threat Matrix]
            </button>
          )}

          {onCloseOverlay && (
            <button
              type="button"
              onClick={onCloseOverlay}
              className="px-2.5 py-1 text-[10px] font-bold rounded bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-400/60 cursor-pointer whitespace-nowrap"
              title="Close Recon Monitor Popup"
            >
              [✕ CLOSE]
            </button>
          )}
        </div>
      </div>

      {/* Global + Local Live Telemetry & Multi-Layer Overlay Toggle Ribbon */}
      <div className="px-2.5 py-1 bg-[#050b0f] border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-1.5 text-[9.5px] shrink-0">
        {/* Live Global & Local Environmental Metrics */}
        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span
            className={`px-1.5 py-0.5 rounded border font-bold whitespace-nowrap ${
              (globalMacro?.spaceWeather?.kpIndex ?? 0) >= 5
                ? 'bg-red-950/80 text-red-300 border-red-500/60'
                : 'bg-slate-900 text-cyan-300 border-slate-800'
            }`}
            title={globalMacro?.spaceWeather?.gnssAndHfImpact || 'NOAA SWPC Planetary Geomagnetic Kp Index'}
          >
            ☀ SWPC: Kp {globalMacro?.spaceWeather?.kpIndex ?? '--'} (
            {globalMacro?.spaceWeather?.stormLevel || 'SYNCING'})
          </span>
          <span
            className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 border border-slate-800 whitespace-nowrap"
            title="Live Worldwide USGS M2.5+ Seismic + NASA EONET Active Wildfires/Volcanoes"
          >
            🌍 GLOBAL: {globalMacro?.seismicCount24h ?? 0} SEISMIC •{' '}
            {globalMacro?.eonetActiveCount ?? 0} EONET
          </span>
          {localEnv && (
            <span
              className={`px-1.5 py-0.5 rounded border whitespace-nowrap flex items-center gap-1 ${
                localEnv.opticalPassStatus === 'CLOUD_OBSCURED'
                  ? 'bg-amber-950/70 text-amber-200 border-amber-500/50'
                  : 'bg-slate-900 text-emerald-300 border-slate-800'
              }`}
              title="Live Open-Meteo Target Wind, Cloud Deck & Air Quality"
            >
              <Wind className="w-2.5 h-2.5 shrink-0" />
              <span>
                {localEnv.windSpeedKts ?? '--'}kt@{localEnv.windDirectionDeg ?? '--'}° • CLD:{' '}
                {localEnv.cloudCoverPct ?? '--'}% • VIS: {localEnv.visibilityKm ?? '--'}km
                {localEnv.usAqi !== null ? ` • AQI:${localEnv.usAqi}` : ''}
              </span>
            </span>
          )}
        </div>

        {/* Interactive Overlay Layer Toggles */}
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setShowHybridLabels((v) => !v)}
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
              showHybridLabels
                ? 'bg-emerald-950/80 text-emerald-200 border-emerald-500/60'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="Overlay transparent Esri Roads, Streets, Ports & Border Labels for precision pinpointing"
          >
            🗺️ LABELS:{showHybridLabels ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            onClick={() =>
              setOverlayVisibility((v) => ({
                ...v,
                adsbAirspace: !v.adsbAirspace,
              }))
            }
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer flex items-center gap-0.5 ${
              overlayVisibility.adsbAirspace
                ? 'bg-sky-950/85 text-sky-200 border-sky-500/60'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="Toggle Live ADS-B Airspace Radar Vectors"
          >
            <Plane className="w-2.5 h-2.5" />
            <span>AIR:{airspaceData.totalCount}</span>
          </button>

          {overlayVisibility.adsbAirspace && (
            <button
              type="button"
              onClick={() =>
                setOverlayVisibility((v) => ({
                  ...v,
                  adsbTacticalOnly: !v.adsbTacticalOnly,
                }))
              }
              className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
                overlayVisibility.adsbTacticalOnly
                  ? 'bg-fuchsia-950/85 text-fuchsia-200 border-fuchsia-400/70'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
              title="Filter ADS-B to Military, Government, Rotorcraft & Emergency Squawks Only"
            >
              MIL/TAC:{airspaceData.tacticalCount}
            </button>
          )}

          <button
            type="button"
            onClick={() =>
              setOverlayVisibility((v) => ({
                ...v,
                cctvNodes: !v.cctvNodes,
              }))
            }
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
              overlayVisibility.cctvNodes
                ? 'bg-teal-950/85 text-teal-200 border-teal-400/60'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="Toggle Geotagged Live Public CCTV Camera Nodes on Map"
          >
            📹 CAM:{cctvSweep.inSectorCameras.length || mapCctvNodes.length}
          </button>

          <button
            type="button"
            onClick={() =>
              setOverlayVisibility((v) => ({
                ...v,
                globalHazards: !v.globalHazards,
              }))
            }
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
              overlayVisibility.globalHazards
                ? 'bg-orange-950/85 text-orange-200 border-orange-400/60'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
            title="Toggle Global USGS Seismic + NASA EONET Wildfires/Volcanoes/Storms"
          >
            🌋 HAZARDS:{globalMacro?.hazards.length ?? 0}
          </button>

          <button
            type="button"
            onClick={() => setPinpointMode((p) => !p)}
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
              pinpointMode
                ? 'bg-yellow-500/25 text-yellow-200 border-yellow-400'
                : 'bg-slate-900 text-slate-300 border-slate-800'
            }`}
            title="Pinpoint Mode: Click anywhere on the map to drop an exact 5-decimal target reticle"
          >
            📌 PINPOINT:{pinpointMode ? 'ARMED' : 'CLICK'}
          </button>

          <button
            type="button"
            onClick={() => setShowCctvDock((d) => !d)}
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer flex items-center gap-0.5 ${
              showCctvDock
                ? 'bg-emerald-600/35 text-emerald-100 border-emerald-400'
                : 'bg-slate-900 text-emerald-300 border-emerald-500/40'
            }`}
            title="Open Live Multi-Camera CCTV Recon Matrix & Global Hub Switcher"
          >
            <Video className="w-2.5 h-2.5" />
            <span>CCTV MATRIX</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTacticalPins((prev) => !prev)}
            className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
              showTacticalPins
                ? 'bg-emerald-950/80 text-emerald-200 border-emerald-400/60'
                : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
            title="Toggle Interactive Canvas Overlay"
          >
            HUD:{showTacticalPins ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Quick Sector Coordinate Lock Bar + Precision Search Input */}
      <div className="px-3 py-1.5 sm:px-3.5 bg-[#0a1118] border-b border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[10px] uppercase font-bold text-emerald-400 shrink-0 mr-1 flex items-center gap-1">
            <Compass className="w-3 h-3" /> Sectors:
          </span>
          {TACTICAL_SECTOR_PRESETS.map((preset) => {
            const isSelected =
              Math.abs(preset.lat - lat) < 0.04 && Math.abs(preset.lon - lon) < 0.04;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-2 py-0.5 rounded text-[9.5px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400'
                    : 'bg-slate-900 text-slate-400 hover:text-emerald-200 border border-slate-800'
                }`}
              >
                {preset.sectorCode.split(' // ')[0]} ({preset.label.split(' (')[0].slice(0, 16)})
              </button>
            );
          })}
        </div>

        <form onSubmit={handleCommandLockSubmit} className="flex items-center gap-1.5 shrink-0">
          <input
            id="satellite-command-input"
            name="satellite_command_input"
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Street Address, ZIP/Postcode (SW1A 1AA, 90210), or Lat, Lon"
            className="w-full sm:w-72 px-2.5 py-1 text-[11px] bg-slate-950 border border-emerald-500/40 rounded text-emerald-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={isGeocoding}
            className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/60 text-emerald-200 text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
            title="Geocode street, postal code, city, or coordinates and lock orbital feed"
          >
            <Crosshair className={`w-3 h-3 ${isGeocoding ? 'animate-spin' : ''}`} />
            <span>{isGeocoding ? 'Locating...' : 'Pinpoint'}</span>
          </button>
        </form>
      </div>

      {geocodeStatusMsg && (
        <div className="px-3.5 py-1 bg-emerald-950/70 border-b border-emerald-500/40 text-[10px] text-emerald-200 flex items-center justify-between shrink-0">
          <span>🎯 {geocodeStatusMsg}</span>
          <button
            type="button"
            onClick={() => setGeocodeStatusMsg(null)}
            className="text-emerald-400 hover:text-white px-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main 2D Tactical Raster Viewport + Hybrid Reference Layer + 60FPS Multi-INT Canvas + PiP CCTV */}
      <div
        ref={viewportContainerRef}
        className={`relative w-full ${
          overlayMode
            ? 'flex-1 min-h-[240px]'
            : compact
            ? 'h-80 sm:h-96'
            : 'h-96 sm:h-[470px]'
        } bg-[#020804] select-none overflow-hidden`}
      >
        {/* Filtered Tile Raster Container (.tactical-satellite-monitor) */}
        <div
          className={`tactical-satellite-monitor ${shaderClass} w-full h-full relative flex items-center justify-center pointer-events-none`}
        >
          {feedLayer === 'nasa_gibs_wvs_composite' && !wvsSnapshotError ? (
            <img
              src={wvsCompositeUrl}
              alt={`NASA GIBS Composite ${targetLabel}`}
              crossOrigin="anonymous"
              onError={() => setWvsSnapshotError(true)}
              className="w-full h-full object-cover block"
            />
          ) : (
            /* 7x5 Uncropped 256x256 Slippy Tile Matrix (Zero transition lag during 60FPS drag!) */
            <div
              className="relative shrink-0 will-change-transform"
              style={{
                width: `${GRID_COLS * TILE_SIZE_PX}px`,
                height: `${GRID_ROWS * TILE_SIZE_PX}px`,
                transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
              }}
            >
              {seamlessTileCanvas.map((tile) => {
                const useFallback = tileErrors[tile.key];
                const leftPx = (tile.dx + 3) * TILE_SIZE_PX;
                const topPx = (tile.dy + 2) * TILE_SIZE_PX;
                const renderHybridOnTile =
                  showHybridLabels && feedLayer !== 'carto_dark_tactical';
                return (
                  <div
                    key={tile.key}
                    style={{
                      position: 'absolute',
                      left: `${leftPx}px`,
                      top: `${topPx}px`,
                      width: `${TILE_SIZE_PX}px`,
                      height: `${TILE_SIZE_PX}px`,
                    }}
                    className="bg-[#030b06]"
                  >
                    <img
                      src={useFallback ? tile.fallbackEsriUrl : tile.url}
                      alt=""
                      draggable={false}
                      crossOrigin="anonymous"
                      loading="eager"
                      onError={() => {
                        if (!useFallback) {
                          setTileErrors((prev) => ({ ...prev, [tile.key]: true }));
                        }
                      }}
                      style={{
                        width: `${TILE_SIZE_PX}px`,
                        height: `${TILE_SIZE_PX}px`,
                        display: 'block',
                      }}
                    />
                    {/* Hybrid Roads & Street/Place Labels Overlay for Precision Pinpointing */}
                    {renderHybridOnTile && tile.z >= 7 && (
                      <img
                        src={tile.roadsRefUrl}
                        alt=""
                        draggable={false}
                        crossOrigin="anonymous"
                        loading="eager"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${TILE_SIZE_PX}px`,
                          height: `${TILE_SIZE_PX}px`,
                          opacity: 0.78,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                    {renderHybridOnTile && (
                      <img
                        src={tile.placesRefUrl}
                        alt=""
                        draggable={false}
                        crossOrigin="anonymous"
                        loading="eager"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: `${TILE_SIZE_PX}px`,
                          height: `${TILE_SIZE_PX}px`,
                          opacity: 0.92,
                          pointerEvents: 'none',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Interactive 60FPS Multi-INT Canvas Overlay (Drag-Pan, Wheel-Zoom, ADS-B, CCTV, Hazards, Pins) */}
        {showTacticalPins && (
          <div className="absolute inset-0 z-20">
            <TacticalMapOverlay
              intelligencePins={intelligencePins}
              airspaceTracks={airspaceData.tracks}
              cctvCameras={mapCctvNodes}
              globalHazards={globalMacro?.hazards || []}
              overlayVisibility={overlayVisibility}
              pinpointMode={pinpointMode}
              pinpointTarget={pinpointTarget}
              activeNai={activeNai}
              centerLat={lat}
              centerLon={lon}
              zoom={effectiveZoom}
              maxZoom={18}
              onSelectPin={(pin) => setHasActivePinDossier(Boolean(pin))}
              onSelectCctv={(cam) => handleOpenCameraInPip(cam)}
              onClustersMutated={refreshIntelligencePins}
              onCursorTelemetryChange={setCursorTelemetry}
              onPanZoomChange={(next) => {
                setLat(next.lat);
                setLon(next.lon);
                if (typeof next.zoom === 'number') {
                  if (
                    next.zoom > 9 &&
                    (feedLayer === 'nasa_gibs_modis_terra' ||
                      feedLayer === 'nasa_gibs_viirs_snpp')
                  ) {
                    setFeedLayer('esri_world_imagery');
                  }
                  setZoom(next.zoom);
                }
              }}
              onSpotPinpoint={({ lat: sLat, lon: sLon, lockCenter }) => {
                setPinpointTarget({
                  lat: sLat,
                  lon: sLon,
                  label: `Pinpoint (${sLat.toFixed(5)}°, ${sLon.toFixed(5)}°)`,
                });
                if (lockCenter) {
                  setLat(sLat);
                  setLon(sLon);
                  setTargetLabel(`Pinpoint (${sLat.toFixed(5)}°, ${sLon.toFixed(5)}°)`);
                  setSectorCode(`PINPOINT // ${sLat.toFixed(3)}°, ${sLon.toFixed(3)}°`);
                }
              }}
              onLockNaiAtCoords={(coords) => handleLockNaiAtCoords(coords)}
              onFlyToPin={(pin) => {
                setIsFlyToLocking(true);
                setLat(pin.lat);
                setLon(pin.lon);
                setTargetLabel(pin.title);
                setSectorCode(`PIN-LOCK // ${pin.lat.toFixed(3)}°, ${pin.lon.toFixed(3)}°`);
                setWvsSnapshotError(false);
                setTimeout(() => setIsFlyToLocking(false), 650);
              }}
              onDispatchPinDirective={
                onDispatchReconDirective
                  ? (pin) => {
                      onDispatchReconDirective(
                        `Execute tactical OSINT & live sensor verification on target "${pin.title}" — ${pin.summary}`,
                        {
                          lat: pin.lat,
                          lon: pin.lon,
                          label: pin.title,
                        }
                      );
                    }
                  : undefined
              }
            />
          </div>
        )}

        {/* Draggable Floating Live CCTV Picture-in-Picture (PiP) Window */}
        {activePipCamera && (
          <div
            ref={pipPanelRef}
            style={{ left: `${pipPos.left}px`, top: `${pipPos.top}px` }}
            className="absolute z-40 w-72 sm:w-80 bg-slate-950/95 border-2 border-emerald-400/80 rounded-md shadow-[0_12px_36px_rgba(0,0,0,0.95)] overflow-hidden text-[10px] pointer-events-auto"
          >
            {/* Accessible Dedicated Drag Handle Button (MWG `drag` specification) */}
            <div className="flex items-center justify-between bg-[#061812] border-b border-emerald-500/40 px-2 py-1 gap-1">
              <button
                ref={pipHandleRef}
                type="button"
                aria-label="Live CCTV feed panel handle. Use arrow keys to move."
                onPointerDown={(ev) => {
                  if (ev.button !== 0 || !pipPanelRef.current || !pipHandleRef.current) return;
                  const panelRect = pipPanelRef.current.getBoundingClientRect();
                  const containerRect = viewportContainerRef.current?.getBoundingClientRect();
                  const baseLeft = panelRect.left - (containerRect?.left ?? 0);
                  const baseTop = panelRect.top - (containerRect?.top ?? 0);
                  pipDragOffsetRef.current = {
                    offsetX: ev.clientX - baseLeft,
                    offsetY: ev.clientY - baseTop,
                  };
                  pipHandleRef.current.setPointerCapture(ev.pointerId);
                }}
                onPointerMove={(ev) => {
                  const handle = pipHandleRef.current;
                  if (!handle || !handle.hasPointerCapture(ev.pointerId) || !pipDragOffsetRef.current)
                    return;
                  handle.classList.add('dragging');
                  movePipClamped(
                    ev.clientX - pipDragOffsetRef.current.offsetX,
                    ev.clientY - pipDragOffsetRef.current.offsetY
                  );
                }}
                onLostPointerCapture={() => {
                  pipHandleRef.current?.classList.remove('dragging');
                  pipDragOffsetRef.current = null;
                  setPipAnnouncement('Live CCTV panel repositioned');
                  setTimeout(() => setPipAnnouncement(''), 1000);
                }}
                onKeyDown={(ev) => {
                  const step = 15;
                  if (ev.key === 'ArrowLeft') {
                    ev.preventDefault();
                    movePipClamped(pipPos.left - step, pipPos.top);
                    setPipAnnouncement('Live CCTV panel moved left');
                  } else if (ev.key === 'ArrowRight') {
                    ev.preventDefault();
                    movePipClamped(pipPos.left + step, pipPos.top);
                    setPipAnnouncement('Live CCTV panel moved right');
                  } else if (ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    movePipClamped(pipPos.left, pipPos.top - step);
                    setPipAnnouncement('Live CCTV panel moved up');
                  } else if (ev.key === 'ArrowDown') {
                    ev.preventDefault();
                    movePipClamped(pipPos.left, pipPos.top + step);
                    setPipAnnouncement('Live CCTV panel moved down');
                  }
                }}
                className="recon-drag-handle flex items-center gap-1.5 text-emerald-300 font-bold truncate flex-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-300 rounded px-1 py-0.5"
                title="Drag or focus and use arrow keys to reposition CCTV window"
              >
                <GripHorizontal className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                <span className="truncate">📹 {activePipCamera.name}</span>
              </button>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => movePipClamped(12, 52)}
                  className="px-1 py-0.5 text-[8.5px] rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
                  title="Dock CCTV Window Top-Left"
                >
                  ↖
                </button>
                <button
                  type="button"
                  onClick={() => setActivePipCamera(null)}
                  className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-500/50 cursor-pointer"
                  aria-label="Close Live CCTV Feed"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Live Video / Live Refreshing Frame Viewport */}
            <div
              className={`relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden ${
                pipNvgFilter ? 'tactical-satellite-monitor' : ''
              }`}
            >
              {pipVideoMode === 'VIDEO' &&
              activePipCamera.videoUrl &&
              activePipCamera.streamType === 'MP4_CLIP' ? (
                <video
                  key={`${activePipCamera.id}-video-${cctvRefreshTick}`}
                  src={activePipCamera.videoUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  className="w-full h-full object-cover"
                />
              ) : (
                <img
                  key={`${activePipCamera.id}-img-${cctvRefreshTick}`}
                  src={buildFreshCameraImageUrl(activePipCamera, cctvRefreshTick)}
                  alt={activePipCamera.name}
                  className="w-full h-full object-cover"
                />
              )}
              <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 border border-red-500/60 text-[8.5px] font-bold text-red-300 flex items-center gap-1 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                <span>LIVE // {activePipCamera.networkLabel}</span>
              </div>
            </div>

            {/* PiP Camera Metadata & Controls */}
            <div className="p-2 space-y-1.5 bg-slate-950">
              <div className="flex items-center justify-between text-[9px] text-slate-300">
                <span>
                  {activePipCamera.lat.toFixed(4)}°, {activePipCamera.lon.toFixed(4)}°
                </span>
                <span className="text-emerald-300 font-bold">
                  {activePipCamera.distanceKm !== undefined
                    ? `${activePipCamera.distanceKm} km @ ${activePipCamera.bearingDeg ?? 0}°`
                    : activePipCamera.regionLabel}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {activePipCamera.videoUrl && activePipCamera.streamType === 'MP4_CLIP' && (
                  <button
                    type="button"
                    onClick={() =>
                      setPipVideoMode((m) => (m === 'VIDEO' ? 'STILL' : 'VIDEO'))
                    }
                    className="px-1.5 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold cursor-pointer"
                  >
                    {pipVideoMode === 'VIDEO' ? '[📷 STILL]' : '[▶ MP4 CLIP]'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCctvRefreshTick((t) => t + 1)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 font-bold cursor-pointer"
                >
                  [↻ FRAME]
                </button>
                <button
                  type="button"
                  onClick={() => setPipNvgFilter((f) => !f)}
                  className={`px-1.5 py-0.5 rounded border font-bold cursor-pointer ${
                    pipNvgFilter
                      ? 'bg-emerald-900 text-emerald-200 border-emerald-400'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  }`}
                >
                  [NVG]
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLat(activePipCamera.lat);
                    setLon(activePipCamera.lon);
                    setZoom(16);
                    if (feedLayer !== 'esri_world_imagery' && feedLayer !== 'carto_dark_tactical') {
                      setFeedLayer('esri_world_imagery');
                    }
                    setTargetLabel(activePipCamera.name);
                    setSectorCode(`CCTV-LOCK // ${activePipCamera.networkLabel}`);
                  }}
                  className="px-1.5 py-0.5 rounded bg-sky-950 hover:bg-sky-900 border border-sky-500/60 text-sky-200 font-bold cursor-pointer"
                >
                  [🎯 FLY Z:16]
                </button>
                {activePipCamera.networkId === 'OPERATOR_CUSTOM' && (
                  <button
                    type="button"
                    onClick={() => {
                      removeCustomCctvCamera(activePipCamera.id);
                      setActivePipCamera(null);
                      refreshLiveViewportTelemetry(lat, lon, true);
                    }}
                    className="px-1.5 py-0.5 rounded bg-red-950 hover:bg-red-900 border border-red-500/60 text-red-200 font-bold cursor-pointer ml-auto"
                    title="Remove Custom Camera"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tactical HUD Overlays (Pointer-events-none wrapper with interactive corner controls) */}
        <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-2 sm:p-2.5">
          {/* Top-Left & Top-Right HUD Telemetry Callouts */}
          <div className="flex items-start justify-between gap-2">
            <div className="bg-black/80 border border-emerald-500/60 px-2 py-1 rounded text-[9px] sm:text-[10px] text-emerald-300 space-y-0.5 shadow-[0_0_15px_rgba(0,0,0,0.85)]">
              <div className="font-bold text-emerald-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span className="truncate max-w-[175px] sm:max-w-none">
                  {feedLayer === 'esri_world_imagery'
                    ? 'ESRI OPTICAL + HYBRID REF'
                    : feedLayer === 'carto_dark_tactical'
                    ? 'C2 DARK VECTOR RADAR'
                    : feedLayer === 'nasa_gibs_wvs_composite'
                    ? 'NASA WORLDVIEW COMPOSITE'
                    : 'NASA GIBS WMTS (DAILY)'}
                </span>
              </div>
              <div>
                CENTER: <strong className="text-white">{lat.toFixed(5)}°</strong>,{' '}
                <strong className="text-white">{lon.toFixed(5)}°</strong> •{' '}
                <strong className="text-cyan-300">Z:{effectiveZoom}/18</strong>
              </div>
            </div>

            <div className="bg-black/80 border border-amber-500/60 px-2 py-1 rounded text-[9px] sm:text-[10px] text-amber-300 text-right shadow-[0_0_15px_rgba(0,0,0,0.85)]">
              <div className="font-bold uppercase truncate max-w-[155px] sm:max-w-none">
                {threatBadgeText}
              </div>
              <div className="text-emerald-300">OVERWATCH: {activeOperativeName.toUpperCase()}</div>
            </div>
          </div>

          {/* Subtle Precision Center Reticle (Compact so street/building targets underneath remain unobstructed!) */}
          <div className="relative flex items-center justify-center my-auto">
            <div className="relative w-24 h-24 sm:w-36 sm:h-36 rounded-full border border-emerald-400/25 flex items-center justify-center">
              <div
                className="tactical-radar-cone absolute inset-0 rounded-full"
                style={{
                  background:
                    'conic-gradient(from 0deg, rgba(16, 185, 129, 0.14) 0deg, rgba(16, 185, 129, 0.0) 55deg, transparent 360deg)',
                }}
              />
              <div
                className={`relative w-8 h-8 sm:w-10 sm:h-10 border ${
                  isFlyToLocking ? 'border-amber-400 scale-125' : 'border-emerald-400/75 scale-100'
                } transition-all duration-300 flex items-center justify-center`}
              >
                <div className="w-1 h-1 bg-emerald-300 rounded-full" />
              </div>
            </div>
          </div>

          {/* Bottom HUD Bar: Live Cursor Lat/Lon/Range/Bearing + Precision Fine-Nudge & NAI Lock Controls */}
          <div className="flex flex-wrap items-end justify-between gap-2">
            {!hasActivePinDossier && (
              <div className="bg-black/85 border border-emerald-500/50 px-2 py-1 rounded text-[9.5px] text-emerald-200 max-w-full sm:max-w-lg">
                {cursorTelemetry ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-yellow-300 font-bold">
                      CURSOR: {cursorTelemetry.lat.toFixed(5)}°, {cursorTelemetry.lon.toFixed(5)}°
                    </span>
                    <span className="text-cyan-300">
                      RNG: {cursorTelemetry.distanceKm} km • BRG:{' '}
                      {String(cursorTelemetry.bearingDeg).padStart(3, '0')}°
                    </span>
                    <span className="hidden md:inline text-slate-400">
                      (Drag pan • Wheel zoom • Dbl-click / Shift+click pinpoint)
                    </span>
                  </div>
                ) : (
                  <span className="text-emerald-300/90">
                    Drag map smoothly to pan • Scroll wheel to zoom up to street Z:18 • Click any
                    📹 CCTV, ✈️ ADS-B, or 🎯 Pin
                  </span>
                )}
              </div>
            )}

            {/* Interactive Map Fine-Nudge, Zoom, NAI Lock & Keystrokes Help Controls */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 bg-black/90 border border-emerald-500/60 p-1 rounded ml-auto">
              <button
                type="button"
                onClick={() => handleLockNaiAtCoords({ lat, lon, label: targetLabel })}
                className="px-1.5 py-1 text-[9.5px] font-bold bg-cyan-950/90 hover:bg-cyan-900 text-cyan-200 rounded border border-cyan-500/60 cursor-pointer"
                title="Lock Active NAI Geofence & Threat Matrix to current crosshair center"
              >
                🛡️ LOCK NAI
              </button>
              <div className="h-4 w-[1px] bg-emerald-500/30 mx-0.5" />
              <button
                type="button"
                onClick={(e) => handleDirectionalPan(0, -1, e.shiftKey)}
                className="px-1.5 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Nudge North (Hold Shift for ultra-fine ~10m step)"
              >
                N
              </button>
              <button
                type="button"
                onClick={(e) => handleDirectionalPan(0, 1, e.shiftKey)}
                className="px-1.5 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Nudge South (Hold Shift for ultra-fine ~10m step)"
              >
                S
              </button>
              <button
                type="button"
                onClick={(e) => handleDirectionalPan(-1, 0, e.shiftKey)}
                className="px-1.5 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Nudge West (Hold Shift for ultra-fine ~10m step)"
              >
                W
              </button>
              <button
                type="button"
                onClick={(e) => handleDirectionalPan(1, 0, e.shiftKey)}
                className="px-1.5 py-1 text-[10px] font-bold bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Nudge East (Hold Shift for ultra-fine ~10m step)"
              >
                E
              </button>
              <div className="h-4 w-[1px] bg-emerald-500/30 mx-0.5" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(2, z - 1))}
                className="p-1 bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-1 text-[10px] font-bold text-emerald-300">Z:{effectiveZoom}</span>
              <button
                type="button"
                onClick={() => {
                  if (
                    (feedLayer === 'nasa_gibs_modis_terra' ||
                      feedLayer === 'nasa_gibs_viirs_snpp') &&
                    effectiveZoom >= 9
                  ) {
                    setFeedLayer('esri_world_imagery');
                    setZoom(11);
                  } else {
                    setZoom((z) => Math.min(18, z + 1));
                  }
                }}
                className="p-1 bg-slate-900 hover:bg-emerald-950 text-emerald-300 rounded border border-slate-800 cursor-pointer"
                title="Zoom In (Up to Street Level Z:18)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowKeyShortcutsHelp((h) => !h)}
                className="px-1.5 py-1 text-[9.5px] font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-700 cursor-pointer"
                aria-label="Show keyboard navigation shortcuts"
                title="Keyboard Shortcuts"
              >
                ⌨️
              </button>
            </div>
          </div>

          {showKeyShortcutsHelp && (
            <div className="pointer-events-auto self-end mt-1 bg-slate-950/95 border border-emerald-500/60 rounded p-2 text-[9.5px] text-slate-200 shadow-lg max-w-xs">
              <div className="font-bold text-emerald-300 mb-1 flex items-center justify-between">
                <span>⌨️ RECON NAVIGATION KEYS</span>
                <button
                  type="button"
                  onClick={() => setShowKeyShortcutsHelp(false)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <ul className="space-y-0.5 text-slate-300">
                <li>• <strong>Pointer Drag:</strong> Smooth 1:1 sub-pixel pan</li>
                <li>• <strong>Scroll Wheel / + / -:</strong> Cursor-anchored zoom (Z:2–18)</li>
                <li>• <strong>Arrow Keys:</strong> Pan map (<strong>Shift+Arrows</strong> fine step)</li>
                <li>• <strong>Click / Shift+Click / Dbl-Click:</strong> Pinpoint exact spot</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Multi-Camera Live CCTV Recon Matrix & Global Strategic Hub Switcher */}
      {showCctvDock && (
        <div className="recon-containment-pillar border-t border-emerald-500/50 bg-[#050c0e] p-2.5 space-y-2 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold text-emerald-300 uppercase flex items-center gap-1">
                <Video className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  {cctvSweep.inSectorCameras.length > 0
                    ? `LIVE IN-SECTOR CCTV FEEDS (${cctvSweep.inSectorCameras.length} WITHIN 140KM)`
                    : `GLOBAL STRATEGIC CCTV MATRIX (${cctvSweep.totalCatalogCount} LIVE CAMERAS INDEXED)`}
                </span>
              </span>
              <span className="text-[9.5px] text-slate-400">
                Auto-refreshing 10s • Click any feed for draggable PiP + street lock
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAddCustomCamForm((s) => !s)}
                className="px-2 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Custom CCTV URL</span>
              </button>
              <button
                type="button"
                onClick={() => setCctvRefreshTick((t) => t + 1)}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[10px] font-bold cursor-pointer"
              >
                ↻ Refresh All
              </button>
            </div>
          </div>

          {/* 1-Click Global Live CCTV Hub Jump Pills */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
            <span className="text-[9.5px] font-bold text-cyan-400 shrink-0 flex items-center gap-1 mr-1">
              <Globe className="w-3 h-3" /> Jump to Live CCTV Grid:
            </span>
            {CCTV_STRATEGIC_HUBS.map((hub) => (
              <button
                key={hub.id}
                type="button"
                onClick={() => {
                  setLat(hub.lat);
                  setLon(hub.lon);
                  setZoom(hub.zoom);
                  if (feedLayer !== 'esri_world_imagery' && feedLayer !== 'carto_dark_tactical') {
                    setFeedLayer('esri_world_imagery');
                  }
                  setTargetLabel(hub.label);
                  setSectorCode(hub.sectorCode);
                }}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-teal-950 text-teal-200 border border-teal-500/40 text-[9.5px] font-bold whitespace-nowrap cursor-pointer"
              >
                {hub.shortTag}
              </button>
            ))}
          </div>

          {/* Custom Operator CCTV Registration Bar */}
          {showAddCustomCamForm && (
            <form
              onSubmit={handleAddCustomCamSubmit}
              className="p-2 rounded bg-slate-950 border border-emerald-500/40 flex flex-wrap items-center gap-2 text-[10px]"
            >
              <input
                id="custom-cctv-name-input"
                name="custom_cctv_name"
                type="text"
                value={customCamName}
                onChange={(e) => setCustomCamName(e.target.value)}
                placeholder="Camera Label (e.g. Port Gate North)"
                className="w-44 px-2 py-1 bg-black border border-slate-700 rounded text-emerald-100"
              />
              <input
                id="custom-cctv-url-input"
                name="custom_cctv_url"
                type="url"
                required
                value={customCamUrl}
                onChange={(e) => setCustomCamUrl(e.target.value)}
                placeholder="https://... (.jpg, .mjpeg, .mp4, or .m3u8 live URL)"
                className="flex-1 min-w-[220px] px-2 py-1 bg-black border border-slate-700 rounded text-emerald-100"
              />
              <span className="text-slate-400">
                Pins to {(pinpointTarget?.lat ?? lat).toFixed(4)}°,{' '}
                {(pinpointTarget?.lon ?? lon).toFixed(4)}°
              </span>
              <button
                type="submit"
                className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400 text-emerald-100 font-bold cursor-pointer"
              >
                Save &amp; Stream
              </button>
            </form>
          )}

          {/* 4-Column Live Thumbnail Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-56 overflow-y-auto">
            {dockCameras.map((cam) => (
              <button
                key={cam.id}
                type="button"
                onClick={() => handleOpenCameraInPip(cam)}
                className="group text-left bg-slate-950 border border-slate-800 hover:border-emerald-400 rounded overflow-hidden flex flex-col cursor-pointer transition-colors"
              >
                <div className="relative w-full aspect-video bg-black overflow-hidden">
                  <img
                    src={buildFreshCameraImageUrl(cam, cctvRefreshTick)}
                    alt={cam.name}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/80 text-[8px] font-bold text-emerald-300 border border-emerald-500/40">
                    {cam.networkLabel}
                  </span>
                  {cam.distanceKm !== undefined && (
                    <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[8px] text-cyan-200">
                      {cam.distanceKm} km
                    </span>
                  )}
                </div>
                <div className="p-1.5">
                  <div className="text-[9.5px] font-bold text-slate-100 truncate">{cam.name}</div>
                  <div className="text-[8.5px] text-slate-400 truncate">
                    {cam.regionLabel} • {cam.lat.toFixed(3)}°, {cam.lon.toFixed(3)}°
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default TacticalSatelliteMonitor;
