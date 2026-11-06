import React, { useState, useEffect, useMemo } from 'react';
import {
  Crosshair,
  Compass,
  Radar,
  Calendar,
  ZoomIn,
  ZoomOut,
  Eye,
  Maximize2,
} from 'lucide-react';

export type SatelliteFeedLayerId =
  | 'esri_world_imagery'
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
    defaultZoom: 8,
    telemetryNote: 'Equinix Ashburn IXP & PJM high-voltage transmission corridor.',
  },
  {
    id: 'med_red_sea',
    label: 'Suez Canal & Red Sea Subsea Cable Corridor',
    sectorCode: 'SECTOR-54 // SUEZ-CHOKELINE',
    lat: 30.5852,
    lon: 32.2654,
    defaultZoom: 8,
    telemetryNote: 'AAE-1 / SEACOM / EIG submarine fiber trunk & maritime transit chokepoint.',
  },
  {
    id: 'western_europe',
    label: 'DE-CIX Frankfurt & ENTSO-E Core Grid',
    sectorCode: 'SECTOR-22 // EU-CENTRAL',
    lat: 50.1109,
    lon: 8.6821,
    defaultZoom: 8,
    telemetryNote: 'European continental synchronous grid & primary internet exchange node.',
  },
  {
    id: 'strait_hormuz',
    label: 'Strait of Hormuz & Persian Gulf Energy Corridor',
    sectorCode: 'SECTOR-39 // HORMUZ-WATCH',
    lat: 26.5667,
    lon: 56.25,
    defaultZoom: 8,
    telemetryNote: 'AIS tanker chokepoint & regional GNSS L1 interference zone.',
  },
  {
    id: 'indo_pacific',
    label: 'Strait of Malacca & Singapore Maritime Hub',
    sectorCode: 'SECTOR-71 // APAC-MALACCA',
    lat: 1.3521,
    lon: 103.8198,
    defaultZoom: 8,
    telemetryNote: 'Trans-Pacific / Intra-Asia submarine cable landing & container port hub.',
  },
  {
    id: 'taiwan_strait',
    label: 'Taiwan Strait & Hsinchu Semiconductor Sector',
    sectorCode: 'SECTOR-88 // APAC-NORTH',
    lat: 24.8138,
    lon: 120.9675,
    defaultZoom: 8,
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
 * Strict coordinate pair parser:
 * Avoids false-matching 5-digit US ZIP codes (e.g. "90210" -> "90 210") or UK postcodes (e.g. "SW1A 1AA").
 * Requires either:
 *   - An explicit comma or slash between two numbers (e.g. "30.58, 32.26"), OR
 *   - Explicit decimal points or N/S/E/W hemisphere suffixes on the numbers (e.g. "38.90N 77.03W").
 */
export function parseExplicitLatLon(input: string): { lat: number; lon: number } | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  // Reject pure 4-to-10 digit postal/ZIP codes immediately (e.g. "90210", "78701-1234", "10001")
  if (/^\d{4,6}(-\d{3,4})?$/.test(raw)) return null;
  // Reject UK/Canadian alphanumeric postal codes (e.g. "SW1A 1AA", "EC1A 1BB", "M5V 3L9", "K1A 0B1")
  if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(raw)) return null;
  if (/^[A-Z]\d[A-Z]\s*\d[A-Z]\d$/i.test(raw)) return null;

  // 1. Comma-separated coordinate pair: "38.9072, -77.0369" or "30, 31"
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

  // 2. Space-separated coordinate pair ONLY when decimals or N/S/E/W cardinal indicators are present
  const spaceCoord = raw.match(
    /^(-?\d{1,2}\.\d+)\s*([NSns])?\s+(-?\d{1,3}\.\d+)\s*([EWew])?$/
  ) || raw.match(
    /^(\d{1,2}(?:\.\d+)?)\s*([NSns])\s+(\d{1,3}(?:\.\d+)?)\s*([EWew])$/i
  );
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

/**
 * Parses natural language directives or sector commands into target coordinates synchronously (for known presets/coords).
 * Returns null for postal codes, cities, or addresses so `resolveReconLocationAsync` can geocode them accurately.
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

  // 1. Strict explicit lat, lon pair
  const explicitCoords = parseExplicitLatLon(raw);
  if (explicitCoords) {
    return {
      lat: explicitCoords.lat,
      lon: explicitCoords.lon,
      label: `Custom Target (${explicitCoords.lat.toFixed(4)}°, ${explicitCoords.lon.toFixed(4)}°)`,
      sectorCode: 'SECTOR-CUSTOM // LOCKED',
      zoom: 11,
    };
  }

  const lower = raw.toLowerCase();

  // 2. Named Sector Numbers or Keywords
  if (lower.includes('sector 54') || lower.includes('suez') || lower.includes('red sea')) {
    return TACTICAL_SECTOR_PRESETS[1];
  }
  if (lower.includes('sector 14') || lower.includes('ashburn') || lower.includes('us-east')) {
    return TACTICAL_SECTOR_PRESETS[0];
  }
  if (lower.includes('sector 22') || lower.includes('frankfurt')) {
    return TACTICAL_SECTOR_PRESETS[2];
  }
  if (lower.includes('sector 39') || lower.includes('hormuz') || lower.includes('persian gulf')) {
    return TACTICAL_SECTOR_PRESETS[3];
  }
  if (lower.includes('sector 71') || lower.includes('malacca')) {
    return TACTICAL_SECTOR_PRESETS[4];
  }
  if (lower.includes('sector 88') || lower.includes('taiwan strait') || lower.includes('hsinchu')) {
    return TACTICAL_SECTOR_PRESETS[5];
  }
  if (lower === 'chernobyl') {
    return { lat: 51.389, lon: 30.099, label: 'Chernobyl / Northern Black Sea Sector', sectorCode: 'SECTOR-61 // EE-WATCH', zoom: 10 };
  }
  if (lower === 'reykjanes') {
    return { lat: 63.88, lon: -22.43, label: 'Reykjanes Volcanic & Subsea Landing Zone', sectorCode: 'SECTOR-09 // NATL-NORTH', zoom: 10 };
  }

  return null;
}

const GEOCODE_CACHE: Record<string, { lat: number; lon: number; label: string; sectorCode: string; zoom: number }> = {};

/**
 * Extracts a clean location / postal code query from natural language directives
 * e.g. "Inspect satellite imagery of 90210" -> "90210"
 *      "Lock on SW1A 1AA" -> "SW1A 1AA"
 */
export function extractLocationQueryFromDirective(input: string): string {
  const trimmed = (input || '').trim();
  const stripped = trimmed
    .replace(/^(?:please\s+)?(?:inspect|scan|recon|check|show|view|lock(?:\s+on(?:\s+to)?)?|fly\s+to|find|search|locate|pull\s+up|satellite(?:\s+imagery)?(?:\s+of|\s+for|\s+near|\s+at)?|grid(?:\s+stability)?(?:\s+near|\s+at|\s+in)?|coordinates(?:\s+for|\s+near|\s+at)?)\s+/i, '')
    .replace(/^(?:near|at|in|for|around|over)\s+/i, '')
    .trim();
  return stripped || trimmed;
}

/**
 * Zero-key multi-source geocoder for Postal Codes (ZIP, UK Postcodes, Canadian, EU, AU) & Global Cities/Addresses:
 * 1. Checks synchronous tactical presets / explicit lat,lon first.
 * 2. Detects US 5-digit ZIP codes (`^\d{5}(-\d{4})?$`), UK postcodes, or Canadian postcodes and queries
 *    Zippopotam.us (`api.zippopotam.us`) + OpenStreetMap Nominatim (`postalcode=...` & `q=...`) + Open-Meteo Geocoding API.
 * 3. Returns accurate coordinates and automatically sets a street/neighborhood zoom level (Z:12–14) for postal codes.
 */
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

  // 1. Check explicit coordinates or exact tactical sector presets first
  const presetMatch = parseReconTargetToCoords(cleaned);
  if (presetMatch) {
    const res = {
      lat: presetMatch.lat,
      lon: presetMatch.lon,
      label: presetMatch.label,
      sectorCode: presetMatch.sectorCode,
      zoom: presetMatch.zoom ?? 9,
    };
    GEOCODE_CACHE[cacheKey] = res;
    return res;
  }

  const compact = cleaned.trim();

  // Helper to cache and return result
  const finalize = (lat: number, lon: number, label: string, codePrefix: string, zoom = 12) => {
    const result = {
      lat,
      lon,
      label,
      sectorCode: `${codePrefix} // ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
      zoom,
    };
    GEOCODE_CACHE[cacheKey] = result;
    return result;
  };

  // 2. US 5-digit ZIP Code (e.g. "90210" or "90210-1234" or "78701, US")
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
          const placeName = `${place['place name']}, ${place['state abbreviation'] || place.state} ${zip5}, USA`;
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, placeName, `ZIP-${zip5}`, 13);
          }
        }
      }
    } catch {}

    // Fallback to Nominatim structured US postalcode search
    try {
      const nomRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(zip5)}&countrycodes=us&limit=1`
      );
      if (nomRes.ok) {
        const nomData: any = await nomRes.json();
        if (Array.isArray(nomData) && nomData.length > 0) {
          const lat = parseFloat(nomData[0].lat);
          const lon = parseFloat(nomData[0].lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, nomData[0].display_name || `ZIP ${zip5}, USA`, `ZIP-${zip5}`, 13);
          }
        }
      }
    } catch {}
  }

  // 3. UK Postcode (e.g. "SW1A 1AA", "EC1A 1BB", "M1 1AE", or Outward code like "SW1A")
  const ukFullMatch = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (ukFullMatch) {
    const formattedUk = `${ukFullMatch[1].toUpperCase()} ${ukFullMatch[2].toUpperCase()}`;
    try {
      // postcodes.io is the official open UK postcode geocoder (zero-key, CORS enabled, street-level precision)
      const ukRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(formattedUk)}`);
      if (ukRes.ok) {
        const ukData: any = await ukRes.json();
        if (ukData?.result && typeof ukData.result.latitude === 'number' && typeof ukData.result.longitude === 'number') {
          const r = ukData.result;
          const label = [formattedUk, r.admin_district || r.parish, r.region, r.country || 'UK']
            .filter(Boolean)
            .join(', ');
          return finalize(r.latitude, r.longitude, label, `UK-POST`, 14);
        }
      }
    } catch {}
  }

  // UK Outcode only (e.g. "SW1A", "E14", "M1")
  const ukOutcodeMatch = compact.match(/^([A-Z]{1,2}\d[A-Z\d]?)$/i);
  if (ukOutcodeMatch) {
    const outcode = ukOutcodeMatch[1].toUpperCase();
    try {
      const ukOutRes = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`);
      if (ukOutRes.ok) {
        const ukOutData: any = await ukOutRes.json();
        if (ukOutData?.result && typeof ukOutData.result.latitude === 'number' && typeof ukOutData.result.longitude === 'number') {
          const r = ukOutData.result;
          const district = Array.isArray(r.admin_district) ? r.admin_district[0] : '';
          const label = [outcode, district, r.country?.[0] || 'UK'].filter(Boolean).join(', ');
          return finalize(r.latitude, r.longitude, label, `UK-${outcode}`, 13);
        }
      }
    } catch {}
  }

  // 4. Canadian Postal Code (e.g. "M5V 3L9" or "M5V")
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
          const label = `${place['place name']}, ${place['state abbreviation'] || place.state} ${compact.toUpperCase()}, Canada`;
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, label, `CA-${fsa}`, 13);
          }
        }
      }
    } catch {}
  }

  // 5. General International Postal Code or City/Address via Nominatim + Open-Meteo
  const isLikelyPostalCode = /^[A-Z0-9\s-]{3,10}$/i.test(compact) && /\d/.test(compact);
  if (isLikelyPostalCode) {
    // Determine preferred country prioritization based on operational zone
    const countryOrder =
      preferredZone === 'western_europe'
        ? ['gb', 'de', 'fr', 'nl', 'es', 'it', 'us']
        : preferredZone === 'indo_pacific'
        ? ['au', 'jp', 'sg', 'tw', 'us']
        : ['us', 'ca', 'gb', 'au', 'de', 'fr', 'mx'];

    for (const cc of countryOrder.slice(0, 3)) {
      try {
        const zipRes = await fetch(`https://api.zippopotam.us/${cc}/${encodeURIComponent(compact)}`);
        if (zipRes.ok) {
          const zipData: any = await zipRes.json();
          const place = zipData?.places?.[0];
          if (place && place.latitude && place.longitude) {
            const lat = parseFloat(place.latitude);
            const lon = parseFloat(place.longitude);
            const label = `${place['place name']}, ${place['state abbreviation'] || place.state || ''} ${compact} (${zipData.country || cc.toUpperCase()})`;
            if (!isNaN(lat) && !isNaN(lon)) {
              return finalize(lat, lon, label, `POST-${compact.toUpperCase()}`, 13);
            }
          }
        }
      } catch {}
    }

    try {
      const nomPostalRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${encodeURIComponent(compact)}& addressdetails=1&limit=1`
      );
      if (nomPostalRes.ok) {
        const nomPostalData: any = await nomPostalRes.json();
        if (Array.isArray(nomPostalData) && nomPostalData.length > 0) {
          const lat = parseFloat(nomPostalData[0].lat);
          const lon = parseFloat(nomPostalData[0].lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            return finalize(lat, lon, nomPostalData[0].display_name, `POST-${compact.toUpperCase()}`, 13);
          }
        }
      }
    } catch {}
  }

  // 6. General Free-Text Geocoding (City, Street Address, Landmark, Postal + Country) via Nominatim
  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(compact)}&addressdetails=1&limit=1`
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
            nomData[0].display_name || compact,
            'GEO-LOCK',
            isLikelyPostalCode ? 13 : 11
          );
        }
      }
    }
  } catch {}

  // 7. Secondary Fallback: Open-Meteo Global Geocoding API (Zero-key, fast CORS)
  try {
    const meteoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(compact)}&count=1&language=en&format=json`
    );
    if (meteoRes.ok) {
      const meteoData: any = await meteoRes.json();
      const first = meteoData?.results?.[0];
      if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
        const label = [first.name, first.admin1, first.country, first.postcodes?.[0]]
          .filter(Boolean)
          .join(', ');
        return finalize(first.latitude, first.longitude, label, 'GEO-LOCK', isLikelyPostalCode ? 13 : 11);
      }
    }
  } catch {}

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
  // Esri World Imagery (high-resolution cloud-free satellite imagery down to street level z=17, zero key required)
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * Builds a single seamless 2:1 widescreen NASA Worldview Snapshot URL (EPSG:4326)
 * so wide viewports never suffer from 3x3 tile vertical cropping or seam distortion.
 */
export function buildSeamlessNasaWvsSnapshotUrl(
  lat: number,
  lon: number,
  zoom: number,
  dateStr: string,
  gibsLayerName: string = 'MODIS_Terra_CorrectedReflectance_TrueColor,Coastlines_15m'
): string {
  // Calculate degree span based on zoom level (2:1 aspect ratio to match 1024x512 widescreen monitor)
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
  onDispatchReconDirective?: (directive: string, coords: { lat: number; lon: number; label: string }) => void;
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
  compact = false,
  overlayMode = false,
  onCloseOverlay,
  onOpenThreatMatrixModal,
}) => {
  const [lat, setLat] = useState<number>(initialLat);
  const [lon, setLon] = useState<number>(initialLon);
  const [targetLabel, setTargetLabel] = useState<string>(initialLabel);
  const [sectorCode, setSectorCode] = useState<string>(initialSectorCode);
  const [zoom, setZoom] = useState<number>(8);
  // Default to Esri World Imagery + NASA GIBS hybrid or NASA GIBS TrueColor with proper 1:1 square tile rendering
  const [feedLayer, setFeedLayer] = useState<SatelliteFeedLayerId>('esri_world_imagery');
  const [shaderMode, setShaderMode] = useState<PhosphorShaderMode>('green_nvg');
  const [gibsDate, setGibsDate] = useState<string>(getDefaultNasaGibsDate);
  const [commandInput, setCommandInput] = useState<string>('');
  const [isFlyToLocking, setIsFlyToLocking] = useState<boolean>(false);
  const [isGeocoding, setIsGeocoding] = useState<boolean>(false);
  const [geocodeStatusMsg, setGeocodeStatusMsg] = useState<string | null>(null);
  const [tileErrors, setTileErrors] = useState<Record<string, boolean>>({});
  const [wvsSnapshotError, setWvsSnapshotError] = useState<boolean>(false);

  // Sync when parent props change (e.g. Operational Zone dropdown or Agent Tool Call lock)
  useEffect(() => {
    setIsFlyToLocking(true);
    setLat(initialLat);
    setLon(initialLon);
    if (initialLabel) setTargetLabel(initialLabel);
    if (initialSectorCode) setSectorCode(initialSectorCode);
    setWvsSnapshotError(false);
    const t = setTimeout(() => setIsFlyToLocking(false), 650);
    return () => clearTimeout(t);
  }, [initialLat, initialLon, initialLabel, initialSectorCode]);

  // Also listen directly for live agent tool call events ('pixelops:satellite-recon-lock')
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
      setTargetLabel(detail.label || `Target (${detail.lat.toFixed(3)}, ${detail.lon.toFixed(3)})`);
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

  // Automatically clamp zoom to 9 when using NASA GIBS Level9 tile layers, or allow up to 16 on Esri World Imagery
  const effectiveZoom = useMemo(() => {
    if (feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp') {
      return Math.min(9, Math.max(2, zoom));
    }
    return Math.min(16, Math.max(2, zoom));
  }, [feedLayer, zoom]);

  const centerTile = useMemo(
    () => latLonToTileXYZ(lat, lon, effectiveZoom),
    [lat, lon, effectiveZoom]
  );

  /**
   * FIX FOR HORIZONTAL BANDING / VERTICAL CROP DISTORTION:
   * Standard WMTS / XYZ tiles are strictly 256x256 squares (1:1 aspect ratio).
   * In a widescreen monitor (~16:8 / 2:1 aspect ratio), a 3x3 grid forces each row to be squished/cropped to ~100px tall
   * while 333px wide, cutting off 60% of every tile vertically and creating visible horizontal discontinuities!
   *
   * Instead, we render a 4-column x 2-row (or 5-column x 3-row) square-tile canvas positioned with exact
   * fractional pixel offsets (`centerTile.fracX`, `centerTile.fracY`) so every 256x256 tile is rendered at a true
   * 1:1 uncropped aspect ratio and joins seamlessly with its neighbors!
   */
  const TILE_SIZE_PX = 256;
  const GRID_COLS = 5; // dx from -2 to +2
  const GRID_ROWS = 3; // dy from -1 to +1

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
      key: string;
    }> = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tileX = (((centerTile.x + dx) % n) + n) % n;
        const tileY = Math.max(0, Math.min(n - 1, centerTile.y + dy));
        const activeLayerForTiles: SatelliteFeedLayerId =
          feedLayer === 'nasa_gibs_wvs_composite' ? 'nasa_gibs_modis_terra' : feedLayer;
        const url = buildSatelliteTileUrl(activeLayerForTiles, centerTile.z, tileY, tileX, gibsDate);
        const fallbackEsriUrl = buildSatelliteTileUrl('esri_world_imagery', centerTile.z, tileY, tileX, gibsDate);
        tiles.push({
          dx,
          dy,
          x: tileX,
          y: tileY,
          z: centerTile.z,
          url,
          fallbackEsriUrl,
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

  // Sub-tile pixel offset so the exact (lat, lon) coordinate sits dead-center under the crosshair
  const offsetX = Math.round((0.5 - centerTile.fracX) * TILE_SIZE_PX);
  const offsetY = Math.round((0.5 - centerTile.fracY) * TILE_SIZE_PX);

  const handleSelectPreset = (preset: TacticalTargetPreset) => {
    setIsFlyToLocking(true);
    setLat(preset.lat);
    setLon(preset.lon);
    setTargetLabel(preset.label);
    setSectorCode(preset.sectorCode);
    setZoom(preset.defaultZoom);
    setWvsSnapshotError(false);
    setTimeout(() => setIsFlyToLocking(false), 650);
  };

  const handleCommandLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawQuery = commandInput.trim();
    if (!rawQuery) return;

    setIsGeocoding(true);
    setGeocodeStatusMsg(`Resolving coordinates for "${rawQuery}"...`);

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
        // If postal code / street zoom > 9 and user is on a Level9 GIBS layer, switch to Esri high-res so tiles don't blur/404
        if (
          resolved.zoom > 9 &&
          (feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp')
        ) {
          setFeedLayer('esri_world_imagery');
        }
      }
      setWvsSnapshotError(false);
      setGeocodeStatusMsg(`Locked: ${resolved.label} (${resolved.lat.toFixed(4)}°, ${resolved.lon.toFixed(4)}°)`);
      setTimeout(() => setIsFlyToLocking(false), 650);
      setTimeout(() => setGeocodeStatusMsg(null), 5000);

      if (onDispatchReconDirective) {
        onDispatchReconDirective(rawQuery, {
          lat: resolved.lat,
          lon: resolved.lon,
          label: resolved.label,
        });
      }
    } else {
      setGeocodeStatusMsg(`Could not resolve "${rawQuery}" — try adding country or city (e.g. "90210, US")`);
      setTimeout(() => setGeocodeStatusMsg(null), 5000);
      if (onDispatchReconDirective) {
        onDispatchReconDirective(rawQuery, { lat, lon, label: targetLabel });
      }
    }
  };

  const panByDegrees = (dLat: number, dLon: number) => {
    const scale = Math.max(0.03, 6 / Math.pow(2, effectiveZoom - 3));
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
    <div
      className={`w-full ${
        overlayMode ? 'h-full flex flex-col rounded-none border-0' : 'rounded-lg border-2 border-emerald-500/60 shadow-[0_0_35px_rgba(16,185,129,0.2)]'
      } bg-[#070b11] overflow-hidden font-mono text-slate-100`}
    >
      {/* Top Recon Monitor Control Header */}
      <div className="px-3 py-1.5 sm:px-3.5 sm:py-2 bg-gradient-to-r from-[#06120e] via-[#0b1f17] to-[#06120e] border-b border-emerald-500/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
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
              setWvsSnapshotError(false);
              if ((nextLayer === 'nasa_gibs_modis_terra' || nextLayer === 'nasa_gibs_viirs_snpp') && zoom > 9) {
                setZoom(7);
              }
            }}
            className="px-2 py-1 text-[11px] bg-[#040a07] border border-emerald-500/50 rounded text-emerald-200 focus:outline-none"
            title="Select Zero-Key Satellite Imagery Source"
          >
            <option value="esri_world_imagery">Esri World Imagery (Cloud-Free High-Res Optical)</option>
            <option value="nasa_gibs_wvs_composite">NASA GIBS Worldview Widescreen Composite (MODIS Daily)</option>
            <option value="nasa_gibs_modis_terra">NASA GIBS WMTS: MODIS Terra TrueColor (Daily Weather/Plumes)</option>
            <option value="nasa_gibs_viirs_snpp">NASA GIBS WMTS: Suomi NPP VIIRS TrueColor (Daily Orbital)</option>
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
                onChange={(e) => {
                  setGibsDate(e.target.value || getDefaultNasaGibsDate());
                  setWvsSnapshotError(false);
                }}
                className="bg-transparent text-[10px] text-emerald-200 focus:outline-none"
                title="NASA GIBS Orbital Pass Date"
              />
            </div>
          )}

          {onOpenThreatMatrixModal && (
            <button
              type="button"
              onClick={onOpenThreatMatrixModal}
              className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-400/60 cursor-pointer whitespace-nowrap"
              title="Open Threat Matrix (4-Pillar Threat Correlation, Grid Stability, CISA KEV & Supply Chain)"
            >
              [🛡️ Threat Matrix]
            </button>
          )}

          {onCloseOverlay && (
            <button
              type="button"
              onClick={onCloseOverlay}
              className="px-2.5 py-1 text-[10px] font-bold rounded bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-400/60 cursor-pointer whitespace-nowrap"
              title="Close Recon Monitor Overlay and return to Room View"
            >
              [✕ CLOSE RECON]
            </button>
          )}
        </div>
      </div>

      {/* Quick Sector Coordinate Lock Bar + Agent Coordinate Binding Input */}
      <div className="px-3 py-1.5 sm:px-3.5 bg-[#0a1118] border-b border-slate-800 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 shrink-0">
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
            placeholder="ZIP / Postcode (e.g. 90210, SW1A 1AA), City, or Lat, Lon"
            className="w-full sm:w-72 px-2.5 py-1 text-[11px] bg-slate-950 border border-emerald-500/40 rounded text-emerald-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400"
          />
          <button
            type="submit"
            disabled={isGeocoding}
            className="px-2.5 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/60 text-emerald-200 text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
            title="Geocode postal code, city, or coordinates and lock orbital feed"
          >
            <Crosshair className={`w-3 h-3 ${isGeocoding ? 'animate-spin' : ''}`} />
            <span>{isGeocoding ? 'Locating...' : 'Lock / Recon'}</span>
          </button>
        </form>
      </div>

      {geocodeStatusMsg && (
        <div className="px-3.5 py-1 bg-emerald-950/70 border-b border-emerald-500/40 text-[10px] text-emerald-200 flex items-center justify-between">
          <span>🎯 {geocodeStatusMsg}</span>
          <button
            type="button"
            onClick={() => setGeocodeStatusMsg(null)}
            className="text-emerald-400 hover:text-white px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main 2D Tactical Raster Viewport + Night-Vision CRT Shader + Radar Overlay */}
      <div
        className={`relative w-full ${
          overlayMode
            ? 'flex-1 min-h-0'
            : compact
            ? 'h-72 sm:h-80'
            : 'h-80 sm:h-[430px]'
        } bg-[#020804] select-none overflow-hidden`}
      >
        {/* Filtered Tile Raster Container (.tactical-satellite-monitor) */}
        <div className={`tactical-satellite-monitor ${shaderClass} w-full h-full relative flex items-center justify-center`}>
          {feedLayer === 'nasa_gibs_wvs_composite' && !wvsSnapshotError ? (
            <img
              src={wvsCompositeUrl}
              alt={`NASA GIBS Composite ${targetLabel}`}
              crossOrigin="anonymous"
              onError={() => setWvsSnapshotError(true)}
              className="w-full h-full object-cover block"
            />
          ) : (
            /* True 1:1 Uncropped 256x256 Slippy Tile Canvas centered on exact (lat, lon) */
            <div
              className="relative shrink-0"
              style={{
                width: `${GRID_COLS * TILE_SIZE_PX}px`,
                height: `${GRID_ROWS * TILE_SIZE_PX}px`,
                transform: `translate(${offsetX}px, ${offsetY}px)`,
                transition: isFlyToLocking ? 'transform 0.35s ease-out' : 'transform 0.15s ease-out',
              }}
            >
              {seamlessTileCanvas.map((tile) => {
                const useFallback = tileErrors[tile.key];
                const leftPx = (tile.dx + 2) * TILE_SIZE_PX;
                const topPx = (tile.dy + 1) * TILE_SIZE_PX;
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
                      alt={`Tile Z${tile.z} Y${tile.y} X${tile.x}`}
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tactical HUD Overlays (Rendered above the CSS filter so HUD text & vector boxes stay razor-sharp) */}
        <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3">
          {/* Top-Left & Top-Right HUD Telemetry Callouts */}
          <div className="flex items-start justify-between gap-2">
            <div className="bg-black/80 border border-emerald-500/60 px-2.5 py-1.5 rounded text-[10px] text-emerald-300 space-y-0.5 shadow-[0_0_15px_rgba(0,0,0,0.85)]">
              <div className="font-bold text-emerald-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>
                  ORBITAL FEED:{' '}
                  {feedLayer === 'esri_world_imagery'
                    ? 'ESRI WORLD IMAGERY (CLOUD-FREE HI-RES)'
                    : feedLayer === 'nasa_gibs_wvs_composite'
                    ? 'NASA WORLDVIEW WIDESCREEN COMPOSITE'
                    : 'NASA GIBS WMTS (MODIS / VIIRS DAILY)'}
                </span>
              </div>
              <div>
                LAT: <strong className="text-white">{lat.toFixed(4)}°</strong> | LON:{' '}
                <strong className="text-white">{lon.toFixed(4)}°</strong> | ZOOM:{' '}
                <strong className="text-white">L{effectiveZoom}</strong>
              </div>
              <div className="text-emerald-400/90">
                WMTS TILE: X={centerTile.x}, Y={centerTile.y}, Z={centerTile.z} (1:1 Uncropped Projection)
              </div>
            </div>

            <div className="bg-black/80 border border-amber-500/60 px-2.5 py-1.5 rounded text-[10px] text-amber-300 text-right shadow-[0_0_15px_rgba(0,0,0,0.85)]">
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
                    'conic-gradient(from 0deg, rgba(16, 185, 129, 0.26) 0deg, rgba(16, 185, 129, 0.0) 65deg, transparent 360deg)',
                }}
              />
              {/* Target Lock Bounding Box */}
              <div
                className={`relative w-16 h-16 border-2 ${
                  isFlyToLocking ? 'border-amber-400 scale-125' : 'border-emerald-400 scale-100'
                } transition-all duration-300 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.5)]`}
              >
                <div className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
                <span className="absolute -top-4 left-0 text-[8px] font-bold bg-black/85 text-emerald-300 px-1 border border-emerald-500/40 whitespace-nowrap">
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
                  if (
                    (feedLayer === 'nasa_gibs_modis_terra' || feedLayer === 'nasa_gibs_viirs_snpp') &&
                    effectiveZoom >= 9
                  ) {
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
