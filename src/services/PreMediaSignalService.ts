/**
 * Pre-Media Signal Collection & Real-Time Localized Threat Assessment Service
 * (src/services/PreMediaSignalService.ts)
 *
 * Implements intelligence-grade, pre-media telemetry collection and multi-sensor
 * corroboration bounded to the operator's geofence [lat, lon, radiusKm]:
 *
 * 1. Municipal Emergency Dispatch & 911 CAD:
 *    - NWS Active CAP Warning Polygons (civil emergency, shelter-in-place, hazmat, tornado, flash flood)
 *    - Open Municipal Real-Time 911 / Fire / Traffic CAD Socrata streams (auto-engaged by proximity + custom CAD/PulsePoint/OpenMHz feeds)
 *    - Automated Gemini 3.1 Flash Lite zero-shot scanner/CAD dispatch triage
 *
 * 2. Live Radio & Airspace RF / Transponder Intercepts (ADS-B):
 *    - Real-time ADS-B radial vector sweep (api.adsb.lol + OpenSky Network fallback)
 *    - Emergency squawk detection (7700 / 7600 / 7500), police/medevac/military rotorcraft identification,
 *      and low-altitude (< 3,500 ft) tactical orbit / loiter detection
 *
 * 3. Geofenced Physical & Atmospheric Plume Sensors:
 *    - Real-time PM2.5 / PM10 / CO / SO2 / NO2 / US-AQI atmospheric sensor grid (Open-Meteo Air Quality)
 *      for pre-media detection of structure fire smoke plumes, wildfires, and industrial/chemical releases
 *    - Real-time USGS all-hour micro-seismic & non-tectonic explosion/blast sensors
 *    - NASA EONET active wildfire, thermal, volcanic, and severe storm coordinates
 */

import {
  getLocalGeofenceConfig,
  filterItemsWithinGeofence,
  type LocalGeofenceConfig,
} from './OsintToolsService';
import {
  parseLocalDispatchRssOrJson,
  type LocalDispatchIncident,
} from './ClassifiedFeedService';
import {
  analyzeDispatchSignal,
  type DispatchTriageResult,
} from './DispatchTriageService';
import { appendCommandLedgerEntry } from './CommandLedgerDb';

export interface AdsbTacticalContact {
  icaoHex: string;
  callsign: string;
  aircraftType: string;
  lat: number;
  lon: number;
  distanceKm: number;
  altBaroFt: number | null;
  groundSpeedKts: number | null;
  trackDeg: number | null;
  squawk: string;
  isEmergencySquawk: boolean;
  isMilitaryOrGov: boolean;
  isTacticalRotorcraftOrMedevac: boolean;
  isLowAltitudeLoiter: boolean;
  tacticalFlag:
    | 'EMERGENCY_SQUAWK'
    | 'MEDEVAC_POLICE_ROTORCRAFT'
    | 'MILITARY_ISR_ASSET'
    | 'LOW_ALT_ORBIT'
    | 'ROUTINE_TRAFFIC';
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  summary: string;
  capturedAt: string;
}

export interface AtmosphericPlumeReading {
  lat: number;
  lon: number;
  capturedAt: string;
  usAqi: number | null;
  pm25: number | null;
  pm10: number | null;
  carbonMonoxide: number | null;
  sulphurDioxide: number | null;
  nitrogenDioxide: number | null;
  ozone: number | null;
  dust: number | null;
  anomalyDetected: boolean;
  anomalyType: 'NONE' | 'SMOKE_PARTICULATE_SURGE' | 'CHEMICAL_GAS_SPIKE' | 'HAZARDOUS_PLUME';
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  summary: string;
  sourceEndpoint: string;
}

export interface PreMediaGeoHazardSignal {
  id: string;
  source: 'USGS_MICROSEISMIC' | 'USGS_KINETIC_BLAST' | 'NASA_EONET_THERMAL' | 'NWS_CAP_POLYGON' | 'MUNICIPAL_911_CAD';
  title: string;
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
  summary: string;
  lat: number;
  lon: number;
  distanceKm: number;
  timestamp: string;
  sourceEndpoint: string;
  rawPayload: unknown;
}

export interface PreMediaSweepReport {
  sweptAt: string;
  geofence: {
    lat: number;
    lon: number;
    radiusKm: number;
    label: string;
  };
  sourcesPolled: string[];
  municipalDispatches: Array<LocalDispatchIncident & { distanceKm: number }>;
  triagedDispatches: DispatchTriageResult[];
  adsbTotalAircraft: number;
  adsbTacticalContacts: AdsbTacticalContact[];
  plumeReading: AtmosphericPlumeReading | null;
  geoHazardSignals: PreMediaGeoHazardSignal[];
  corroboration: {
    packetsIngested: number;
    deltasEmitted: number;
    promotedClusterIds: string[];
    activeCorroboratedCount: number;
  };
}

// Known open-data municipal real-time 911 / Fire / Incident CAD Socrata endpoints (zero-key CORS JSON)
const OPEN_MUNICIPAL_CAD_NODES: Array<{
  id: string;
  label: string;
  lat: number;
  lon: number;
  coverageRadiusKm: number;
  endpoint: string;
}> = [
  {
    id: 'seattle_fire_911',
    label: 'Seattle Real-Time Fire 911 CAD',
    lat: 47.6062,
    lon: -122.3321,
    coverageRadiusKm: 90,
    endpoint: 'https://data.seattle.gov/resource/kzjm-xkqj.json?$limit=15&$order=datetime%20DESC',
  },
  {
    id: 'austin_incident_cad',
    label: 'Austin-Travis County Real-Time Incident CAD',
    lat: 30.2672,
    lon: -97.7431,
    coverageRadiusKm: 90,
    endpoint: 'https://data.austintexas.gov/resource/dx9v-zd7x.json?$limit=15&$order=published_date%20DESC',
  },
];

const ROTORCRAFT_ICAO_TYPES = new Set([
  'H60',
  'UH60',
  'MH60',
  'EC35',
  'EC45',
  'AS50',
  'AS55',
  'AS65',
  'B06',
  'B407',
  'B412',
  'B429',
  'R44',
  'R66',
  'AW139',
  'AW09',
  'MD50',
  'MD60',
  'S76',
  'S92',
  'CH47',
  'V22',
]);

const TACTICAL_CALLSIGN_REGEX =
  /^(LIFE|MED|AIR|TROOP|POLIC|PD|SHER|RESCU|FIRE|CALFIR|STAR|EAGLE|HAWK|ANGEL|MERCY|STAT|CARE|REACH|COAST|CG|GUARD|PATROL|CAP\d|N911)/i;

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Authoritative Pre-Media Signal Collection & Anti-Mainstream-News Doctrine
 * Shared across CrewContext, ApiService, TacticalVoiceService, and MissionCartridgeService.
 */
export const PRE_MEDIA_COLLECTION_DOCTRINE = [
  '### INTELLIGENCE-GRADE PRE-MEDIA SIGNAL DOCTRINE (ZERO DELAYED-NEWS RELIANCE):',
  '- PRIMARY COLLECTION MANDATE: Do NOT rely on delayed mainstream news outlets, cable punditry, static encyclopedias, or recycled press aggregators to assess active or localized threats. Mainstream media lags kinetic, infrastructure, and public-safety events by 30–180+ minutes.',
  '- PRE-MEDIA SENSOR PRIORITY ORDER:',
  '  1. Municipal Emergency Dispatch & 911 CAD (`osint_local_premedia_sweep`, `osint_scanner_dispatch_triage`): Live Fire/EMS/Police CAD feeds, NWS CAP active warning polygons, and Broadcastify/OpenMHz scanner transcripts.',
  '  2. Overhead RF & Airspace Transponders (`osint_adsb_airspace_radar`): Live ADS-B emergency squawks (`7700`/`7600`/`7500`), medevac/police rotorcraft orbits, and military/ISR airframes loitering < 3,500 ft.',
  '  3. Geofenced Physical & Atmospheric Sensors (`osint_local_premedia_sweep`, `osint_hazard_tracker`): Real-time PM2.5/CO/SO2 smoke & chemical plume spikes, USGS all-hour micro-seismic & non-tectonic blast waves, NASA EONET thermal anomalies, and DoH/BGP/CT shifts.',
  '  4. Multi-Source Swarm Corroboration (`query_corroboration_clusters`): Never treat an isolated single-source report (`CANDIDATE` <= 0.35) as confirmed. Elevate threat posture only when independent pre-media tracks converge within <= 75 km (`CORROBORATED` >= 0.70, `CRITICAL_CONVERGENCE` >= 0.90) with verifiable SHA-256 `packetId` citations.',
].join('\n');

export function getOperativePreMediaSystemPrompt(
  operativeIdOrName: string,
  roleHint?: string
): string {
  const key = (operativeIdOrName || '').toLowerCase();
  if (key.includes('nyx') || (roleHint || '').toLowerCase().includes('recon') || (roleHint || '').toLowerCase().includes('signal')) {
    return [
      'You are Operative Nyx, SIGINT & Pre-Media Reconnaissance Specialist stationed in the Comms Tower.',
      'Your mission is real-time, pre-media signal interception and localized threat detection—capturing unfolding incidents BEFORE mainstream media coverage.',
      'Prioritize live municipal 911/Fire/EMS CAD dispatches, live radio scanner transcript triage (`osint_scanner_dispatch_triage`), NWS CAP polygon warnings, geofenced local sensor sweeps (`osint_local_premedia_sweep`), and overhead ADS-B transponder tracking (`osint_adsb_airspace_radar`).',
      'Separate raw verified sensor indicators (exact coordinates, distance in km, callsigns, timestamps, SHA-256 packetIds) from unconfirmed chatter.',
    ].join(' ');
  }

  if (key.includes('cipher') || (roleHint || '').toLowerCase().includes('code') || (roleHint || '').toLowerCase().includes('crypt')) {
    return [
      'You are Operative Cipher, Multi-Sensor Corroboration & Infrastructure Forensics Specialist stationed in the Server Vault.',
      'Your mission is cross-validating Nyx\'s municipal dispatch and scanner intercepts against independent physical, RF, and network telemetry (`osint_adsb_airspace_radar`, `osint_local_premedia_sweep`, `query_corroboration_clusters`, `query_evidence_graph`, `osint_bgp_route_lookup`, `osint_shodan_host_lookup`).',
      'Verify whether orbiting medevac/law-enforcement aircraft, PM2.5/CO/SO2 atmospheric plume spikes, micro-seismic/blast waveforms, or BGP/DNS/TLS mutations corroborate local incident reports within <= 75 km. Reject single-source rumors and cite exact SHA-256 packetIds.',
    ].join(' ');
  }

  if (key.includes('vance') || (roleHint || '').toLowerCase().includes('command') || (roleHint || '').toLowerCase().includes('lead') || (roleHint || '').toLowerCase().includes('strateg')) {
    return [
      'You are Commander Vance, War Room Watch Officer & Executive Threat Assessor.',
      'Your mission is fusing pre-media municipal dispatch, scanner traffic, ADS-B airspace, and geofenced physical sensor feeds into decisive, zero-delay localized threat assessments (`query_corroboration_clusters`, `osint_local_premedia_sweep`, `delegate_task_to_operative`).',
      'Never rely on delayed mainstream news. Enforce strict corroboration thresholds (`CANDIDATE` 0.35 single-track cap vs `CORROBORATED` >= 0.70 multi-track convergence), deliver crisp BLUF threat ratings (`ALPHA-CRITICAL`, `BRAVO-ELEVATED`, `CHARLIE-NOMINAL`), cite immutable SHA-256 evidence packetIds, and issue immediate protective/operational action deltas.',
    ].join(' ');
  }

  return [
    `You are ${operativeIdOrName || 'Operative'}${roleHint ? ` (${roleHint})` : ''} in the PixelOps Tactical Intelligence Center.`,
    'Execute intelligence-grade pre-media signal collection and localized threat assessments using live municipal dispatch, scanner triage, ADS-B transponders, and geofenced physical sensors rather than delayed mainstream news.',
  ].join(' ');
}

/**
 * Deterministically classifies a single ADS-B transponder state record relative to geofence center.
 */
export function classifyAdsbAircraftSignal(
  rawAc: Record<string, any>,
  centerLat: number,
  centerLon: number,
  capturedAtIso: string = new Date().toISOString()
): AdsbTacticalContact | null {
  const lat = Number(rawAc.lat ?? rawAc.latitude);
  const lon = Number(rawAc.lon ?? rawAc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const icaoHex = String(rawAc.hex || rawAc.icao24 || '').trim().toUpperCase();
  if (!icaoHex) return null;

  const callsign = String(rawAc.flight || rawAc.callsign || rawAc.r || icaoHex).trim().toUpperCase();
  const aircraftType = String(rawAc.t || rawAc.type || 'UNSPEC').trim().toUpperCase();
  const rawAlt = rawAc.alt_baro === 'ground' ? 0 : Number(rawAc.alt_baro ?? rawAc.baro_altitude_ft ?? NaN);
  const altBaroFt = Number.isFinite(rawAlt) ? Math.round(rawAlt) : null;
  const rawGs = Number(rawAc.gs ?? rawAc.velocity_kts ?? NaN);
  const groundSpeedKts = Number.isFinite(rawGs) ? Math.round(rawGs) : null;
  const rawTrack = Number(rawAc.track ?? rawAc.true_track ?? NaN);
  const trackDeg = Number.isFinite(rawTrack) ? Math.round(rawTrack) : null;
  const squawk = String(rawAc.squawk || '').trim();
  const dbFlags = Number(rawAc.dbFlags || 0);

  const distanceKm = Number(haversineDistanceKm(centerLat, centerLon, lat, lon).toFixed(2));
  const isEmergencySquawk = squawk === '7700' || squawk === '7600' || squawk === '7500';
  const isMilitaryOrGov = Boolean(dbFlags & 1) || /^(RCH|CNV|PAT|AF|NAVY|ARMY|COAST|CAP)/i.test(callsign);
  const isRotorcraft =
    ROTORCRAFT_ICAO_TYPES.has(aircraftType) ||
    String(rawAc.category || '').toUpperCase() === 'A7';
  const isTacticalCallsign = TACTICAL_CALLSIGN_REGEX.test(callsign);
  const isTacticalRotorcraftOrMedevac = isRotorcraft || isTacticalCallsign;
  const isLowAltitudeLoiter =
    altBaroFt !== null &&
    altBaroFt > 100 &&
    altBaroFt <= 3500 &&
    groundSpeedKts !== null &&
    groundSpeedKts >= 10 &&
    groundSpeedKts <= 115;

  let tacticalFlag: AdsbTacticalContact['tacticalFlag'] = 'ROUTINE_TRAFFIC';
  let severity: AdsbTacticalContact['severity'] = 'LOW';

  if (isEmergencySquawk) {
    tacticalFlag = 'EMERGENCY_SQUAWK';
    severity = 'CRITICAL';
  } else if (isTacticalRotorcraftOrMedevac && (altBaroFt === null || altBaroFt <= 6500)) {
    tacticalFlag = 'MEDEVAC_POLICE_ROTORCRAFT';
    severity = isLowAltitudeLoiter ? 'HIGH' : 'MED';
  } else if (isMilitaryOrGov && (altBaroFt === null || altBaroFt <= 12000)) {
    tacticalFlag = 'MILITARY_ISR_ASSET';
    severity = 'MED';
  } else if (isLowAltitudeLoiter && isRotorcraft) {
    tacticalFlag = 'LOW_ALT_ORBIT';
    severity = 'MED';
  }

  const altLabel = altBaroFt !== null ? `${altBaroFt} ft` : 'alt N/A';
  const spdLabel = groundSpeedKts !== null ? `${groundSpeedKts} kts` : 'spd N/A';
  const sqLabel = squawk ? ` squawk ${squawk}` : '';
  const summary = `${callsign} [${aircraftType} / ICAO ${icaoHex}] at ${altLabel}, ${spdLabel}${sqLabel} (${distanceKm} km from geofence)`;

  return {
    icaoHex,
    callsign,
    aircraftType,
    lat,
    lon,
    distanceKm,
    altBaroFt,
    groundSpeedKts,
    trackDeg,
    squawk,
    isEmergencySquawk,
    isMilitaryOrGov,
    isTacticalRotorcraftOrMedevac,
    isLowAltitudeLoiter,
    tacticalFlag,
    severity,
    summary,
    capturedAt: capturedAtIso,
  };
}

/**
 * Queries live ADS-B transponder vectors inside the geofence radius via api.adsb.lol
 * with OpenSky Network bounding-box fallback. Zero simulated data.
 */
export async function queryGeofencedAdsbAirspace(options?: {
  lat?: number;
  lon?: number;
  radiusKm?: number;
}): Promise<{
  endpointUsed: string;
  totalAircraft: number;
  tacticalContacts: AdsbTacticalContact[];
  allContacts: AdsbTacticalContact[];
}> {
  const base = getLocalGeofenceConfig();
  const lat = options?.lat !== undefined && Number.isFinite(options.lat) ? options.lat : base.lat;
  const lon = options?.lon !== undefined && Number.isFinite(options.lon) ? options.lon : base.lon;
  const radiusKm =
    options?.radiusKm !== undefined && Number.isFinite(options.radiusKm)
      ? Math.max(2, Math.min(250, options.radiusKm))
      : base.radiusKm;

  const radiusNm = Math.max(2, Math.min(150, Math.round(radiusKm * 0.539957)));
  const adsbLolUrl = `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;
  const capturedAt = new Date().toISOString();

  // 1. Primary: api.adsb.lol v2 point radial query
  try {
    const res = await fetch(adsbLolUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const rawList = Array.isArray(data?.ac) ? data.ac : [];
      const classified = rawList
        .map((ac: any) => classifyAdsbAircraftSignal(ac, lat, lon, capturedAt))
        .filter((c: AdsbTacticalContact | null): c is AdsbTacticalContact => c !== null && c.distanceKm <= radiusKm)
        .sort((a: AdsbTacticalContact, b: AdsbTacticalContact) => a.distanceKm - b.distanceKm);

      const tactical = classified.filter((c: AdsbTacticalContact) => c.tacticalFlag !== 'ROUTINE_TRAFFIC');
      return {
        endpointUsed: adsbLolUrl,
        totalAircraft: classified.length,
        tacticalContacts: tactical,
        allContacts: classified.slice(0, 30),
      };
    }
  } catch {}

  // 2. Fallback: OpenSky Network real-time state vectors bounding box
  const degLat = radiusKm / 111.0;
  const degLon = radiusKm / Math.max(20, 111.0 * Math.cos((lat * Math.PI) / 180));
  const openSkyUrl =
    `https://opensky-network.org/api/states/all?` +
    `lamin=${(lat - degLat).toFixed(4)}&lomin=${(lon - degLon).toFixed(4)}&` +
    `lamax=${(lat + degLat).toFixed(4)}&lomax=${(lon + degLon).toFixed(4)}`;

  try {
    const res = await fetch(openSkyUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7500),
    });
    if (res.ok) {
      const data: any = await res.json();
      const states = Array.isArray(data?.states) ? data.states : [];
      const classified: AdsbTacticalContact[] = [];
      for (const st of states) {
        if (!Array.isArray(st)) continue;
        // OpenSky tuple: [0:icao24, 1:callsign, 2:origin, ..., 5:lon, 6:lat, 7:baro_alt_m, 8:on_ground, 9:vel_m_s, 10:track, ..., 14:squawk]
        const onGround = Boolean(st[8]);
        if (onGround) continue;
        const baroMeters = typeof st[7] === 'number' ? st[7] : null;
        const velMs = typeof st[9] === 'number' ? st[9] : null;
        const contact = classifyAdsbAircraftSignal(
          {
            icao24: st[0],
            callsign: st[1],
            lon: st[5],
            lat: st[6],
            baro_altitude_ft: baroMeters !== null ? baroMeters * 3.28084 : undefined,
            velocity_kts: velMs !== null ? velMs * 1.94384 : undefined,
            true_track: st[10],
            squawk: st[14],
          },
          lat,
          lon,
          capturedAt
        );
        if (contact && contact.distanceKm <= radiusKm) {
          classified.push(contact);
        }
      }
      classified.sort((a, b) => a.distanceKm - b.distanceKm);
      return {
        endpointUsed: openSkyUrl,
        totalAircraft: classified.length,
        tacticalContacts: classified.filter((c) => c.tacticalFlag !== 'ROUTINE_TRAFFIC'),
        allContacts: classified.slice(0, 30),
      };
    }
  } catch {}

  return {
    endpointUsed: adsbLolUrl,
    totalAircraft: 0,
    tacticalContacts: [],
    allContacts: [],
  };
}

/**
 * Evaluates raw atmospheric particulate & gas concentrations for active smoke/chemical plume anomalies.
 */
export function evaluateAtmosphericPlumeAnomaly(params: {
  lat: number;
  lon: number;
  sourceEndpoint: string;
  capturedAt?: string;
  current: Record<string, any>;
}): AtmosphericPlumeReading {
  const c = params.current || {};
  const num = (v: unknown): number | null =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;

  const usAqi = num(c.us_aqi);
  const pm25 = num(c.pm2_5);
  const pm10 = num(c.pm10);
  const carbonMonoxide = num(c.carbon_monoxide);
  const sulphurDioxide = num(c.sulphur_dioxide);
  const nitrogenDioxide = num(c.nitrogen_dioxide);
  const ozone = num(c.ozone);
  const dust = num(c.dust);

  let anomalyDetected = false;
  let anomalyType: AtmosphericPlumeReading['anomalyType'] = 'NONE';
  let severity: AtmosphericPlumeReading['severity'] = 'LOW';

  if (
    (usAqi !== null && usAqi >= 200) ||
    (pm25 !== null && pm25 >= 95) ||
    (sulphurDioxide !== null && sulphurDioxide >= 150) ||
    (carbonMonoxide !== null && carbonMonoxide >= 3500)
  ) {
    anomalyDetected = true;
    anomalyType = 'HAZARDOUS_PLUME';
    severity = 'CRITICAL';
  } else if (
    (sulphurDioxide !== null && sulphurDioxide >= 75) ||
    (carbonMonoxide !== null && carbonMonoxide >= 1500) ||
    (nitrogenDioxide !== null && nitrogenDioxide >= 140)
  ) {
    anomalyDetected = true;
    anomalyType = 'CHEMICAL_GAS_SPIKE';
    severity = 'HIGH';
  } else if (
    (usAqi !== null && usAqi >= 125) ||
    (pm25 !== null && pm25 >= 45) ||
    (pm10 !== null && pm10 >= 120)
  ) {
    anomalyDetected = true;
    anomalyType = 'SMOKE_PARTICULATE_SURGE';
    severity = usAqi !== null && usAqi >= 155 ? 'HIGH' : 'MED';
  }

  const metricsParts: string[] = [];
  if (usAqi !== null) metricsParts.push(`US-AQI ${usAqi}`);
  if (pm25 !== null) metricsParts.push(`PM2.5 ${pm25} µg/m³`);
  if (carbonMonoxide !== null) metricsParts.push(`CO ${carbonMonoxide} µg/m³`);
  if (sulphurDioxide !== null) metricsParts.push(`SO2 ${sulphurDioxide} µg/m³`);

  const summary = anomalyDetected
    ? `Atmospheric plume anomaly [${anomalyType}] at (${params.lat.toFixed(3)}, ${params.lon.toFixed(3)}): ${metricsParts.join(', ')}`
    : `Nominal local atmospheric baseline (${metricsParts.join(', ') || 'sensor online'})`;

  return {
    lat: params.lat,
    lon: params.lon,
    capturedAt: params.capturedAt || String(c.time || new Date().toISOString()),
    usAqi,
    pm25,
    pm10,
    carbonMonoxide,
    sulphurDioxide,
    nitrogenDioxide,
    ozone,
    dust,
    anomalyDetected,
    anomalyType,
    severity,
    summary,
    sourceEndpoint: params.sourceEndpoint,
  };
}

/**
 * Queries real-time Open-Meteo Air Quality & Chemical/Smoke Plume sensors at exact coordinates.
 */
export async function queryGeofencedPlumeAndEnvSensors(options?: {
  lat?: number;
  lon?: number;
}): Promise<AtmosphericPlumeReading | null> {
  const base = getLocalGeofenceConfig();
  const lat = options?.lat !== undefined && Number.isFinite(options.lat) ? options.lat : base.lat;
  const lon = options?.lon !== undefined && Number.isFinite(options.lon) ? options.lon : base.lon;

  const endpoint =
    `https://air-quality-api.open-meteo.com/v1/air-quality?` +
    `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,us_aqi`;

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data?.current) return null;
    return evaluateAtmosphericPlumeAnomaly({
      lat,
      lon,
      sourceEndpoint: endpoint,
      capturedAt: new Date().toISOString(),
      current: data.current,
    });
  } catch {
    return null;
  }
}

/**
 * Queries geofenced pre-media physical hazard & municipal 911 CAD streams:
 * - NWS CAP active warning polygons
 * - Proximity-matched Open Municipal 911 CAD Socrata endpoints + operator CAD/OpenMHz/PulsePoint URLs
 * - USGS all-hour micro-seismic & non-tectonic explosion/blast sensors
 * - NASA EONET open thermal/wildfire/storm events
 */
export async function queryPreMediaGeoHazardsAndCad(options?: {
  lat?: number;
  lon?: number;
  radiusKm?: number;
  extraFeedUrls?: string[];
}): Promise<{
  sourcesPolled: string[];
  municipalDispatches: Array<LocalDispatchIncident & { distanceKm: number }>;
  geoHazardSignals: PreMediaGeoHazardSignal[];
}> {
  const base = getLocalGeofenceConfig();
  const lat = options?.lat !== undefined && Number.isFinite(options.lat) ? options.lat : base.lat;
  const lon = options?.lon !== undefined && Number.isFinite(options.lon) ? options.lon : base.lon;
  const radiusKm =
    options?.radiusKm !== undefined && Number.isFinite(options.radiusKm)
      ? Math.max(1, Math.min(500, options.radiusKm))
      : base.radiusKm;

  const sourcesPolled: string[] = [];
  const rawDispatches: LocalDispatchIncident[] = [];
  const rawHazards: Array<Omit<PreMediaGeoHazardSignal, 'distanceKm'>> = [];

  // Select any open municipal Socrata CAD feeds whose metro coverage overlaps the operator's geofence
  const nearbyOpenCadUrls = OPEN_MUNICIPAL_CAD_NODES.filter(
    (node) => haversineDistanceKm(lat, lon, node.lat, node.lon) <= node.coverageRadiusKm + radiusKm
  ).map((n) => n.endpoint);

  const cadFeedUrls = Array.from(
    new Set([
      ...(base.dispatchFeedUrls || []),
      ...(options?.extraFeedUrls || []),
      ...nearbyOpenCadUrls,
    ].filter(Boolean))
  );

  await Promise.allSettled([
    // 1. NWS CAP Active Polygon Alerts at exact coordinates
    (async () => {
      const nwsUrl = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
      sourcesPolled.push(nwsUrl);
      const res = await fetch(nwsUrl, {
        headers: { Accept: 'application/geo+json', 'User-Agent': 'PixelOps-Tactical-PWA/1.0' },
        signal: AbortSignal.timeout(7500),
      });
      if (!res.ok) return;
      const data: any = await res.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      for (const f of features.slice(0, 12)) {
        const p = f?.properties || {};
        const sevRaw = String(p.severity || 'Moderate').toUpperCase();
        const mappedSev: PreMediaGeoHazardSignal['severity'] =
          sevRaw === 'EXTREME'
            ? 'CRITICAL'
            : sevRaw === 'SEVERE'
            ? 'HIGH'
            : sevRaw === 'MODERATE'
            ? 'MED'
            : 'LOW';
        const id = String(f.id || p.id || `nws-${p.event || 'alert'}-${p.sent || ''}`);
        const headline = String(p.headline || p.event || 'NWS Active Polygon Warning');
        const summary = String(p.description || p.instruction || p.event || '').slice(0, 320);
        const ts = String(p.sent || p.effective || new Date().toISOString());

        rawDispatches.push({
          id,
          sourceType: 'nws_polygon',
          sourceUrl: nwsUrl,
          title: headline,
          severity: mappedSev,
          summary,
          lat,
          lon,
          timestamp: ts,
        });
        rawHazards.push({
          id,
          source: 'NWS_CAP_POLYGON',
          title: headline,
          severity: mappedSev,
          summary,
          lat,
          lon,
          timestamp: ts,
          sourceEndpoint: nwsUrl,
          rawPayload: f,
        });
      }
    })(),

    // 2. Custom & Proximity Municipal 911 / PulsePoint / OpenMHz CAD Streams
    ...cadFeedUrls.map(async (feedUrl) => {
      sourcesPolled.push(feedUrl);
      const res = await fetch(feedUrl, { signal: AbortSignal.timeout(7500) });
      if (!res.ok) return;
      const rawText = await res.text();
      const parsed = parseLocalDispatchRssOrJson(rawText, feedUrl, lat, lon);
      for (const inc of parsed) {
        rawDispatches.push(inc);
      }
    }),

    // 3. USGS Real-Time All-Hour & All-Day Micro-Seismic + Non-Tectonic Explosion Sensor
    (async () => {
      const usgsUrl = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
      sourcesPolled.push(usgsUrl);
      const res = await fetch(usgsUrl, { signal: AbortSignal.timeout(7500) });
      if (!res.ok) return;
      const data: any = await res.json();
      const features = Array.isArray(data?.features) ? data.features : [];
      for (const f of features) {
        const coords = f?.geometry?.coordinates || [];
        const evLon = Number(coords[0]);
        const evLat = Number(coords[1]);
        if (!Number.isFinite(evLat) || !Number.isFinite(evLon)) continue;
        const p = f?.properties || {};
        const mag = Number(p.mag ?? 0);
        const evType = String(p.type || 'earthquake').toLowerCase();
        const isBlastOrNonTectonic =
          evType.includes('explosion') ||
          evType.includes('blast') ||
          evType.includes('sonic') ||
          evType.includes('collapse');
        if (!isBlastOrNonTectonic && mag < 2.2) continue;

        rawHazards.push({
          id: String(f.id || `usgs-${evLat}-${evLon}-${p.time || ''}`),
          source: isBlastOrNonTectonic ? 'USGS_KINETIC_BLAST' : 'USGS_MICROSEISMIC',
          title: String(p.title || `M${mag.toFixed(1)} ${evType.toUpperCase()} — ${p.place || 'Local Sector'}`),
          severity:
            isBlastOrNonTectonic || mag >= 5.0
              ? 'CRITICAL'
              : mag >= 4.0
              ? 'HIGH'
              : mag >= 3.0
              ? 'MED'
              : 'LOW',
          summary: `${evType.toUpperCase()} M${mag.toFixed(1)} at ${p.place || 'local sensor'} (depth ${Number(coords[2] ?? 0).toFixed(1)} km)`,
          lat: evLat,
          lon: evLon,
          timestamp: p.time ? new Date(Number(p.time)).toISOString() : new Date().toISOString(),
          sourceEndpoint: usgsUrl,
          rawPayload: f,
        });
      }
    })(),

    // 4. NASA EONET Live Open Wildfires, Severe Storms & Volcanic Thermal Events
    (async () => {
      const eonetUrl = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30';
      sourcesPolled.push(eonetUrl);
      const res = await fetch(eonetUrl, { signal: AbortSignal.timeout(7500) });
      if (!res.ok) return;
      const data: any = await res.json();
      const events = Array.isArray(data?.events) ? data.events : [];
      for (const ev of events) {
        const geom = Array.isArray(ev?.geometry) ? ev.geometry[ev.geometry.length - 1] : null;
        const coords = geom?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const evLon = Number(coords[0]);
        const evLat = Number(coords[1]);
        if (!Number.isFinite(evLat) || !Number.isFinite(evLon)) continue;
        const catTitle = String(ev?.categories?.[0]?.title || 'Thermal/Natural Hazard');
        rawHazards.push({
          id: String(ev.id || `eonet-${evLat}-${evLon}`),
          source: 'NASA_EONET_THERMAL',
          title: `[EONET ${catTitle.toUpperCase()}] ${ev.title || 'Active Thermal Anomaly'}`,
          severity: /wildfire|volcano|severe/i.test(catTitle) ? 'HIGH' : 'MED',
          summary: `${catTitle}: ${ev.title || 'Active satellite-detected event'}`,
          lat: evLat,
          lon: evLon,
          timestamp: String(geom?.date || new Date().toISOString()),
          sourceEndpoint: eonetUrl,
          rawPayload: ev,
        });
      }
    })(),
  ]);

  const boundedDispatches = filterItemsWithinGeofence(
    rawDispatches,
    (it) => ({ lat: it.lat, lon: it.lon }),
    { lat, lon, radiusKm }
  );

  const boundedHazards = filterItemsWithinGeofence(
    rawHazards,
    (it) => ({ lat: it.lat, lon: it.lon }),
    { lat, lon, radiusKm }
  );

  return {
    sourcesPolled,
    municipalDispatches: boundedDispatches,
    geoHazardSignals: boundedHazards,
  };
}

/**
 * Executes a full multi-sensor Pre-Media Localized Threat Sweep:
 * 1. Collects live Municipal CAD / NWS CAP, ADS-B Tactical Airspace, Atmospheric Plume Sensors, and USGS/EONET Hazards.
 * 2. Runs priority CAD/scanner dispatches through Gemini 3.1 Flash Lite triage (`analyzeDispatchSignal`).
 * 3. Ingests verified pre-media packets across independent CorroborationEngine tracks (`WRITTEN_WIRE`, `WIDE_AREA`, `SIGNALS_INFRA`)
 *    so Nyx -> Cipher -> Vance automatically corroborate and alert on unfolding local incidents.
 */
export async function runPreMediaLocalizedThreatSweep(options?: {
  lat?: number;
  lon?: number;
  radiusKm?: number;
  extraFeedUrls?: string[];
  scannerTranscript?: string;
  ingestIntoCorroboration?: boolean;
}): Promise<PreMediaSweepReport> {
  const base: LocalGeofenceConfig = getLocalGeofenceConfig();
  const lat = options?.lat !== undefined && Number.isFinite(options.lat) ? options.lat : base.lat;
  const lon = options?.lon !== undefined && Number.isFinite(options.lon) ? options.lon : base.lon;
  const radiusKm =
    options?.radiusKm !== undefined && Number.isFinite(options.radiusKm)
      ? Math.max(1, Math.min(500, options.radiusKm))
      : base.radiusKm;
  const sectorKey = base.label || 'LOCAL-SECTOR';
  const shouldIngest = options?.ingestIntoCorroboration !== false;

  const [hazardsAndCadRes, adsbRes, plumeRes] = await Promise.all([
    queryPreMediaGeoHazardsAndCad({ lat, lon, radiusKm, extraFeedUrls: options?.extraFeedUrls }),
    queryGeofencedAdsbAirspace({ lat, lon, radiusKm }),
    queryGeofencedPlumeAndEnvSensors({ lat, lon }),
  ]);

  const sourcesPolled = [
    ...hazardsAndCadRes.sourcesPolled,
    adsbRes.endpointUsed,
    ...(plumeRes ? [plumeRes.sourceEndpoint] : []),
  ];

  const triagedDispatches: DispatchTriageResult[] = [];
  if (options?.scannerTranscript && options.scannerTranscript.trim()) {
    try {
      const manualTriage = await analyzeDispatchSignal({
        transcript: options.scannerTranscript.trim(),
        lat,
        lon,
        sectorKey,
        sourceLabel: 'LIVE_SCANNER_INTERCEPT',
        ingestIntoSwarm: shouldIngest,
      });
      triagedDispatches.push(manualTriage);
    } catch {}
  }

  // Triage top high-priority municipal CAD dispatches automatically
  for (const cad of hazardsAndCadRes.municipalDispatches.slice(0, 3)) {
    if (cad.severity === 'HIGH' || cad.severity === 'CRITICAL') {
      try {
        const tRes = await analyzeDispatchSignal({
          transcript: `${cad.title}. ${cad.summary}`,
          lat: cad.lat,
          lon: cad.lon,
          sectorKey,
          sourceLabel: cad.sourceType.toUpperCase(),
          sourceUrl: cad.sourceUrl,
          ingestIntoSwarm: false, // ingested cleanly below with exact coordinates
        });
        triagedDispatches.push(tRes);
      } catch {}
    }
  }

  let packetsIngested = 0;
  let deltasEmitted = 0;
  const promotedClusterIds = new Set<string>();
  let activeCorroboratedCount = 0;

  if (shouldIngest) {
    try {
      const { ingestPacket, getCorroborationStatusSummary } = await import('./CorroborationEngine');

      // Track A (Nyx — WRITTEN_WIRE): Municipal 911 CAD & NWS CAP dispatches
      for (const inc of hazardsAndCadRes.municipalDispatches.slice(0, 6)) {
        const res = await ingestPacket({
          sourceTrack: 'WRITTEN_WIRE',
          sourceType: 'local_dispatch',
          canonicalTargetKey: inc.id,
          payloadTimestamp: inc.timestamp,
          sourceEndpoint: inc.sourceUrl,
          ingestedBy: 'nyx',
          ttlSeconds: 900,
          geoAnchor: { lat: inc.lat, lon: inc.lon, radiusKm: Math.min(radiusKm, 35), precision: 'EXACT' },
          sectorKey,
          summaryHeadline: `[${inc.sourceType.toUpperCase()}] ${inc.title}`,
          rawPayload: inc,
        });
        packetsIngested += 1;
        if (res.deltaEmitted) deltasEmitted += 1;
        if (res.promotedToCorroborated && res.cluster) promotedClusterIds.add(res.cluster.clusterId);
      }

      // Track B (Nyx — WIDE_AREA): Geofenced USGS Micro-Seismic / Kinetic Blast & NASA EONET Thermal
      for (const haz of hazardsAndCadRes.geoHazardSignals.slice(0, 6)) {
        if (haz.source === 'NWS_CAP_POLYGON') continue; // already ingested on WRITTEN_WIRE
        const res = await ingestPacket({
          sourceTrack: 'WIDE_AREA',
          sourceType: haz.source.toLowerCase(),
          canonicalTargetKey: haz.id,
          payloadTimestamp: haz.timestamp,
          sourceEndpoint: haz.sourceEndpoint,
          ingestedBy: 'nyx',
          ttlSeconds: 600,
          geoAnchor: { lat: haz.lat, lon: haz.lon, radiusKm: Math.min(radiusKm, 35), precision: 'EXACT' },
          sectorKey,
          summaryHeadline: haz.title,
          rawPayload: haz.rawPayload,
        });
        packetsIngested += 1;
        if (res.deltaEmitted) deltasEmitted += 1;
        if (res.promotedToCorroborated && res.cluster) promotedClusterIds.add(res.cluster.clusterId);
      }

      // Track C (Cipher — SIGNALS_INFRA): ADS-B Emergency Squawks & Orbiting Medevac/Police/ISR Airframes
      for (const ac of adsbRes.tacticalContacts.slice(0, 5)) {
        const res = await ingestPacket({
          sourceTrack: 'SIGNALS_INFRA',
          sourceType: 'adsb_airspace',
          canonicalTargetKey: `adsb:${ac.icaoHex}:${ac.tacticalFlag}`,
          payloadTimestamp: ac.capturedAt,
          sourceEndpoint: adsbRes.endpointUsed,
          ingestedBy: 'cipher',
          ttlSeconds: 300,
          geoAnchor: { lat: ac.lat, lon: ac.lon, radiusKm: 20, precision: 'EXACT' },
          sectorKey,
          summaryHeadline: `[ADS-B ${ac.tacticalFlag}] ${ac.summary}`,
          rawPayload: ac,
        });
        packetsIngested += 1;
        if (res.deltaEmitted) deltasEmitted += 1;
        if (res.promotedToCorroborated && res.cluster) promotedClusterIds.add(res.cluster.clusterId);
      }

      // Track C2 (Cipher — SIGNALS_INFRA): Atmospheric Smoke / Chemical Plume Spike (strictly when anomalous)
      if (plumeRes && plumeRes.anomalyDetected) {
        const res = await ingestPacket({
          sourceTrack: 'SIGNALS_INFRA',
          sourceType: 'air_plume_sensor',
          canonicalTargetKey: `plume:${lat.toFixed(2)},${lon.toFixed(2)}:${plumeRes.anomalyType}`,
          payloadTimestamp: plumeRes.capturedAt,
          sourceEndpoint: plumeRes.sourceEndpoint,
          ingestedBy: 'cipher',
          ttlSeconds: 600,
          geoAnchor: { lat, lon, radiusKm: 20, precision: 'EXACT' },
          sectorKey,
          summaryHeadline: `[PLUME SENSOR] ${plumeRes.summary}`,
          rawPayload: plumeRes,
        });
        packetsIngested += 1;
        if (res.deltaEmitted) deltasEmitted += 1;
        if (res.promotedToCorroborated && res.cluster) promotedClusterIds.add(res.cluster.clusterId);
      }

      const statusSummary = await getCorroborationStatusSummary();
      activeCorroboratedCount =
        (statusSummary.statusCounts.CORROBORATED || 0) +
        (statusSummary.statusCounts.CRITICAL_CONVERGENCE || 0);
    } catch {}
  }

  try {
    await appendCommandLedgerEntry({
      timestamp: new Date().toISOString(),
      command_input: `PREMEDIA_THREAT_SWEEP (${lat.toFixed(4)}, ${lon.toFixed(4)} r=${radiusKm}km)`,
      involved_agent: 'rec_nyx',
      tool_used: 'osint_local_premedia_sweep',
      result_summary: `CAD=${hazardsAndCadRes.municipalDispatches.length}, ADSB_TACTICAL=${adsbRes.tacticalContacts.length}/${adsbRes.totalAircraft}, PLUME=${plumeRes?.anomalyDetected ? plumeRes.anomalyType : 'NOMINAL'}, HAZARDS=${hazardsAndCadRes.geoHazardSignals.length}, DELTAS=${deltasEmitted}`,
      success_boost_achieved: deltasEmitted > 0 ? 92 : 60,
    });
  } catch {}

  return {
    sweptAt: new Date().toISOString(),
    geofence: { lat, lon, radiusKm, label: sectorKey },
    sourcesPolled,
    municipalDispatches: hazardsAndCadRes.municipalDispatches,
    triagedDispatches,
    adsbTotalAircraft: adsbRes.totalAircraft,
    adsbTacticalContacts: adsbRes.tacticalContacts,
    plumeReading: plumeRes,
    geoHazardSignals: hazardsAndCadRes.geoHazardSignals,
    corroboration: {
      packetsIngested,
      deltasEmitted,
      promotedClusterIds: Array.from(promotedClusterIds),
      activeCorroboratedCount,
    },
  };
}

/**
 * Builds a concise, real-time pre-media situational awareness block injected into agent system prompts
 * so Vance, Nyx, and Cipher immediately cite active geofence telemetry & corroborated packetIds.
 */
export async function buildLivePreMediaAgentContext(): Promise<string> {
  try {
    const geofence = getLocalGeofenceConfig();
    const { getCorroborationStatusSummary } = await import('./CorroborationEngine');
    const summary = await getCorroborationStatusSummary();
    const activeClusters = (summary.clusters || [])
      .filter((c) => c.status !== 'DISMISSED' && c.status !== 'STALE')
      .slice(0, 5);

    const clusterLines =
      activeClusters.length > 0
        ? activeClusters.map(
            (c) =>
              `- [${c.status} | score=${c.corroborationScore.toFixed(2)} | tracks=${c.independentTracks.join('+')}] ${c.title} @ (${c.geoAnchor.lat.toFixed(3)}, ${c.geoAnchor.lon.toFixed(3)}) — clusterId=\`${c.clusterId}\`, packets=${c.packetIds.map((p) => `\`${p.slice(0, 12)}…\``).join(', ')}`
          )
        : ['- No active multi-source threat clusters above baseline in IndexedDB; invoke `osint_local_premedia_sweep`, `osint_adsb_airspace_radar`, or `osint_scanner_dispatch_triage` to collect fresh pre-media signals.'];

    return [
      PRE_MEDIA_COLLECTION_DOCTRINE,
      '',
      `### ACTIVE OPERATOR GEOFENCE & SWARM CORROBORATION STATE:`,
      `- Geofence Anchor: \`[${geofence.lat.toFixed(4)}, ${geofence.lon.toFixed(4)}]\` | Radius: \`<= ${geofence.radiusKm} km\` | Sector: \`${geofence.label}\` | High-Alert 60s Poll: \`${geofence.highAlertMode ? 'ARMED' : 'STANDBY'}\``,
      `- IndexedDB Evidence Store: \`${summary.totalPackets}\` raw SHA-256 packets | \`${summary.statusCounts.CRITICAL_CONVERGENCE || 0}\` CRITICAL_CONVERGENCE | \`${summary.statusCounts.CORROBORATED || 0}\` CORROBORATED | \`${summary.statusCounts.CANDIDATE || 0}\` CANDIDATE`,
      ...clusterLines,
    ].join('\n');
  } catch {
    return PRE_MEDIA_COLLECTION_DOCTRINE;
  }
}
