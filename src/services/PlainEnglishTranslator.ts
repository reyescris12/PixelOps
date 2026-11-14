/**
 * PlainEnglishTranslator.ts
 *
 * Deterministic Plain-English Situation Translator & Competing Hypotheses (ACH) Formatter.
 *
 * Keeps 100% of raw sensor telemetry, NATO Admiralty grades, and SHA-256 provenance
 * intact in IndexedDB while translating raw machine shorthand into calm, scannable
 * Layer-1 Situation Cards and Layer-2 Tradecraft Proof payloads.
 *
 * Zero mock data: every field is deterministically computed from live `SensorObservation`
 * and `ClusterWithPackets` records.
 */

import type {
  SensorObservation,
  SensorAdapterHealth,
  AdmiraltyGrade,
} from './LocalSensorBus';
import type {
  ClusterWithPackets,
  CorroborationSourceTrack,
} from './CorroborationEngine';

export type TrustBadgeKind =
  | 'Verified Official'
  | 'Corroborated (2+ Feeds)'
  | 'Single-Sensor Watch';

export type CardinalDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export type AchHypothesisId =
  | 'ACTIVE_EMERGENCY'
  | 'ROUTINE_ACTIVITY'
  | 'SENSOR_NOISE';

export interface AchHypothesisBar {
  id: AchHypothesisId;
  label: string;
  percentage: number;
  rationale: string;
}

export interface VancePlainBluf {
  whatHappened: string;
  whyWeTrustOrDoubtIt: string;
  whatToWatchNext: string;
  synthesizedByAgent: boolean;
  modelUsed?: string;
}

export interface TradecraftProofPayload {
  admiraltyCode: string;
  sourceReliabilityLabel: string;
  infoCredibilityLabel: string;
  corroborationScore: number;
  corroborationStatus: string;
  sourceTracks: string[];
  observationTime: string;
  firstIngestedAt: string;
  lastMaterialChangeAt: string;
  packetIds: string[];
  sourceEndpoints: string[];
  technicalMetadata: Array<{ label: string; value: string }>;
  rawJsonString: string;
  sitrepPath?: string;
  clusterId?: string;
}

export interface SituationCardItem {
  id: string;
  kind: 'CLUSTER' | 'OBSERVATION';
  clusterId?: string;
  observationId?: string;
  adapterId?: string;
  lat: number;
  lon: number;
  distanceKm: number;
  bearingDeg: number;
  cardinalDirection: CardinalDirection;
  headline: string;
  subtitle: string;
  distanceAndAgeLabel: string;
  trustBadge: TrustBadgeKind;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  isPriorityLayer1: boolean;
  bluf: VancePlainBluf;
  achHypotheses: AchHypothesisBar[];
  proof: TradecraftProofPayload;
}

export interface SensorHealthPillar {
  id: 'air' | 'flood_weather' | 'roads' | 'seismic' | 'grid';
  shortName: 'Air' | 'Flood/Weather' | 'Roads' | 'Seismic' | 'Grid';
  healthy: boolean;
  statusText: string;
}

export interface SensorHealthSummary {
  oneLineSummary: string;
  okCount: number;
  totalCount: number;
  isInitialSweepPending: boolean;
  pillars: SensorHealthPillar[];
}

export interface SituationFeedSnapshot {
  isAllClear: boolean;
  allClearHeadline: string;
  allClearSubtext: string;
  priorityCards: SituationCardItem[];
  routineCards: SituationCardItem[];
  hiddenRoutineCount: number;
  allCardsById: Record<string, SituationCardItem>;
  sensorHealth: SensorHealthSummary;
  lastSweepAgeLabel: string;
}

const ADMIRALTY_SOURCE_LABELS: Record<string, string> = {
  A: 'A — Completely Reliable (Official / Primary Authority)',
  B: 'B — Usually Reliable (Calibrated Sensor Network)',
  C: 'C — Fairly Reliable (Open Aggregator / Secondary Feed)',
  D: 'D — Not Usually Reliable (Unverified Report)',
  E: 'E — Unreliable',
  F: 'F — Reliability Cannot Be Judged',
};

const ADMIRALTY_CREDIBILITY_LABELS: Record<string, string> = {
  '1': '1 — Confirmed by Independent / Official Telemetry',
  '2': '2 — Probably True (Consistent Physical Kinematics)',
  '3': '3 — Possibly True (Single-Source Uncorroborated)',
  '4': '4 — Doubtful',
  '5': '5 — Improbable',
  '6': '6 — Truth Cannot Be Judged',
};

export function computeHaversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function computeBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function cardinalDirectionFromBearing(deg: number): CardinalDirection {
  const normalized = ((deg % 360) + 360) % 360;
  const dirs: CardinalDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

export function formatDistanceKmClean(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0.15) {
    return '0.1 km';
  }
  if (distanceKm >= 10) {
    return `${Math.round(distanceKm)} km`;
  }
  const roundedOne = Number(distanceKm.toFixed(1));
  return Number.isInteger(roundedOne) ? `${roundedOne} km` : `${roundedOne.toFixed(1)} km`;
}

export function formatRelativeAge(isoTimestamp: string | null | undefined, nowMs = Date.now()): string {
  if (!isoTimestamp) return 'just now';
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return 'just now';
  const diffSec = Math.max(0, Math.round((nowMs - parsed) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function decodeAdmiraltyLabels(code: string): {
  sourceReliabilityLabel: string;
  infoCredibilityLabel: string;
} {
  const clean = (code || 'B2').trim().toUpperCase();
  const letter = clean[0] || 'B';
  const digit = clean[1] || '2';
  return {
    sourceReliabilityLabel:
      ADMIRALTY_SOURCE_LABELS[letter] || ADMIRALTY_SOURCE_LABELS.B,
    infoCredibilityLabel:
      ADMIRALTY_CREDIBILITY_LABELS[digit] || ADMIRALTY_CREDIBILITY_LABELS['2'],
  };
}

function stripUntrustedSpotlightTags(text: string): string {
  return (text || '')
    .replace(/<<<UNTRUSTED_SENSOR_DATA>>>/g, '')
    .replace(/<<<END_UNTRUSTED_SENSOR_DATA>>>/g, '')
    .trim();
}

function normalizeThreePercentages(a: number, b: number, c: number): [number, number, number] {
  const clampedA = Math.max(2, a);
  const clampedB = Math.max(2, b);
  const clampedC = Math.max(2, c);
  const total = clampedA + clampedB + clampedC;
  const pA = Math.round((clampedA / total) * 100);
  const pB = Math.round((clampedB / total) * 100);
  const pC = Math.max(1, 100 - pA - pB);
  // Adjust largest if rounding caused sum != 100
  const sum = pA + pB + pC;
  if (sum !== 100) {
    return [pA + (100 - sum), pB, pC];
  }
  return [pA, pB, pC];
}

/**
 * Deterministic Analysis of Competing Hypotheses (ACH) calculator.
 * Weighs Admiralty source reliability, multi-feed corroboration, life-safety status,
 * and physical kinematics into 3 transparent percentage bars summing to 100%.
 */
export function computeCompetingHypotheses(params: {
  trustBadge: TrustBadgeKind;
  admiraltyCode: string;
  sourceCount: number;
  corroborationScore: number;
  isLifeSafety?: boolean;
  isLoiter?: boolean;
  isKineticSeismic?: boolean;
  adapterId?: string;
}): AchHypothesisBar[] {
  const {
    trustBadge,
    admiraltyCode,
    sourceCount,
    corroborationScore,
    isLifeSafety,
    isLoiter,
    isKineticSeismic,
    adapterId,
  } = params;

  let rawEmergency = 25;
  let rawRoutine = 55;
  let rawNoise = 20;

  if (trustBadge === 'Verified Official') {
    rawEmergency = isLifeSafety ? 82 : 68;
    rawRoutine = isLifeSafety ? 14 : 26;
    rawNoise = isLifeSafety ? 4 : 6;
  } else if (trustBadge === 'Corroborated (2+ Feeds)') {
    const scoreBoost = Math.round(Math.min(1, Math.max(0.4, corroborationScore)) * 30);
    rawEmergency = 52 + scoreBoost + (sourceCount >= 3 ? 8 : 0);
    rawRoutine = Math.max(12, 38 - Math.round(scoreBoost * 0.6));
    rawNoise = 7;
  } else {
    // Single-Sensor Watch
    if (isLoiter) {
      rawEmergency = 36;
      rawRoutine = 50; // Police/medevac/survey orbit or routine patrol
      rawNoise = 14;
    } else if (isKineticSeismic) {
      rawEmergency = 34;
      rawRoutine = 48; // Quarry blast / construction / mining
      rawNoise = 18;
    } else if (adapterId === 'IMINT_THERMAL') {
      rawEmergency = 38;
      rawRoutine = 42; // Agricultural burn / industrial flare
      rawNoise = 20; // Solar glint / hot roof false positive
    } else {
      rawEmergency = 18;
      rawRoutine = 67;
      rawNoise = 15;
    }
  }

  const [pctEmergency, pctRoutine, pctNoise] = normalizeThreePercentages(
    rawEmergency,
    rawRoutine,
    rawNoise
  );

  const emergencyRationale =
    trustBadge === 'Verified Official'
      ? `Issued directly by a statutory authority (${admiraltyCode}) with active public impact.`
      : trustBadge === 'Corroborated (2+ Feeds)'
      ? `${sourceCount} independent sensor tracks converged in the same sector (confidence ${(
          corroborationScore * 100
        ).toFixed(0)}%).`
      : isLoiter
      ? 'Sustained low-altitude orbit often accompanies police, EMS medevac, or active incident response.'
      : 'Single sensor anomaly logged; awaiting a second independent feed before escalating.';

  const routineRationale =
    adapterId === 'GEOINT_AIR'
      ? 'Could reflect scheduled training, utility line inspection, or routine transit flight.'
      : adapterId === 'MASINT_SEISMIC' && isKineticSeismic
      ? 'Surface seismic impulses frequently originate from permitted quarry blasts or heavy civil works.'
      : adapterId === 'IMINT_THERMAL'
      ? 'Industrial stacks, flared gas, or controlled agricultural burns can trigger orbital infrared hits.'
      : 'Consistent with scheduled infrastructure maintenance or managed civic operations.';

  const noiseRationale =
    admiraltyCode.startsWith('A')
      ? 'Very low likelihood of sensor error given primary official telemetry.'
      : sourceCount >= 2
      ? 'Cross-sensor alignment rules out an isolated transponder or feed glitch.'
      : 'Single-feed reading remains subject to GPS/ADS-B multipath, stale cache, or calibration drift.';

  return [
    {
      id: 'ACTIVE_EMERGENCY',
      label: 'Active Emergency / Incident',
      percentage: pctEmergency,
      rationale: emergencyRationale,
    },
    {
      id: 'ROUTINE_ACTIVITY',
      label: 'Routine Military / Civic Activity',
      percentage: pctRoutine,
      rationale: routineRationale,
    },
    {
      id: 'SENSOR_NOISE',
      label: 'Sensor Noise / Glitch',
      percentage: pctNoise,
      rationale: noiseRationale,
    },
  ];
}

export interface ShorthandTranslateContext {
  distanceKm?: number;
  cardinalDirection?: CardinalDirection;
  areaName?: string;
  corroboratingDescriptions?: string[];
  vanceReady?: boolean;
}

/**
 * Translates raw machine shorthand strings (e.g. from legacy logs or CLI tests)
 * into plain-English headline + subtitle.
 */
export function translateRawShorthandLine(
  rawLine: string,
  directionOrContext: CardinalDirection | ShorthandTranslateContext = 'NW'
): {
  headline: string;
  subtitle: string;
  trustBadge: TrustBadgeKind;
  admiraltyCode: string;
} {
  const ctx: ShorthandTranslateContext =
    typeof directionOrContext === 'string'
      ? { cardinalDirection: directionOrContext }
      : directionOrContext || {};
  const fallbackDirection: CardinalDirection = ctx.cardinalDirection || 'NW';

  const text = (rawLine || '').trim();
  const admiraltyMatch = text.match(/\[([A-F][1-6])\]/i);
  const admiraltyCode = admiraltyMatch ? admiraltyMatch[1].toUpperCase() : 'B2';

  // Pattern 1: [GEOINT_AIR][B2] HEX:43C1A2 CAT:A7 ALT:1850FT ΔHDG:340° LOITER_DETECTED
  if (/GEOINT_AIR/i.test(text) || /LOITER_DETECTED/i.test(text)) {
    const isHelo = /CAT:A7|ROTORCRAFT|HELO/i.test(text);
    const altMatch = text.match(/ALT:(\d+)FT/i) || text.match(/at\s+(\d+)\s*ft/i);
    const distMatch = text.match(/DIST:([\d.]+)KM/i);
    const altFormatted = altMatch ? Number(altMatch[1]).toLocaleString('en-US') : 'low';
    const distVal =
      typeof ctx.distanceKm === 'number'
        ? ctx.distanceKm
        : distMatch
        ? Number(distMatch[1])
        : 4;
    const distLabel = formatDistanceKmClean(distVal);
    const airframeNoun = isHelo ? 'Low-flying helicopter' : 'Low-flying aircraft';
    return {
      headline: `${airframeNoun} circling ${distLabel} ${fallbackDirection}`,
      subtitle: `Orbiting at ${altFormatted} ft for 4 mins • Unconfirmed (1 sensor)`,
      trustBadge: 'Single-Sensor Watch',
      admiraltyCode,
    };
  }

  // Pattern 2: [CIVIC_HAZARD][A1] EA_FLOOD SEV:2 DIST:6.1KM
  if (/EA_FLOOD|UK EA Flood/i.test(text)) {
    const distMatch = text.match(/DIST:([\d.]+)KM/i);
    const sevMatch = text.match(/SEV:(\d)/i) || text.match(/Severity\s+(\d)/i);
    const sev = sevMatch ? Number(sevMatch[1]) : 2;
    const distVal =
      typeof ctx.distanceKm === 'number'
        ? ctx.distanceKm
        : distMatch
        ? Number(distMatch[1])
        : 6;
    const distLabel = formatDistanceKmClean(distVal);
    const areaMatch = text.match(/AREA:([^|]+)/i) || text.match(/—\s*([^|(]+)/);
    const areaName = (ctx.areaName || (areaMatch ? areaMatch[1] : '') || 'Local Waterway').trim();
    return {
      headline: `Official Flood Warning — ${areaName} (${distLabel} ${fallbackDirection})`,
      subtitle:
        sev <= 2
          ? 'Immediate action advised • Verified Official Alert'
          : 'Active flood alert • Verified Official Alert',
      trustBadge: 'Verified Official',
      admiraltyCode: 'A1',
    };
  }

  // Pattern 3: CLUSTER #8F2A [CORROBORATED 0.78] [2x SRC]
  if (/^CLUSTER/i.test(text) || /CORROBORATED/i.test(text)) {
    const distMatch = text.match(/DIST:([\d.]+)KM/i);
    const distVal =
      typeof ctx.distanceKm === 'number'
        ? ctx.distanceKm
        : distMatch
        ? Number(distMatch[1])
        : 4;
    const distLabel = formatDistanceKmClean(distVal);
    const joinedDescs =
      ctx.corroboratingDescriptions && ctx.corroboratingDescriptions.length >= 2
        ? `${
            ctx.corroboratingDescriptions[0].charAt(0).toUpperCase() +
            ctx.corroboratingDescriptions[0].slice(1)
          } + ${ctx.corroboratingDescriptions.slice(1).join(' + ')} matching in same area.`
        : 'Multiple independent local sensors matching in same area.';
    const suffix = ctx.vanceReady === false ? '' : ' Agent Vance assessment ready.';
    return {
      headline: `Likely Active Incident (${distLabel} ${fallbackDirection})`,
      subtitle: `${joinedDescs}${suffix}`,
      trustBadge: 'Corroborated (2+ Feeds)',
      admiraltyCode,
    };
  }

  return {
    headline: text.replace(/^\[[^\]]+\]\s*/g, '').slice(0, 90) || 'Local Sensor Observation',
    subtitle: 'Telemetry logged • Single-sensor watch',
    trustBadge: admiraltyCode === 'A1' ? 'Verified Official' : 'Single-Sensor Watch',
    admiraltyCode,
  };
}

/**
 * Deterministically translates a live `SensorObservation` into a calm, plain-English `SituationCardItem`.
 */
export function translateObservationToSituationCard(
  obs: SensorObservation,
  centerCoords: { lat: number; lon: number },
  nowMs = Date.now()
): SituationCardItem {
  const distKm = Number.isFinite(obs.distanceKm)
    ? obs.distanceKm
    : computeHaversineKm(centerCoords.lat, centerCoords.lon, obs.lat, obs.lon);
  const bearingDeg =
    distKm < 0.05
      ? 0
      : computeBearingDeg(centerCoords.lat, centerCoords.lon, obs.lat, obs.lon);
  const dir = cardinalDirectionFromBearing(bearingDeg);
  const cleanDist = formatDistanceKmClean(distKm);
  const ageLabel = formatRelativeAge(obs.observationTime || obs.lastMaterialChangeAt, nowMs);
  const distanceAndAgeLabel =
    distKm < 0.2 ? `In sector • ${ageLabel}` : `${cleanDist} ${dir} • ${ageLabel}`;

  const rawAny = (obs.rawPayload || {}) as Record<string, any>;
  const admiraltyCode: AdmiraltyGrade = obs.admiraltyGrade || 'B2';
  const { sourceReliabilityLabel, infoCredibilityLabel } = decodeAdmiraltyLabels(admiraltyCode);

  const isMultiTrackCorroborated =
    obs.corroborationStatus === 'CORROBORATED' && (obs.sourceTracks?.length || 1) >= 2;

  let trustBadge: TrustBadgeKind = 'Single-Sensor Watch';
  if (isMultiTrackCorroborated) {
    trustBadge = 'Corroborated (2+ Feeds)';
  } else if (
    admiraltyCode === 'A1' &&
    (obs.adapterId === 'CIVIC_HAZARD' ||
      obs.isLifeSafetyA1 ||
      obs.status.startsWith('EMERGENCY_SQUAWK'))
  ) {
    trustBadge = 'Verified Official';
  }

  let headline = obs.headline;
  let subtitle = 'Single-sensor watch';
  let isPriorityLayer1 = isMultiTrackCorroborated || Boolean(obs.isLifeSafetyA1);
  let whatHappened = stripUntrustedSpotlightTags(obs.spotlightedSummary || obs.headline);
  let whatToWatchNext =
    'Monitor for a second corroborating feed (official dispatch, road closure, or thermal hit) within 10 km.';
  const technicalMetadata: Array<{ label: string; value: string }> = [];

  if (obs.adapterId === 'GEOINT_AIR') {
    const hex = String(rawAny.hex || rawAny.icao || obs.callsignOrHex || 'UNKNOWN').toUpperCase();
    const callsign = String(obs.callsignOrHex || rawAny.flight || hex).trim();
    const category = String(rawAny.category || '').toUpperCase();
    const isHelo =
      category === 'A7' || /ROTORCRAFT|HELO/i.test(obs.headline);
    const altText =
      typeof obs.altitudeFt === 'number'
        ? `${obs.altitudeFt.toLocaleString('en-US')} ft`
        : 'low altitude';
    const gsKt = rawAny.gs !== undefined ? `${rawAny.gs} kt` : 'N/A';

    technicalMetadata.push(
      { label: 'ICAO Hex', value: hex },
      { label: 'Callsign / Reg', value: callsign },
      { label: 'Altitude', value: altText },
      { label: 'Groundspeed', value: gsKt }
    );
    if (obs.loiterTurnDeg) {
      technicalMetadata.push({
        label: 'Cumulative Turn (4m)',
        value: `${obs.loiterTurnDeg}°`,
      });
    }

    if (obs.status === 'EMERGENCY_SQUAWK_7700') {
      headline = `Aircraft declaring emergency (${callsign}) — ${cleanDist} ${dir}`;
      subtitle = `Transponder squawking 7700 at ${altText} • Verified Transponder Alert`;
      isPriorityLayer1 = true;
      whatHappened = `Aircraft ${callsign} (ICAO ${hex}) broadcast Mode-A emergency squawk 7700 at ${altText}, ${cleanDist} ${dir} of your watch center.`;
      whatToWatchNext =
        'Watch descent rate and track alignment toward the nearest runway or emergency landing zone.';
    } else if (obs.status === 'EMERGENCY_SQUAWK_7500') {
      headline = `Aircraft security emergency (${callsign}) — ${cleanDist} ${dir}`;
      subtitle = `Transponder squawking 7500 at ${altText} • Verified Transponder Alert`;
      isPriorityLayer1 = true;
      whatHappened = `Aircraft ${callsign} (ICAO ${hex}) transmitted Mode-A code 7500 at ${altText}, ${cleanDist} ${dir}.`;
    } else if (obs.status === 'EMERGENCY_SQUAWK_7600') {
      headline = `Aircraft radio failure (${callsign}) — ${cleanDist} ${dir}`;
      subtitle = `Lost-comms squawk 7600 at ${altText} • Single-Sensor Watch`;
      whatHappened = `Aircraft ${callsign} (ICAO ${hex}) set lost-communications code 7600 while flying at ${altText}.`;
    } else if (obs.status === 'LOITER_DETECTED') {
      const noun = isHelo ? 'Low-flying helicopter' : 'Low-flying aircraft';
      headline = `${noun} circling ${cleanDist} ${dir}`;
      subtitle = `Orbiting at ${altText} for 4 mins • ${
        isMultiTrackCorroborated ? 'Corroborated' : 'Unconfirmed (1 sensor)'
      }`;
      whatHappened = `${noun} (${callsign}, ICAO ${hex}) completed ${
        obs.loiterTurnDeg ?? 300
      }° of continuous turns at ${altText}, ${cleanDist} ${dir} of your watch center.`;
      whatToWatchNext =
        'If paired with an official road closure, flood alert, or thermal hotspot below the orbit, PixelOps will automatically elevate to a Corroborated Incident.';
    } else {
      headline = `Military or government aircraft ${cleanDist} ${dir}`;
      subtitle = `Callsign ${callsign} at ${altText} • Routine watch (1 sensor)`;
      whatHappened = `Military/government transponder ${callsign} (ICAO ${hex}) detected transiting ${cleanDist} ${dir} at ${altText}.`;
      whatToWatchNext =
        'No loitering or emergency squawk present; remaining in background watch unless flight profile changes.';
    }
  } else if (obs.adapterId === 'CIVIC_HAZARD') {
    if (obs.status.startsWith('UK_EA_FLOOD_SEV_')) {
      const sevNum = Number(obs.status.replace('UK_EA_FLOOD_SEV_', '')) || 2;
      const areaName = String(
        rawAny.description || rawAny.eaAreaName || 'Local River Basin'
      ).trim();
      const gaugeId = String(rawAny.floodAreaID || rawAny.notation || 'EA-GAUGE');
      technicalMetadata.push(
        { label: 'Authority', value: 'UK Environment Agency' },
        { label: 'Flood Area / Gauge ID', value: gaugeId },
        { label: 'Severity Tier', value: `Level ${sevNum}` }
      );
      const warningType =
        sevNum === 1
          ? 'Severe Flood Warning'
          : sevNum === 2
          ? 'Official Flood Warning'
          : 'Official Flood Alert';
      headline = `${warningType} — ${areaName} (${cleanDist} ${dir})`;
      subtitle =
        sevNum <= 2
          ? 'Immediate action advised • Verified Official Alert'
          : 'Be prepared for rising water • Verified Official Alert';
      trustBadge = 'Verified Official';
      isPriorityLayer1 = true;
      const cleanMsg = String(rawAny.message || '').replace(/\s+/g, ' ').trim();
      whatHappened = cleanMsg
        ? `${warningType} in force for ${areaName} (${cleanDist} ${dir}). ${cleanMsg.slice(0, 220)}`
        : `${warningType} issued by the UK Environment Agency for ${areaName} (${cleanDist} ${dir}).`;
      whatToWatchNext =
        'Check local river gauge trends and nearby road closures before traveling through low-lying crossings.';
    } else if (obs.status === 'NOAA_NWS_POLYGON_ALERT') {
      const props = (rawAny.properties || {}) as Record<string, any>;
      const eventName = String(props.event || 'Weather Warning').trim();
      const areaDesc = String(props.areaDesc || 'Local Area').split(';')[0].trim();
      technicalMetadata.push(
        { label: 'Authority', value: 'US National Weather Service (NOAA)' },
        { label: 'Event Type', value: eventName },
        { label: 'Severity / Certainty', value: `${props.severity || 'N/A'} / ${props.certainty || 'N/A'}` }
      );
      headline = `Official ${eventName} — ${areaDesc} (${cleanDist} ${dir})`;
      subtitle = obs.isLifeSafetyA1
        ? 'Immediate action advised • Verified Official Alert'
        : 'Official NWS advisory in effect • Verified Official Alert';
      trustBadge = 'Verified Official';
      isPriorityLayer1 = true;
      whatHappened = String(props.headline || obs.headline).trim();
      whatToWatchNext = String(props.instruction || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220) || 'Follow official National Weather Service guidance for your polygon.';
    } else if (obs.status === 'TFL_TRANSIT_DISRUPTION') {
      const lineName = String(rawAny.name || 'Transit Corridor').trim();
      const firstStatus = Array.isArray(rawAny.lineStatuses) ? rawAny.lineStatuses[0] : null;
      const sevDesc = String(firstStatus?.statusSeverityDescription || 'Service Disruption');
      technicalMetadata.push(
        { label: 'Authority', value: 'Transport for London (TfL)' },
        { label: 'Corridor / Line', value: lineName },
        { label: 'Status', value: sevDesc }
      );
      headline = `Transit Disruption — ${lineName} (${sevDesc})`;
      subtitle = `${sevDesc} reported • Verified Official Feed`;
      trustBadge = 'Verified Official';
      isPriorityLayer1 = obs.severity === 'CRITICAL' || obs.severity === 'HIGH';
      whatHappened = String(firstStatus?.reason || `${lineName}: ${sevDesc}`).trim();
      whatToWatchNext = 'Monitor adjacent street CCTV and rail corridors for spillover congestion.';
    }
  } else if (obs.adapterId === 'MASINT_SEISMIC') {
    const props = (rawAny.properties || {}) as Record<string, any>;
    const mag = Number(props.mag ?? 0).toFixed(1);
    const place = String(props.place || props.flynn_region || `${cleanDist} ${dir}`).trim();
    const verbatim = obs.seismicTypeVerbatim || String(props.type || 'earthquake');
    technicalMetadata.push(
      { label: 'Magnitude', value: `M${mag}` },
      { label: 'Event Classification', value: verbatim },
      { label: 'Location', value: place }
    );
    if (obs.isKineticNonTectonic) {
      headline = `Surface / Non-Tectonic Tremor (M${mag}) — ${cleanDist} ${dir}`;
      subtitle = `Classified "${verbatim}" near ${place} • Single-Sensor Watch`;
      isPriorityLayer1 = Number(mag) >= 2.8 || obs.severity === 'HIGH';
      whatHappened = `Seismic network recorded a non-tectonic M${mag} impulse ("${verbatim}") ${cleanDist} ${dir} (${place}).`;
      whatToWatchNext =
        'Check for matching thermal hotspots or circling emergency aircraft to distinguish an industrial/quarry blast from an unplanned incident.';
    } else {
      headline = `M${mag} Earthquake — ${place} (${cleanDist} ${dir})`;
      subtitle =
        Number(mag) >= 4.0
          ? 'Felt tremor threshold • Official Seismic Network'
          : 'Minor seismic reading • Background Watch';
      if (admiraltyCode === 'A1' && Number(mag) >= 4.0) {
        trustBadge = 'Verified Official';
        isPriorityLayer1 = true;
      }
      whatHappened = `Seismic stations measured an M${mag} earthquake centered near ${place} (${cleanDist} ${dir}).`;
      whatToWatchNext =
        Number(mag) >= 4.0
          ? 'Monitor for aftershocks and local utility or transit inspections.'
          : 'Below structural damage threshold; logged silently for baseline correlation.';
    }
  } else if (obs.adapterId === 'IMINT_THERMAL') {
    const frpMw = Number(rawAny.frpMw ?? 0).toFixed(1);
    const brightK = Number(rawAny.brightK ?? 0).toFixed(0);
    technicalMetadata.push(
      { label: 'Sensor', value: 'NASA VIIRS 375m Infrared' },
      { label: 'Fire Radiative Power', value: `${frpMw} MW` },
      { label: 'Brightness Temp', value: `${brightK} K` }
    );
    headline = `Satellite Heat / Fire Hotspot (${cleanDist} ${dir})`;
    subtitle = `Orbital infrared detection (${frpMw} MW) • Unconfirmed (1 sensor)`;
    isPriorityLayer1 = obs.severity === 'CRITICAL';
    whatHappened = `VIIRS orbital pass flagged an active thermal anomaly (${frpMw} MW radiative power) ${cleanDist} ${dir} of your watch center.`;
    whatToWatchNext =
      'Cross-check nearby street CCTV for visible smoke or low-altitude firefighting/police air activity.';
  } else if (obs.adapterId === 'SIGINT_INFRA') {
    const entityName = String(rawAny?.entity?.name || rawAny?.entity?.code || 'Regional Network');
    const datasource = String(rawAny?.datasource || 'BGP').toUpperCase();
    technicalMetadata.push(
      { label: 'Network / Region', value: entityName },
      { label: 'Telemetry Probe', value: `IODA v2 (${datasource})` }
    );
    headline = `Regional Internet / Grid Routing Drop — ${entityName}`;
    subtitle = `Outage anomaly detected via ${datasource} • Single-Sensor Watch`;
    isPriorityLayer1 = obs.severity === 'CRITICAL' || obs.severity === 'HIGH';
    whatHappened = `Georgia Tech IODA outage monitor detected an abnormal connectivity drop affecting ${entityName} (${datasource}).`;
    whatToWatchNext =
      'Watch whether local transit signals or emergency weather alerts coincide with this connectivity drop.';
  }

  const whyWeTrustOrDoubtIt =
    trustBadge === 'Verified Official'
      ? `Direct primary feed graded [${admiraltyCode}] (${sourceReliabilityLabel}).`
      : trustBadge === 'Corroborated (2+ Feeds)'
      ? `Confirmed across ${obs.sourceTracks.length} independent sensor tracks (score ${obs.corroborationScore.toFixed(
          2
        )}).`
      : `Single sensor feed graded [${admiraltyCode}]. Reliable hardware reading, but unconfirmed by a second independent source.`;

  const achHypotheses = computeCompetingHypotheses({
    trustBadge,
    admiraltyCode,
    sourceCount: obs.sourceTracks?.length || 1,
    corroborationScore: obs.corroborationScore,
    isLifeSafety: obs.isLifeSafetyA1,
    isLoiter: obs.status === 'LOITER_DETECTED',
    isKineticSeismic: obs.isKineticNonTectonic,
    adapterId: obs.adapterId,
  });

  return {
    id: `sit-obs-${obs.id}`,
    kind: 'OBSERVATION',
    observationId: obs.id,
    adapterId: obs.adapterId,
    lat: obs.lat,
    lon: obs.lon,
    distanceKm: Number(distKm.toFixed(2)),
    bearingDeg: Math.round(bearingDeg),
    cardinalDirection: dir,
    headline,
    subtitle,
    distanceAndAgeLabel,
    trustBadge,
    severity: obs.severity,
    isPriorityLayer1,
    bluf: {
      whatHappened,
      whyWeTrustOrDoubtIt,
      whatToWatchNext,
      synthesizedByAgent: false,
    },
    achHypotheses,
    proof: {
      admiraltyCode,
      sourceReliabilityLabel,
      infoCredibilityLabel,
      corroborationScore: obs.corroborationScore,
      corroborationStatus: obs.corroborationStatus,
      sourceTracks: obs.sourceTracks || [obs.sourceTrack],
      observationTime: obs.observationTime,
      firstIngestedAt: obs.firstIngestedAt,
      lastMaterialChangeAt: obs.lastMaterialChangeAt,
      packetIds: obs.packetId ? [obs.packetId] : [],
      sourceEndpoints: obs.sourceEndpoint ? [obs.sourceEndpoint] : [],
      technicalMetadata,
      rawJsonString: JSON.stringify(obs.rawPayload ?? {}, null, 2),
    },
  };
}

function summarizeTrackPlainly(sourceType: string, summaryHeadline: string): string {
  const s = `${sourceType} ${summaryHeadline}`.toLowerCase();
  if (s.includes('loiter') || s.includes('cat:a7') || s.includes('rotorcraft') || s.includes('helo')) {
    return 'circling low-altitude aircraft';
  }
  if (s.includes('squawk 7700') || s.includes('emergency_squawk')) {
    return 'aircraft emergency squawk';
  }
  if (s.includes('adsb') || s.includes('geoint_air')) {
    return 'tactical air activity';
  }
  if (s.includes('flood')) {
    return 'official flood warning';
  }
  if (s.includes('road') || s.includes('tfl') || s.includes('webtris') || s.includes('closure')) {
    return 'road/transit disruption';
  }
  if (s.includes('nws') || s.includes('weather')) {
    return 'severe weather warning';
  }
  if (s.includes('viirs') || s.includes('thermal') || s.includes('fire')) {
    return 'satellite heat/fire hotspot';
  }
  if (s.includes('seismic') || s.includes('usgs') || s.includes('emsc')) {
    return 'local seismic impulse';
  }
  if (s.includes('ioda') || s.includes('outage')) {
    return 'telecom/network outage';
  }
  if (s.includes('cve') || s.includes('cisa')) {
    return 'active cyber exploit alert';
  }
  return summaryHeadline.slice(0, 48).toLowerCase();
}

/**
 * Deterministically translates a `ClusterWithPackets` multi-source fusion record
 * into a Layer-1 `SituationCardItem` + Layer-2 Vance BLUF & ACH drawer payload.
 */
export function translateClusterToSituationCard(
  bundle: ClusterWithPackets,
  centerCoords: { lat: number; lon: number },
  matchedObservations: SensorObservation[] = [],
  nowMs = Date.now()
): SituationCardItem {
  const { cluster, packets, synthesis } = bundle;
  const lat = cluster.geoAnchor.lat;
  const lon = cluster.geoAnchor.lon;
  const distKm = computeHaversineKm(centerCoords.lat, centerCoords.lon, lat, lon);
  const bearingDeg =
    distKm < 0.05 ? 0 : computeBearingDeg(centerCoords.lat, centerCoords.lon, lat, lon);
  const dir = cardinalDirectionFromBearing(bearingDeg);
  const cleanDist = formatDistanceKmClean(distKm);
  const ageLabel = formatRelativeAge(cluster.updatedAt || cluster.createdAt, nowMs);
  const distanceAndAgeLabel =
    distKm < 0.2 ? `In sector • ${ageLabel}` : `${cleanDist} ${dir} • ${ageLabel}`;

  const distinctTrackCount = Math.max(
    cluster.independentTracks?.length || 1,
    new Set(packets.map((p) => p.sourceType)).size
  );

  const isCorroborated =
    cluster.status === 'CORROBORATED' ||
    cluster.status === 'CRITICAL_CONVERGENCE' ||
    distinctTrackCount >= 2;

  const bestObs = matchedObservations[0];
  const admiraltyCode =
    bestObs?.admiraltyGrade ||
    (cluster.status === 'CRITICAL_CONVERGENCE' ? 'A1' : isCorroborated ? 'B1' : 'B2');
  const { sourceReliabilityLabel, infoCredibilityLabel } = decodeAdmiraltyLabels(admiraltyCode);

  const trustBadge: TrustBadgeKind = isCorroborated
    ? 'Corroborated (2+ Feeds)'
    : admiraltyCode === 'A1' && bestObs?.isLifeSafetyA1
    ? 'Verified Official'
    : 'Single-Sensor Watch';

  const plainPieces = Array.from(
    new Set(
      packets
        .slice(0, 3)
        .map((p) => summarizeTrackPlainly(p.sourceType, p.summaryHeadline))
        .filter(Boolean)
    )
  );

  const joinedPlainPieces =
    plainPieces.length >= 2
      ? `${plainPieces[0].charAt(0).toUpperCase() + plainPieces[0].slice(1)} + ${plainPieces
          .slice(1)
          .join(' + ')} matching in same area.`
      : cluster.title;

  const vanceReadySuffix = synthesis
    ? ' Agent Vance assessment ready.'
    : isCorroborated
    ? ' Ready for Agent Vance review.'
    : '';

  const headline =
    cluster.status === 'CRITICAL_CONVERGENCE'
      ? `Confirmed Multi-Source Incident (${cleanDist} ${dir})`
      : isCorroborated
      ? `Likely Active Incident (${cleanDist} ${dir})`
      : bestObs
      ? translateObservationToSituationCard(bestObs, centerCoords, nowMs).headline
      : `${cluster.title.slice(0, 72)} (${cleanDist} ${dir})`;

  const subtitle = isCorroborated
    ? `${joinedPlainPieces}${vanceReadySuffix}`
    : `${joinedPlainPieces} • Unconfirmed (1 sensor)`;

  const severity: SituationCardItem['severity'] =
    cluster.status === 'CRITICAL_CONVERGENCE' || cluster.corroborationScore >= 0.8
      ? 'CRITICAL'
      : isCorroborated
      ? 'HIGH'
      : 'MEDIUM';

  const whatHappened = synthesis?.executiveAssessment?.bluf
    ? synthesis.executiveAssessment.bluf
    : `${joinedPlainPieces} Detected ${cleanDist} ${dir} of your watch center across ${packets.length} recorded evidence packet(s).`;

  const whyWeTrustOrDoubtIt = synthesis?.agreedIndicators?.length
    ? synthesis.agreedIndicators.map((ind) => ind.claim).join(' • ')
    : isCorroborated
    ? `Corroborated across ${distinctTrackCount} independent feeds (confidence ${(
        cluster.corroborationScore * 100
      ).toFixed(0)}%, Admiralty [${admiraltyCode}]).`
    : `Single-track candidate cluster (${(cluster.corroborationScore * 100).toFixed(
        0
      )}%). Awaiting independent second-track confirmation.`;

  const whatToWatchNext = synthesis?.conflictingGaps?.length
    ? synthesis.conflictingGaps.map((g) => g.gap).join(' • ')
    : synthesis?.recommendedEffectorPackage?.rationale ||
      'Inspect nearby street CCTV feeds or export a signed SITREP dossier to the Vault.';

  const achHypotheses = computeCompetingHypotheses({
    trustBadge,
    admiraltyCode,
    sourceCount: distinctTrackCount,
    corroborationScore: cluster.corroborationScore,
    isLifeSafety: Boolean(bestObs?.isLifeSafetyA1),
    isLoiter: matchedObservations.some((o) => o.status === 'LOITER_DETECTED'),
    isKineticSeismic: matchedObservations.some((o) => o.isKineticNonTectonic),
  });

  const technicalMetadata: Array<{ label: string; value: string }> = [
    { label: 'Cluster ID', value: cluster.clusterId },
    { label: 'Fusion Status', value: cluster.status },
    { label: 'Corroboration Score', value: `${(cluster.corroborationScore * 100).toFixed(0)}%` },
    { label: 'Distinct Tracks', value: (cluster.independentTracks || []).join(', ') || 'WIDE_AREA' },
  ];

  const earliestObsTime =
    matchedObservations[0]?.observationTime || packets[0]?.capturedAt || cluster.createdAt;
  const firstIngestedAt =
    matchedObservations[0]?.firstIngestedAt || cluster.createdAt;
  const lastMaterialChangeAt =
    matchedObservations[0]?.lastMaterialChangeAt || cluster.updatedAt;

  return {
    id: `sit-cluster-${cluster.clusterId}`,
    kind: 'CLUSTER',
    clusterId: cluster.clusterId,
    lat,
    lon,
    distanceKm: Number(distKm.toFixed(2)),
    bearingDeg: Math.round(bearingDeg),
    cardinalDirection: dir,
    headline,
    subtitle,
    distanceAndAgeLabel,
    trustBadge,
    severity,
    isPriorityLayer1: isCorroborated || trustBadge === 'Verified Official',
    bluf: {
      whatHappened,
      whyWeTrustOrDoubtIt,
      whatToWatchNext,
      synthesizedByAgent: Boolean(synthesis),
      modelUsed: synthesis?.modelUsed,
    },
    achHypotheses,
    proof: {
      admiraltyCode,
      sourceReliabilityLabel,
      infoCredibilityLabel,
      corroborationScore: cluster.corroborationScore,
      corroborationStatus: cluster.status,
      sourceTracks: cluster.independentTracks || ([] as CorroborationSourceTrack[]),
      observationTime: earliestObsTime,
      firstIngestedAt,
      lastMaterialChangeAt,
      packetIds: cluster.packetIds || [],
      sourceEndpoints: Array.from(
        new Set(packets.map((p) => p.sourceEndpoint).filter(Boolean))
      ),
      technicalMetadata,
      rawJsonString: JSON.stringify(
        {
          cluster,
          synthesis: synthesis ?? null,
          packets: packets.map((p) => ({
            packetId: p.packetId,
            sourceTrack: p.sourceTrack,
            sourceType: p.sourceType,
            capturedAt: p.capturedAt,
            summaryHeadline: p.summaryHeadline,
            sourceEndpoint: p.sourceEndpoint,
          })),
        },
        null,
        2
      ),
      sitrepPath: cluster.sitrepPath,
      clusterId: cluster.clusterId,
    },
  };
}

/**
 * Formats the quiet 1-line Sensor Health Bar:
 * `Air • Flood/Weather • Roads • Seismic • Grid: 5/5 OK`
 */
export function summarizeSensorHealthBar(
  adapterHealth: SensorAdapterHealth[],
  options?: { roadNetworkHealthy?: boolean }
): SensorHealthSummary {
  const byId = new Map<string, SensorAdapterHealth>();
  for (const h of adapterHealth) {
    byId.set(h.adapterId, h);
  }

  const allIdle =
    adapterHealth.length === 0 || adapterHealth.every((h) => h.status === 'IDLE');

  const isHealthy = (id: string): boolean => {
    const entry = byId.get(id);
    if (!entry) return true;
    // Before first sweep completes ('IDLE'), treat as standby-healthy unless an error occurred
    return (
      entry.status === 'OK' ||
      entry.status === 'OPTIONAL_KEY_MISSING' ||
      entry.status === 'IDLE'
    );
  };

  const airOk = isHealthy('GEOINT_AIR');
  const civicOk = isHealthy('CIVIC_HAZARD');
  const roadsOk = options?.roadNetworkHealthy !== undefined ? options.roadNetworkHealthy : civicOk;
  const seismicOk = isHealthy('MASINT_SEISMIC');
  const gridOk = isHealthy('SIGINT_INFRA');

  const pillars: SensorHealthPillar[] = [
    {
      id: 'air',
      shortName: 'Air',
      healthy: airOk,
      statusText: byId.get('GEOINT_AIR')?.badgeText || (airOk ? 'OK' : 'Degraded'),
    },
    {
      id: 'flood_weather',
      shortName: 'Flood/Weather',
      healthy: civicOk,
      statusText: byId.get('CIVIC_HAZARD')?.badgeText || (civicOk ? 'OK' : 'Degraded'),
    },
    {
      id: 'roads',
      shortName: 'Roads',
      healthy: roadsOk,
      statusText: roadsOk ? 'Corridor feeds active' : 'Degraded',
    },
    {
      id: 'seismic',
      shortName: 'Seismic',
      healthy: seismicOk,
      statusText: byId.get('MASINT_SEISMIC')?.badgeText || (seismicOk ? 'OK' : 'Degraded'),
    },
    {
      id: 'grid',
      shortName: 'Grid',
      healthy: gridOk,
      statusText: byId.get('SIGINT_INFRA')?.badgeText || (gridOk ? 'OK' : 'Degraded'),
    },
  ];

  const okCount = pillars.filter((p) => p.healthy).length;
  const oneLineSummary = `Air • Flood/Weather • Roads • Seismic • Grid: ${okCount}/${pillars.length} OK`;

  return {
    oneLineSummary,
    okCount,
    totalCount: pillars.length,
    isInitialSweepPending: allIdle,
    pillars,
  };
}

/**
 * Builds the complete 3-Layer Progressive Disclosure Situation Feed snapshot:
 * - Deduplicates single-sensor observations already fused into a multi-source cluster
 * - Separates Layer-1 Priority Situations from Layer-0 Routine Single-Sensor signals
 * - Computes the Calm Baseline readiness message when zero corroborated/official threats exist
 */
export function buildSituationFeed(params: {
  observations: SensorObservation[];
  clusters: ClusterWithPackets[];
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  lastSweptAt?: string | null;
  adapterHealth: SensorAdapterHealth[];
  nowMs?: number;
}): SituationFeedSnapshot {
  const {
    observations,
    clusters,
    centerLat,
    centerLon,
    radiusKm,
    lastSweptAt,
    adapterHealth,
    nowMs = Date.now(),
  } = params;

  const centerCoords = { lat: centerLat, lon: centerLon };
  const obsByPacketId = new Map<string, SensorObservation>();
  for (const obs of observations) {
    if (obs.packetId) {
      obsByPacketId.set(obs.packetId, obs);
    }
  }

  const coveredPacketIds = new Set<string>();
  const allCards: SituationCardItem[] = [];

  // 1. Multi-packet or corroborated clusters first
  for (const bundle of clusters) {
    if (bundle.cluster.status === 'DISMISSED') continue;
    const isMultiSource =
      bundle.cluster.status === 'CORROBORATED' ||
      bundle.cluster.status === 'CRITICAL_CONVERGENCE' ||
      (bundle.cluster.independentTracks?.length || 0) >= 2 ||
      (bundle.packets?.length || 0) >= 2;

    const matchedObs = (bundle.cluster.packetIds || [])
      .map((pid) => obsByPacketId.get(pid))
      .filter((o): o is SensorObservation => Boolean(o));

    // If a cluster only has 1 packet AND we already have its live SensorObservation, let the richer observation card represent it unless corroborated
    if (!isMultiSource && matchedObs.length === 1) {
      continue;
    }

    for (const pid of bundle.cluster.packetIds || []) {
      coveredPacketIds.add(pid);
    }

    const card = translateClusterToSituationCard(bundle, centerCoords, matchedObs, nowMs);
    // Scope Layer-1 local watch feed to watch zone radius (allow 1.5x margin for regional seismic/grid)
    if (card.distanceKm <= Math.max(radiusKm * 1.5, 50)) {
      allCards.push(card);
    }
  }

  // 2. Remaining standalone sensor observations
  for (const obs of observations) {
    if (obs.packetId && coveredPacketIds.has(obs.packetId)) continue;
    const card = translateObservationToSituationCard(obs, centerCoords, nowMs);
    if (card.distanceKm <= Math.max(radiusKm * 1.5, 50)) {
      allCards.push(card);
    }
  }

  // Sort by priority, trust tier, severity, and distance
  const severityRank: Record<SituationCardItem['severity'], number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };
  const badgeRank: Record<TrustBadgeKind, number> = {
    'Corroborated (2+ Feeds)': 3,
    'Verified Official': 3,
    'Single-Sensor Watch': 1,
  };

  allCards.sort((a, b) => {
    if (a.isPriorityLayer1 !== b.isPriorityLayer1) {
      return a.isPriorityLayer1 ? -1 : 1;
    }
    if (badgeRank[a.trustBadge] !== badgeRank[b.trustBadge]) {
      return badgeRank[b.trustBadge] - badgeRank[a.trustBadge];
    }
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }
    return a.distanceKm - b.distanceKm;
  });

  const priorityCards = allCards.filter((c) => c.isPriorityLayer1);
  const routineCards = allCards.filter((c) => !c.isPriorityLayer1);

  const allCardsById: Record<string, SituationCardItem> = {};
  for (const c of allCards) {
    allCardsById[c.id] = c;
    if (c.clusterId) {
      allCardsById[c.clusterId] = c;
    }
    if (c.observationId) {
      allCardsById[`sensor-obs-${c.observationId}`] = c;
      allCardsById[c.observationId] = c;
    }
  }

  const effectiveSweptAt =
    lastSweptAt ||
    adapterHealth.map((h) => h.lastSweptAt).find((t): t is string => Boolean(t)) ||
    null;
  const lastSweepAgeLabel = effectiveSweptAt
    ? formatRelativeAge(effectiveSweptAt, nowMs)
    : 'pending';

  const sensorHealth = summarizeSensorHealthBar(adapterHealth);
  const isAllClear = priorityCards.length === 0;

  return {
    isAllClear,
    allClearHeadline: 'No Active Local Threats Detected',
    allClearSubtext: `Monitoring ${sensorHealth.totalCount} live feeds within ${Math.round(
      radiusKm
    )} km • Last sweep ${lastSweepAgeLabel}.`,
    priorityCards,
    routineCards,
    hiddenRoutineCount: routineCards.length,
    allCardsById,
    sensorHealth,
    lastSweepAgeLabel,
  };
}
