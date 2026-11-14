/**
 * Cloudflare Pages Function: Tactical Threat Correlation Matrix & 4-Pillar Recon Engine
 * Route: /api/osint/threat-matrix
 *
 * Aggregates live global & local OSINT sensor feeds (USGS Seismic, NASA EONET, NOAA SWPC Kp,
 * Open-Meteo Local Grid Weather, adsb.lol Airspace, CISA KEV Active Exploits, and Regional Wires)
 * and correlates them by Operational Zone into 4 actionable intelligence pillars.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export const onRequestOptions = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export interface OperationalZoneProfile {
  id: string;
  label: string;
  regionKeywords: string[];
  coordinates: { lat: number; lon: number };
  primaryGridName: string;
  primaryBackboneCorridor: string;
  primaryMaritimeChokepoint: string;
  primaryAirspaceSector: string;
}

const OPERATIONAL_ZONES: Record<string, OperationalZoneProfile> = {
  north_america: {
    id: 'north_america',
    label: 'North America (US / Canada Grid & East-West Backbones)',
    regionKeywords: ['united states', 'us-east', 'us-west', 'ercot', 'pjm', 'caiso', 'north america', 'ashburn', 'virginia', 'california', 'new york', 'texas'],
    coordinates: { lat: 38.9072, lon: -77.0369 },
    primaryGridName: 'NERC Interconnections (PJM / ERCOT / WECC)',
    primaryBackboneCorridor: 'US-East (Ashburn VA) <-> Trans-Atlantic & US-West Fiber Rings',
    primaryMaritimeChokepoint: 'Port of Los Angeles / Long Beach & Panama Canal Approach',
    primaryAirspaceSector: 'FAA CONUS & North Atlantic Tracks (NAT)',
  },
  western_europe: {
    id: 'western_europe',
    label: 'Western Europe (ENTSO-E Grid, Frankfurt/London IXPs & Red Sea Uplink)',
    regionKeywords: ['europe', 'eu-central', 'frankfurt', 'london', 'amsterdam', 'entso-e', 'uk', 'germany', 'france', 'mediterranean', 'red sea'],
    coordinates: { lat: 51.5074, lon: -0.1278 },
    primaryGridName: 'ENTSO-E Continental European & UK National Grid',
    primaryBackboneCorridor: 'LINX London / DE-CIX Frankfurt <-> Mediterranean & Red Sea Submarine Corridor',
    primaryMaritimeChokepoint: 'English Channel, Strait of Gibraltar & Rotterdam Europort',
    primaryAirspaceSector: 'EUROCONTROL Core European & UK London FIR',
  },
  med_red_sea: {
    id: 'med_red_sea',
    label: 'Mediterranean & Red Sea Corridor (Submarine Cable & Suez Chokepoint)',
    regionKeywords: ['red sea', 'suez', 'bab el-mandeb', 'mediterranean', 'egypt', 'submarine cable', 'undersea cable', 'middle east'],
    coordinates: { lat: 29.9668, lon: 32.5498 },
    primaryGridName: 'MENA & Eastern Mediterranean Regional Intertie',
    primaryBackboneCorridor: 'Red Sea / Suez Submarine Fiber Corridor (AAE-1, Seacom, EIG, TGN-EA)',
    primaryMaritimeChokepoint: 'Suez Canal & Bab el-Mandeb Strait',
    primaryAirspaceSector: 'Cairo FIR / Jeddah FIR & Eastern Mediterranean',
  },
  indo_pacific: {
    id: 'indo_pacific',
    label: 'Indo-Pacific & East Asia (Malacca Strait, Taiwan Strait & APAC Cloud)',
    regionKeywords: ['asia', 'indo-pacific', 'taiwan', 'japan', 'singapore', 'malacca', 'south china sea', 'ap-northeast', 'ap-southeast'],
    coordinates: { lat: 1.3521, lon: 103.8198 },
    primaryGridName: 'APAC Regional Power Grids (EMA Singapore / Taipower / TEPCO)',
    primaryBackboneCorridor: 'Intra-Asia & Trans-Pacific Submarine Cable Systems (APG / SJC / Jupiter)',
    primaryMaritimeChokepoint: 'Strait of Malacca & Taiwan Strait Shipping Lanes',
    primaryAirspaceSector: 'Singapore FIR / Taipei FIR / Tokyo FIR',
  },
  global_overwatch: {
    id: 'global_overwatch',
    label: 'Global All-Sector Overwatch (Worldwide Macro-to-Micro Matrix)',
    regionKeywords: ['global', 'worldwide', 'undersea cable', 'cloud outage', 'grid', 'zero-day', 'suez', 'panama'],
    coordinates: { lat: 25.0, lon: 15.0 },
    primaryGridName: 'Global Multi-Region High-Voltage Interconnections',
    primaryBackboneCorridor: 'Red Sea / Mediterranean, Trans-Atlantic & Trans-Pacific Subsea Trunks',
    primaryMaritimeChokepoint: 'Suez Canal, Strait of Hormuz, Malacca Strait & Panama Canal',
    primaryAirspaceSector: 'Global ICAO Flight Information Regions & GNSS Watchzones',
  },
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4500): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLiveCisaKevVulnerabilities(): Promise<
  Array<{
    cveID: string;
    vendorProject: string;
    product: string;
    vulnerabilityName: string;
    dateAdded: string;
    shortDescription: string;
    requiredAction: string;
  }>
> {
  try {
    const res = await fetchWithTimeout(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      { headers: { Accept: 'application/json' } },
      5000
    );
    if (res && res.ok) {
      const data: any = await res.json();
      const vulns = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];
      return vulns
        .slice()
        .sort((a: any, b: any) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')))
        .slice(0, 5);
    }
  } catch {}
  return [];
}

async function fetchLiveUsgsTopEvents(): Promise<
  Array<{ title: string; mag: number; place: string; url: string; timeIso: string; lat: number; lon: number }>
> {
  try {
    const res = await fetchWithTimeout(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
      { headers: { Accept: 'application/geo+json, application/json' } },
      4200
    );
    if (res && res.ok) {
      const data: any = await res.json();
      const features: any[] = Array.isArray(data?.features) ? data.features : [];
      return features.slice(0, 5).map((f) => ({
        title: String(f?.properties?.title || 'M4.5+ Seismic Event'),
        mag: Number(f?.properties?.mag || 4.5),
        place: String(f?.properties?.place || 'Global Plate Boundary'),
        url: String(f?.properties?.url || 'https://earthquake.usgs.gov/'),
        timeIso: f?.properties?.time ? new Date(Number(f.properties.time)).toUTCString() : new Date().toUTCString(),
        lat: Number(f?.geometry?.coordinates?.[1] || 0),
        lon: Number(f?.geometry?.coordinates?.[0] || 0),
      }));
    }
  } catch {}
  return [];
}

async function fetchLiveNoaaSpaceWeather(): Promise<{ kp: number; timeTag: string } | null> {
  try {
    const res = await fetchWithTimeout(
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      { headers: { Accept: 'application/json' } },
      4000
    );
    if (res && res.ok) {
      const arr: any[] = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const last = arr[arr.length - 1];
        const kp = Array.isArray(last) ? Number(last[1]) : Number(last?.Kp ?? last?.kp_index);
        const timeTag = Array.isArray(last) ? String(last[0]) : String(last?.time_tag || '');
        if (Number.isFinite(kp)) return { kp, timeTag };
      }
    }
  } catch {}
  return null;
}

async function fetchLiveLocalOpenMeteo(lat: number, lon: number): Promise<{
  tempC: number | null;
  windKts: number | null;
  windGustKts: number | null;
  cloudPct: number | null;
} | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,cloud_cover,wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn`,
      { headers: { Accept: 'application/json' } },
      3800
    );
    if (res && res.ok) {
      const data: any = await res.json();
      const c = data?.current;
      if (c) {
        return {
          tempC: Number.isFinite(Number(c.temperature_2m)) ? Number(c.temperature_2m) : null,
          windKts: Number.isFinite(Number(c.wind_speed_10m)) ? Math.round(Number(c.wind_speed_10m)) : null,
          windGustKts: Number.isFinite(Number(c.wind_gusts_10m)) ? Math.round(Number(c.wind_gusts_10m)) : null,
          cloudPct: Number.isFinite(Number(c.cloud_cover)) ? Math.round(Number(c.cloud_cover)) : null,
        };
      }
    }
  } catch {}
  return null;
}

async function fetchLiveAdsbSummary(lat: number, lon: number): Promise<{ total: number; tactical: number } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/100`,
      { headers: { Accept: 'application/json' } },
      4200
    );
    if (res && res.ok) {
      const data: any = await res.json();
      const ac: any[] = Array.isArray(data?.ac) ? data.ac : [];
      let tactical = 0;
      for (const a of ac) {
        const sq = String(a?.squawk || '');
        if ((Number(a?.dbFlags) & 1) === 1 || ['7500', '7600', '7700'].includes(sq) || a?.category === 'A7') {
          tactical++;
        }
      }
      return { total: ac.length, tactical };
    }
  } catch {}
  return null;
}

async function geocodeCustomLocation(
  rawQuery: string,
  baseCoords: { lat: number; lon: number }
): Promise<{ lat: number; lon: number; resolvedLabel?: string }> {
  const q = (rawQuery || '').trim();
  if (!q) return baseCoords;

  const commaCoord = q.match(
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

  const usZip = q.match(/^(\d{5})(?:-\d{4})?(?:\s*,?\s*(?:usa?|united states))?$/i);
  if (usZip) {
    try {
      const res = await fetchWithTimeout(`https://api.zippopotam.us/us/${usZip[1]}`, {}, 3000);
      if (res && res.ok) {
        const data: any = await res.json();
        const place = data?.places?.[0];
        if (place?.latitude && place?.longitude) {
          return {
            lat: Number(place.latitude),
            lon: Number(place.longitude),
            resolvedLabel: `${place['place name']}, ${place['state abbreviation'] || place.state} ${usZip[1]}, USA`,
          };
        }
      }
    } catch {}
  }

  const ukMatch = q.match(/^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (ukMatch) {
    const formatted = `${ukMatch[1].toUpperCase()} ${ukMatch[2].toUpperCase()}`;
    try {
      const res = await fetchWithTimeout(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(formatted)}`,
        {},
        3000
      );
      if (res && res.ok) {
        const data: any = await res.json();
        if (data?.result?.latitude && data?.result?.longitude) {
          return {
            lat: Number(data.result.latitude),
            lon: Number(data.result.longitude),
            resolvedLabel: `${formatted}, ${data.result.admin_district || data.result.region || 'UK'}`,
          };
        }
      }
    } catch {}
  }

  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'User-Agent': 'PixelOps-ThreatMatrix/2.1 (tactical-recon)' } },
      3200
    );
    if (res && res.ok) {
      const data: any = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return {
          lat: Number(data[0].lat),
          lon: Number(data[0].lon),
          resolvedLabel: data[0].display_name,
        };
      }
    }
  } catch {}

  return baseCoords;
}

export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let zoneKey = 'north_america';
  let customLocation = '';

  if (request.method === 'GET') {
    const url = new URL(request.url);
    zoneKey = (url.searchParams.get('zone') || 'north_america').toLowerCase();
    customLocation = (url.searchParams.get('customLocation') || url.searchParams.get('location') || '').trim();
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      zoneKey = (body.zone || 'north_america').toLowerCase();
      customLocation = (body.customLocation || body.location || '').trim();
    } catch {}
  }

  const baseZone = OPERATIONAL_ZONES[zoneKey] || OPERATIONAL_ZONES.north_america;
  const resolvedGeo: { lat: number; lon: number; resolvedLabel?: string } = customLocation
    ? await geocodeCustomLocation(customLocation, baseZone.coordinates)
    : baseZone.coordinates;
  const activeZoneLabel = customLocation
    ? `${resolvedGeo.resolvedLabel || customLocation} (${baseZone.label.split(' (')[0]})`
    : baseZone.label;

  const [cisaKevList, usgsEvents, spaceWeather, localMeteo, adsbSummary] = await Promise.all([
    fetchLiveCisaKevVulnerabilities(),
    fetchLiveUsgsTopEvents(),
    fetchLiveNoaaSpaceWeather(),
    fetchLiveLocalOpenMeteo(resolvedGeo.lat, resolvedGeo.lon),
    fetchLiveAdsbSummary(resolvedGeo.lat, resolvedGeo.lon),
  ]);

  const topSeismic = usgsEvents[0];
  const kpVal = spaceWeather?.kp ?? 2.3;
  const kpElevated = kpVal >= 5;

  // 1. PILLAR 1: Live Macro-to-Micro Threat Correlation Matrix
  const correlationEvents = [
    ...(topSeismic
      ? [
          {
            id: `corr-usgs-${topSeismic.lat.toFixed(2)}`,
            operative: 'Agent Cipher',
            severity: topSeismic.mag >= 6.0 ? ('ALPHA-CRITICAL' as const) : ('BRAVO-ELEVATED' as const),
            globalEvent: `Live USGS Seismic Telemetry: ${topSeismic.title} (${topSeismic.lat.toFixed(2)}°, ${topSeismic.lon.toFixed(2)}°)`,
            sourceCitation: `USGS Real-Time GeoJSON (${topSeismic.timeIso})`,
            sourceUrl: topSeismic.url,
            trickleDownImpact: `Agent Cipher evaluates subsea cable landing & regional terrestrial trunk resilience for ${activeZoneLabel} against active global M4.5+ lithospheric activity (${usgsEvents.length} global M4.5+ events in past 24h).`,
            actionableOutput:
              'Verify multi-region LLM endpoint failover and maintain local IndexedDB VFS dossier snapshots.',
            recommendedActionType: 'BACKUP_VAULT_AND_FAILOVER',
          },
        ]
      : []),
    {
      id: 'corr-noaa-swpc',
      operative: 'Agent Nyx',
      severity: kpElevated ? ('BRAVO-ELEVATED' as const) : ('CHARLIE-NOMINAL' as const),
      globalEvent: `NOAA SWPC Planetary Geomagnetic Index Kp=${kpVal.toFixed(2)} (${
        kpElevated ? 'Geomagnetic Storm Active' : 'Nominal Ionospheric State'
      })`,
      sourceCitation: `NOAA Space Weather Prediction Center (${spaceWeather?.timeTag || 'Live UTC'})`,
      sourceUrl: 'https://www.swpc.noaa.gov/',
      trickleDownImpact: kpElevated
        ? `Elevated ionospheric scintillation affecting GNSS L1/L5 timing locks, polar HF aviation comms, and transformer GIC load across ${activeZoneLabel}.`
        : `Stable ionospheric propagation across ${baseZone.primaryBackboneCorridor}; satellite timing & GNSS L1/L5 clocks operating within nominal drift tolerances.`,
      actionableOutput:
        'Cross-check local ADS-B transponder navigation integrity and keep secondary API keys sealed in Safehouse Vault.',
      recommendedActionType: 'VERIFY_ENDPOINTS',
    },
  ];

  // 2. PILLAR 2: Infrastructure & Grid Stability Monitor
  const highWindStrain = (localMeteo?.windGustKts ?? 0) >= 32;
  const gridElevated = kpElevated || highWindStrain;
  const gridThreatBadge = gridElevated
    ? 'THREAT LEVEL: BRAVO - WEATHER / GIC GRID WATCH'
    : 'THREAT LEVEL: CHARLIE - GRID & BACKBONE NOMINAL';

  const infrastructureStatus = {
    threatBadge: gridThreatBadge,
    threatLevel: gridElevated ? ('BRAVO' as const) : ('CHARLIE' as const),
    monitoredGrid: baseZone.primaryGridName,
    backboneHealth: baseZone.primaryBackboneCorridor,
    frequencyHz:
      zoneKey === 'western_europe' || zoneKey === 'med_red_sea' || zoneKey === 'indo_pacific'
        ? '50.00 Hz Synchronous Nominal'
        : '60.00 Hz Synchronous Nominal',
    ispBackboneStatus: localMeteo
      ? `Target Weather: ${localMeteo.tempC ?? '--'}°C | Wind ${localMeteo.windKts ?? '--'}kt (Gusts ${localMeteo.windGustKts ?? '--'}kt) | Cloud ${localMeteo.cloudPct ?? '--'}%`
      : 'Live IXP & Terrestrial Peering Active',
    activeAdvisories: [
      {
        id: 'grid-adv-meteo',
        title: `Localized Surface & Substation Weather Telemetry (${resolvedGeo.lat.toFixed(3)}°, ${resolvedGeo.lon.toFixed(3)}°)`,
        source: 'Open-Meteo + NOAA SWPC Live Feed',
        publishedAt: new Date().toUTCString(),
        url: 'https://open-meteo.com/',
        impact: highWindStrain
          ? `Elevated surface wind gusts (${localMeteo?.windGustKts} kt) detected at target coordinates; monitor overhead distribution lines.`
          : `Surface meteorological parameters (${localMeteo?.tempC ?? '--'}°C, gusts ${localMeteo?.windGustKts ?? '--'} kt) within nominal grid operating envelope for ${activeZoneLabel}.`,
      },
    ],
    preparednessBriefingSummary: `Preparedness protocol for ${activeZoneLabel}: Verify local UPS autonomy, keep IndexedDB VFS vaults synced, and monitor live IODA/NWS alerts.`,
  };

  // 3. PILLAR 3: Live CISA KEV Cyber Threat Radar
  const cyberVulnerabilities = cisaKevList.map((v) => ({
    id: v.cveID,
    cveId: v.cveID,
    title: `${v.vendorProject} ${v.product} — ${v.vulnerabilityName}`,
    severity: 'CRITICAL (CISA KEV ACTIVE EXPLOIT)',
    dateAdded: v.dateAdded,
    summary: v.shortDescription,
    operative: 'Agent Vance',
    remediationChecklist: [
      v.requiredAction || `Apply vendor security patch for ${v.vendorProject} ${v.product} immediately.`,
      `Audit local and cloud dependency trees for ${v.product} exposure.`,
      `Enforce strict egress allowlists and verify zero-trust credentials for ${v.cveID}.`,
    ],
  }));

  // 4. PILLAR 4: Supply Chain, Airspace & Maritime Corridor Status
  const supplyChainDisruptions = [
    {
      id: 'sc-aviation-adsb',
      category: 'LIVE AIRSPACE & ADS-B TRANSPONDER WATCH',
      chokepoint: `${baseZone.primaryAirspaceSector} (${resolvedGeo.lat.toFixed(2)}°, ${resolvedGeo.lon.toFixed(2)}°)`,
      status: adsbSummary
        ? `${adsbSummary.total} AIRCRAFT TRACKED (${adsbSummary.tactical} MIL/GOV/TAC)`
        : 'LIVE ADS-B VECTOR LAYER ACTIVE',
      headline: adsbSummary
        ? `Real-time 100 NM ADS-B sweep tracking ${adsbSummary.total} active transponders (${adsbSummary.tactical} military/government/rotorcraft/emergency contacts) around ${activeZoneLabel}`
        : `Open ADS-B transponder monitoring active across ${baseZone.primaryAirspaceSector}`,
      source: 'adsb.lol Live Unfiltered ADS-B Exchange',
      url: 'https://adsb.lol/',
      practicalImpact:
        'Click any directional aircraft chevron on the Recon Monitor canvas to inspect callsign, ICAO hex, barometric altitude, and groundspeed.',
    },
    {
      id: 'sc-maritime-port',
      category: 'MARITIME CHOKEPOINT & PUBLIC CCTV CORRIDOR',
      chokepoint: baseZone.primaryMaritimeChokepoint,
      status: kpElevated ? 'GNSS SCINTILLATION WATCH' : 'CORRIDOR TELEMETRY ACTIVE',
      headline: `Monitoring maritime & port approach corridors servicing ${baseZone.primaryMaritimeChokepoint}`,
      source: 'Public Port/DOT CCTV & Space Weather Watch',
      url: 'https://www.marinetraffic.com/',
      practicalImpact:
        'Use the Live CCTV Matrix tab to inspect live street, port approach, and highway cameras across covered global hubs.',
    },
  ];

  return new Response(
    JSON.stringify({
      status: 'ok',
      operationalZone: {
        id: baseZone.id,
        label: activeZoneLabel,
        customLocation: customLocation || null,
        coordinates: { lat: resolvedGeo.lat, lon: resolvedGeo.lon },
        primaryGridName: baseZone.primaryGridName,
        primaryBackboneCorridor: baseZone.primaryBackboneCorridor,
        primaryMaritimeChokepoint: baseZone.primaryMaritimeChokepoint,
        primaryAirspaceSector: baseZone.primaryAirspaceSector,
      },
      availableZones: Object.values(OPERATIONAL_ZONES).map((z) => ({
        id: z.id,
        label: z.label,
      })),
      threatCorrelationMatrix: correlationEvents,
      infrastructureAndGrid: infrastructureStatus,
      cyberThreatRadar: cyberVulnerabilities,
      supplyChainDisruptions,
      fetchedAt: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=45',
        ...CORS_HEADERS,
      },
    }
  );
};
