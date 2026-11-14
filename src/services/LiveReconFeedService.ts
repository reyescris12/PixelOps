/**
 * LiveReconFeedService.ts
 *
 * High-grade, zero-mock Global + Local Live Reconnaissance Telemetry Engine:
 * 1. Continuous Web Mercator sub-pixel projection & inverse cursor/drag coordinate math (Z:2..18).
 * 2. Live Public Geotagged CCTV Network Aggregator (~3,000+ real municipal/DOT cameras across
 *    London TfL, California Caltrans Port of LA/San Diego, Austin TX DOT, US Interstate I-80 Iowa DOT,
 *    Singapore LTA Strait of Malacca, Digitraffic Finland/Baltic, plus custom operator camera streams).
 * 3. Live Viewport ADS-B Airspace Transponder Vector Feed (adsb.lol).
 * 4. Live Target Micro-Weather, Wind Vector, Optical Cloud Cover & Plume/AQI Telemetry (Open-Meteo).
 * 5. Live Global Macro Overlays: USGS Worldwide Seismic/Kinetic, NASA EONET Wildfires/Volcanoes/Storms,
 *    NOAA SWPC Planetary Kp Space Weather (HF/GNSS status), and CISA KEV Active Exploits.
 */

export interface LiveCctvCamera {
  id: string;
  name: string;
  networkId:
    | 'TFL_LONDON'
    | 'CALTRANS_LA'
    | 'CALTRANS_SD'
    | 'AUSTIN_DOT'
    | 'IOWA_DOT'
    | 'SINGAPORE_LTA'
    | 'DIGITRAFFIC_FI'
    | 'OPERATOR_CUSTOM';
  networkLabel: string;
  regionLabel: string;
  lat: number;
  lon: number;
  imageUrl: string;
  videoUrl?: string;
  streamType: 'JPEG_REFRESH' | 'MP4_CLIP' | 'HLS_M3U8' | 'MJPEG';
  direction?: string;
  updatedAt: string;
  supportsQueryCacheBust: boolean;
  distanceKm?: number;
  bearingDeg?: number;
}

export interface CctvStrategicHub {
  id: string;
  label: string;
  shortTag: string;
  lat: number;
  lon: number;
  zoom: number;
  sectorCode: string;
  networkId: LiveCctvCamera['networkId'];
}

export const CCTV_STRATEGIC_HUBS: readonly CctvStrategicHub[] = [
  {
    id: 'london_tfl',
    label: 'London TfL JamCam Grid (Westminster / City / Thames)',
    shortTag: '🇬🇧 LONDON TFL',
    lat: 51.5074,
    lon: -0.1278,
    zoom: 13,
    sectorCode: 'CCTV-UK // LONDON-GRID',
    networkId: 'TFL_LONDON',
  },
  {
    id: 'la_port_caltrans',
    label: 'Los Angeles & Port of Long Beach Corridor (Caltrans D7)',
    shortTag: '🇺🇸 LA / PORT LB',
    lat: 33.7701,
    lon: -118.1937,
    zoom: 12,
    sectorCode: 'CCTV-USW // PORT-LA-LB',
    networkId: 'CALTRANS_LA',
  },
  {
    id: 'sandiego_caltrans',
    label: 'San Diego Naval Base & Southern Border Sector (Caltrans D11)',
    shortTag: '🇺🇸 SAN DIEGO',
    lat: 32.7157,
    lon: -117.1611,
    zoom: 12,
    sectorCode: 'CCTV-USW // SAN-DIEGO',
    networkId: 'CALTRANS_SD',
  },
  {
    id: 'austin_tx_dot',
    label: 'Austin Metro & ERCOT Core Sector (TX DOT)',
    shortTag: '🇺🇸 AUSTIN TX',
    lat: 30.2672,
    lon: -97.7431,
    zoom: 13,
    sectorCode: 'CCTV-USC // AUSTIN-ERCOT',
    networkId: 'AUSTIN_DOT',
  },
  {
    id: 'singapore_lta',
    label: 'Singapore Port & Strait of Malacca Causeway (LTA HD)',
    shortTag: '🇸🇬 SINGAPORE / MALACCA',
    lat: 1.3521,
    lon: 103.8198,
    zoom: 12,
    sectorCode: 'CCTV-APAC // MALACCA-HUB',
    networkId: 'SINGAPORE_LTA',
  },
  {
    id: 'helsinki_baltic',
    label: 'Helsinki & Gulf of Finland Baltic Corridor (Digitraffic)',
    shortTag: '🇫🇮 HELSINKI BALTIC',
    lat: 60.1699,
    lon: 24.9384,
    zoom: 11,
    sectorCode: 'CCTV-EU // BALTIC-NORTH',
    networkId: 'DIGITRAFFIC_FI',
  },
  {
    id: 'us_midwest_i80',
    label: 'US Transcontinental I-80 / I-35 Freight Corridor (Iowa DOT)',
    shortTag: '🇺🇸 I-80 CORRIDOR',
    lat: 41.5868,
    lon: -93.625,
    zoom: 11,
    sectorCode: 'CCTV-USM // I80-FREIGHT',
    networkId: 'IOWA_DOT',
  },
];

export interface LiveAirspaceTrack {
  icaoHex: string;
  callsign: string;
  aircraftType: string;
  registration: string;
  lat: number;
  lon: number;
  altBaroFt: number | 'GROUND' | null;
  groundSpeedKts: number | null;
  trackDeg: number;
  verticalRateFpm: number | null;
  squawk: string | null;
  classification: 'EMERGENCY' | 'MIL_GOV' | 'ROTORCRAFT' | 'CIVIL';
  distanceKm: number;
  bearingDeg: number;
  observedAt: string;
}

export interface LiveTargetEnvTelemetry {
  lat: number;
  lon: number;
  temperatureC: number | null;
  humidityPct: number | null;
  surfacePressureHpa: number | null;
  cloudCoverPct: number | null;
  visibilityKm: number | null;
  windSpeedKts: number | null;
  windDirectionDeg: number | null;
  windGustsKts: number | null;
  usAqi: number | null;
  pm25: number | null;
  no2: number | null;
  opticalPassStatus: 'OPTIMAL_CLEAR' | 'PARTIAL_HAZE' | 'CLOUD_OBSCURED';
  observedAt: string;
}

export interface GlobalHazardEvent {
  id: string;
  source: 'USGS_SEISMIC' | 'NASA_EONET';
  category: 'SEISMIC' | 'KINETIC_NON_TECTONIC' | 'WILDFIRE' | 'VOLCANO' | 'SEVERE_STORM' | 'SEA_ICE';
  title: string;
  lat: number;
  lon: number;
  magnitudeOrScale?: string;
  depthKm?: number;
  observedAt: string;
  sourceUrl: string;
}

export interface SpaceWeatherStatus {
  kpIndex: number;
  stormLevel: 'G0 NOMINAL' | 'G1 MINOR' | 'G2 MODERATE' | 'G3 STRONG' | 'G4 SEVERE' | 'G5 EXTREME';
  gnssAndHfImpact: string;
  observedAt: string;
}

export interface LiveCisaKevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  knownRansomwareCampaignUse: string;
}

export interface GlobalMacroReconTelemetry {
  hazards: GlobalHazardEvent[];
  seismicCount24h: number;
  eonetActiveCount: number;
  spaceWeather: SpaceWeatherStatus | null;
  cisaKevLatest: LiveCisaKevEntry[];
  fetchedAt: string;
}

// ============================================================================
// 1. EXACT GEODESIC & CONTINUOUS WEB MERCATOR PROJECTION MATH (Z:2..18)
// ============================================================================

export function clampWebMercatorZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 8;
  return Math.max(2, Math.min(18, Math.round(zoom)));
}

export function clampLatitude(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-85.0511, Math.min(85.0511, lat));
}

export function wrapLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  let wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (Object.is(wrapped, -0)) wrapped = 0;
  return wrapped;
}

export function latLonToContinuousWorldPx(
  lat: number,
  lon: number,
  zoom: number
): { wx: number; wy: number; worldSize: number } {
  const z = clampWebMercatorZoom(zoom);
  const clampedLat = clampLatitude(lat);
  const wrappedLon = wrapLongitude(lon);
  const latRad = (clampedLat * Math.PI) / 180;
  const worldSize = Math.pow(2, z) * 256;

  const wx = ((wrappedLon + 180) / 360) * worldSize;
  const wy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldSize;

  return { wx, wy, worldSize };
}

export function continuousWorldPxToLatLon(
  wx: number,
  wy: number,
  zoom: number
): { lat: number; lon: number } {
  const z = clampWebMercatorZoom(zoom);
  const worldSize = Math.pow(2, z) * 256;
  const clampedWy = Math.max(0, Math.min(worldSize, wy));
  const wrappedWx = ((wx % worldSize) + worldSize) % worldSize;

  const lon = wrapLongitude((wrappedWx / worldSize) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * clampedWy) / worldSize;
  const lat = clampLatitude((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));

  return { lat, lon };
}

/**
 * Converts a pointer drag delta (dxPx, dyPx) on screen into the new map center (lat, lon)
 * so the dragged map feature remains locked 1:1 beneath the pointer.
 */
export function panLatLonByCanvasPixels(
  startLat: number,
  startLon: number,
  zoom: number,
  dragDxPx: number,
  dragDyPx: number
): { lat: number; lon: number } {
  const { wx, wy } = latLonToContinuousWorldPx(startLat, startLon, zoom);
  return continuousWorldPxToLatLon(wx - dragDxPx, wy - dragDyPx, zoom);
}

/**
 * Inverse projection: converts any canvas pixel (px, py) on a viewport of size (canvasWidth, canvasHeight)
 * centered at (centerLat, centerLon, zoom) into exact geographic coordinates (lat, lon).
 */
export function canvasPixelToLatLon(
  px: number,
  py: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): { lat: number; lon: number } {
  const { wx: centerWx, wy: centerWy } = latLonToContinuousWorldPx(centerLat, centerLon, zoom);
  const offsetX = px - canvasWidth / 2;
  const offsetY = py - canvasHeight / 2;
  return continuousWorldPxToLatLon(centerWx + offsetX, centerWy + offsetY, zoom);
}

/**
 * Zooms to `nextZoom` while keeping the geographic coordinate beneath `(anchorPx, anchorPy)` stationary.
 */
export function zoomAroundCanvasPoint(
  centerLat: number,
  centerLon: number,
  currentZoom: number,
  nextZoom: number,
  anchorPx: number,
  anchorPy: number,
  canvasWidth: number,
  canvasHeight: number
): { lat: number; lon: number; zoom: number } {
  const clampedNext = clampWebMercatorZoom(nextZoom);
  if (clampedNext === clampWebMercatorZoom(currentZoom)) {
    return { lat: centerLat, lon: centerLon, zoom: clampedNext };
  }
  const anchorGeo = canvasPixelToLatLon(
    anchorPx,
    anchorPy,
    centerLat,
    centerLon,
    currentZoom,
    canvasWidth,
    canvasHeight
  );
  const anchorNextWorld = latLonToContinuousWorldPx(anchorGeo.lat, anchorGeo.lon, clampedNext);
  const dxFromCenter = anchorPx - canvasWidth / 2;
  const dyFromCenter = anchorPy - canvasHeight / 2;
  const nextCenter = continuousWorldPxToLatLon(
    anchorNextWorld.wx - dxFromCenter,
    anchorNextWorld.wy - dyFromCenter,
    clampedNext
  );
  return { lat: nextCenter.lat, lon: nextCenter.lon, zoom: clampedNext };
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function calculateBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return Math.round(brng);
}

// ============================================================================
// 2. RESILIENT DIRECT + EDGE PROXY JSON FETCHER
// ============================================================================

async function fetchLiveJson<T = any>(url: string, timeoutMs = 6500): Promise<T | null> {
  // 1. Attempt direct HTTPS fetch (supported by CORS-enabled public DOT, USGS, NASA, NOAA, Open-Meteo, adsb.lol)
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, application/geo+json, */*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
  } catch {
    // Fall back to hardened /api/fetch proxy when running in browser with CORS restrictions
  }

  // 2. Fallback to Cloudflare Pages /api/fetch proxy if running in browser context
  if (typeof window !== 'undefined' && window.location?.origin && /^https?:/i.test(window.location.origin)) {
    try {
      const proxyUrl = `${window.location.origin}/api/fetch?url=${encodeURIComponent(url)}`;
      const proxyRes = await fetch(proxyUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs + 1500),
      });
      if (proxyRes.ok) {
        const wrapper: any = await proxyRes.json();
        if (wrapper && wrapper.data !== undefined) {
          return wrapper.data as T;
        }
        if (wrapper && typeof wrapper.text === 'string') {
          return JSON.parse(wrapper.text) as T;
        }
        return wrapper as T;
      }
    } catch {
      return null;
    }
  }

  return null;
}

// ============================================================================
// 3. CUSTOM OPERATOR CCTV REGISTRY & LIVE PUBLIC DOT CAMERA FEEDS
// ============================================================================

const CUSTOM_CCTV_STORAGE_KEY = 'pixelops_custom_cctv_feeds_v1';

export function getCustomCctvCameras(): LiveCctvCamera[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_CCTV_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c: any) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        typeof c.imageUrl === 'string' &&
        Number.isFinite(Number(c.lat)) &&
        Number.isFinite(Number(c.lon))
    );
  } catch {
    return [];
  }
}

export function addCustomCctvCamera(params: {
  name: string;
  lat: number;
  lon: number;
  streamUrl: string;
}): LiveCctvCamera[] {
  const cleanUrl = params.streamUrl.trim();
  const lower = cleanUrl.toLowerCase();
  const streamType: LiveCctvCamera['streamType'] = lower.includes('.m3u8')
    ? 'HLS_M3U8'
    : lower.includes('.mp4') || lower.includes('.webm')
    ? 'MP4_CLIP'
    : lower.includes('mjpg') || lower.includes('mjpeg')
    ? 'MJPEG'
    : 'JPEG_REFRESH';

  const cam: LiveCctvCamera = {
    id: `custom-cctv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: params.name.trim() || `Operator Cam (${params.lat.toFixed(3)}, ${params.lon.toFixed(3)})`,
    networkId: 'OPERATOR_CUSTOM',
    networkLabel: 'OPERATOR CUSTOM STREAM',
    regionLabel: 'Custom Tactical Node',
    lat: clampLatitude(params.lat),
    lon: wrapLongitude(params.lon),
    imageUrl: cleanUrl,
    videoUrl: streamType === 'MP4_CLIP' || streamType === 'HLS_M3U8' ? cleanUrl : undefined,
    streamType,
    updatedAt: new Date().toISOString(),
    supportsQueryCacheBust: streamType === 'JPEG_REFRESH' && !cleanUrl.includes('Signature='),
  };

  const next = [cam, ...getCustomCctvCameras()].slice(0, 50);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_CCTV_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {}
  return next;
}

export function removeCustomCctvCamera(id: string): LiveCctvCamera[] {
  const next = getCustomCctvCameras().filter((c) => c.id !== id);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_CCTV_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {}
  return next;
}

export function buildFreshCameraImageUrl(cam: LiveCctvCamera, refreshTick: number): string {
  if (!cam.supportsQueryCacheBust || refreshTick <= 0) {
    return cam.imageUrl;
  }
  const sep = cam.imageUrl.includes('?') ? '&' : '?';
  return `${cam.imageUrl}${sep}_cb=${refreshTick}`;
}

interface CachedCctvCatalog {
  fetchedAtMs: number;
  cameras: LiveCctvCamera[];
}

const CCTV_CATALOG_CACHE = new Map<LiveCctvCamera['networkId'], CachedCctvCatalog>();
const CCTV_CATALOG_TTL_MS = 4 * 60 * 1000; // 4 minutes (Singapore LTA refreshed faster at 90s)

async function loadTflLondonCameras(): Promise<LiveCctvCamera[]> {
  const data = await fetchLiveJson<any[]>('https://api.tfl.gov.uk/Place/Type/JamCam', 6500);
  if (!Array.isArray(data)) return [];
  const nowIso = new Date().toISOString();
  const out: LiveCctvCamera[] = [];
  for (const item of data) {
    if (!Number.isFinite(item?.lat) || !Number.isFinite(item?.lon)) continue;
    const props: any[] = Array.isArray(item.additionalProperties) ? item.additionalProperties : [];
    const propMap = new Map<string, string>();
    for (const p of props) {
      if (p?.key && typeof p?.value === 'string') propMap.set(p.key, p.value);
    }
    if (propMap.get('available') === 'false') continue;
    const imageUrl = propMap.get('imageUrl') || '';
    if (!imageUrl.startsWith('https://')) continue;
    const videoUrl = propMap.get('videoUrl');
    out.push({
      id: `tfl-${item.id}`,
      name: item.commonName || item.id,
      networkId: 'TFL_LONDON',
      networkLabel: 'TfL JamCam',
      regionLabel: 'London, UK',
      lat: Number(item.lat),
      lon: Number(item.lon),
      imageUrl,
      videoUrl: videoUrl?.startsWith('https://') ? videoUrl : undefined,
      streamType: videoUrl?.startsWith('https://') ? 'MP4_CLIP' : 'JPEG_REFRESH',
      direction: propMap.get('view') || undefined,
      updatedAt: nowIso,
      supportsQueryCacheBust: true,
    });
  }
  return out;
}

async function loadCaltransDistrictCameras(
  districtCode: 'd7' | 'd11',
  networkId: 'CALTRANS_LA' | 'CALTRANS_SD',
  regionLabel: string
): Promise<LiveCctvCamera[]> {
  const fileCode = districtCode === 'd7' ? 'D07' : 'D11';
  const url = `https://cwwp2.dot.ca.gov/data/${districtCode}/cctv/cctvStatus${fileCode}.json`;
  const json = await fetchLiveJson<any>(url, 12000);
  const rows: any[] = Array.isArray(json?.data) ? json.data : [];
  const nowIso = new Date().toISOString();
  const out: LiveCctvCamera[] = [];
  for (const entry of rows) {
    const c = entry?.cctv;
    if (!c || c.inService !== 'true') continue;
    const lat = Number(c.location?.latitude);
    const lon = Number(c.location?.longitude);
    const imageUrl = String(c.imageData?.static?.currentImageURL || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !imageUrl.startsWith('https://')) continue;
    const hlsUrl = String(c.imageData?.streamingVideoURL || '').trim();
    out.push({
      id: `caltrans-${districtCode}-${c.index || `${lat}_${lon}`}`,
      name: c.location?.locationName || c.location?.nearbyPlace || `Caltrans ${fileCode}`,
      networkId,
      networkLabel: `Caltrans ${fileCode}`,
      regionLabel,
      lat,
      lon,
      imageUrl,
      videoUrl: hlsUrl.startsWith('https://') ? hlsUrl : undefined,
      streamType: 'JPEG_REFRESH',
      direction: c.location?.direction || undefined,
      updatedAt: nowIso,
      supportsQueryCacheBust: true,
    });
  }
  return out;
}

async function loadAustinDotCameras(): Promise<LiveCctvCamera[]> {
  const url =
    "https://data.austintexas.gov/resource/b4k4-adkb.json?$where=camera_status='TURNED_ON'&$limit=180";
  const rows = await fetchLiveJson<any[]>(url, 5500);
  if (!Array.isArray(rows)) return [];
  const nowIso = new Date().toISOString();
  const out: LiveCctvCamera[] = [];
  for (const r of rows) {
    const coords = r?.location?.coordinates;
    const lon = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    const imageUrl = String(r?.screenshot_address || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !imageUrl.startsWith('https://')) continue;
    out.push({
      id: `austin-${r.camera_id || r.id}`,
      name: String(r.location_name || r.primary_st || `Austin Cam ${r.camera_id}`).trim(),
      networkId: 'AUSTIN_DOT',
      networkLabel: 'Austin TX DOT',
      regionLabel: 'Austin, TX (US)',
      lat,
      lon,
      imageUrl,
      streamType: 'JPEG_REFRESH',
      updatedAt: r.modified_date || nowIso,
      supportsQueryCacheBust: true,
    });
  }
  return out;
}

async function loadIowaDotCameras(): Promise<LiveCctvCamera[]> {
  const url =
    'https://services.arcgis.com/8lRhdTsQyJpO52F1/arcgis/rest/services/Traffic_Cameras_View/FeatureServer/0/query?where=1%3D1&outFields=device_id,Desc_,Route,ImageURL,VideoURL,latitude,longitude&outSR=4326&resultRecordCount=150&f=json';
  const json = await fetchLiveJson<any>(url, 5500);
  const features: any[] = Array.isArray(json?.features) ? json.features : [];
  const nowIso = new Date().toISOString();
  const out: LiveCctvCamera[] = [];
  for (const f of features) {
    const a = f?.attributes || {};
    const lat = Number(a.latitude ?? f?.geometry?.y);
    const lon = Number(a.longitude ?? f?.geometry?.x);
    const imageUrl = String(a.ImageURL || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !imageUrl.startsWith('https://')) continue;
    const videoUrl = String(a.VideoURL || '').trim();
    out.push({
      id: `iowadot-${a.device_id || `${lat}_${lon}`}`,
      name: String(a.Desc_ || a.Route || 'I-80 Corridor Cam').trim(),
      networkId: 'IOWA_DOT',
      networkLabel: 'US I-80 DOT',
      regionLabel: 'US Midwest I-80/I-35',
      lat,
      lon,
      imageUrl,
      videoUrl: videoUrl.startsWith('https://') ? videoUrl : undefined,
      streamType: 'JPEG_REFRESH',
      updatedAt: nowIso,
      supportsQueryCacheBust: true,
    });
  }
  return out;
}

async function loadSingaporeLtaCameras(): Promise<LiveCctvCamera[]> {
  const json = await fetchLiveJson<any>('https://api.data.gov.sg/v1/transport/traffic-images', 5500);
  const cameras: any[] = Array.isArray(json?.items?.[0]?.cameras) ? json.items[0].cameras : [];
  const out: LiveCctvCamera[] = [];
  for (const c of cameras) {
    const lat = Number(c?.location?.latitude);
    const lon = Number(c?.location?.longitude);
    const imageUrl = String(c?.image || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !imageUrl.startsWith('https://')) continue;
    out.push({
      id: `sg-lta-${c.camera_id}`,
      name: `Singapore LTA Sector Cam #${c.camera_id} (Malacca / Port)`,
      networkId: 'SINGAPORE_LTA',
      networkLabel: 'Singapore LTA HD',
      regionLabel: 'Singapore / Strait of Malacca',
      lat,
      lon,
      imageUrl,
      streamType: 'JPEG_REFRESH',
      updatedAt: c.timestamp || new Date().toISOString(),
      // data.gov.sg issues fresh timestamped image paths per API poll
      supportsQueryCacheBust: false,
    });
  }
  return out;
}

async function loadDigitrafficFinlandCameras(): Promise<LiveCctvCamera[]> {
  const json = await fetchLiveJson<any>('https://tie.digitraffic.fi/api/weathercam/v1/stations', 6000);
  const features: any[] = Array.isArray(json?.features) ? json.features : [];
  const out: LiveCctvCamera[] = [];
  for (const f of features.slice(0, 280)) {
    const coords = f?.geometry?.coordinates;
    const lon = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    const preset = Array.isArray(f?.properties?.presets)
      ? f.properties.presets.find((p: any) => p?.inCollection && p?.id) || f.properties.presets[0]
      : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !preset?.id) continue;
    out.push({
      id: `fi-road-${f.id || preset.id}`,
      name: String(f.properties?.name || preset.id).replace(/_/g, ' '),
      networkId: 'DIGITRAFFIC_FI',
      networkLabel: 'Digitraffic EU',
      regionLabel: 'Finland / Baltic Corridor',
      lat,
      lon,
      imageUrl: `https://weathercam.digitraffic.fi/${preset.id}.jpg`,
      streamType: 'JPEG_REFRESH',
      updatedAt: f.properties?.dataUpdatedTime || new Date().toISOString(),
      supportsQueryCacheBust: true,
    });
  }
  return out;
}

async function getNetworkCatalog(
  networkId: Exclude<LiveCctvCamera['networkId'], 'OPERATOR_CUSTOM'>,
  forceRefresh = false
): Promise<LiveCctvCamera[]> {
  const now = Date.now();
  const ttl = networkId === 'SINGAPORE_LTA' ? 90_000 : CCTV_CATALOG_TTL_MS;
  const cached = CCTV_CATALOG_CACHE.get(networkId);
  if (!forceRefresh && cached && now - cached.fetchedAtMs < ttl && cached.cameras.length > 0) {
    return cached.cameras;
  }

  let cameras: LiveCctvCamera[] = [];
  switch (networkId) {
    case 'TFL_LONDON':
      cameras = await loadTflLondonCameras();
      break;
    case 'CALTRANS_LA':
      cameras = await loadCaltransDistrictCameras('d7', 'CALTRANS_LA', 'Los Angeles / Port LB');
      break;
    case 'CALTRANS_SD':
      cameras = await loadCaltransDistrictCameras('d11', 'CALTRANS_SD', 'San Diego / Border');
      break;
    case 'AUSTIN_DOT':
      cameras = await loadAustinDotCameras();
      break;
    case 'IOWA_DOT':
      cameras = await loadIowaDotCameras();
      break;
    case 'SINGAPORE_LTA':
      cameras = await loadSingaporeLtaCameras();
      break;
    case 'DIGITRAFFIC_FI':
      cameras = await loadDigitrafficFinlandCameras();
      break;
  }

  if (cameras.length > 0) {
    CCTV_CATALOG_CACHE.set(networkId, { fetchedAtMs: now, cameras });
  }
  return cameras;
}

/**
 * Selects which live public CCTV networks to query based on target coordinates,
 * while always ensuring fast global baseline coverage so global multi-cam matrix is populated.
 */
function selectNetworksForCoordinates(
  lat: number,
  lon: number
): Array<Exclude<LiveCctvCamera['networkId'], 'OPERATOR_CUSTOM'>> {
  const selected = new Set<Exclude<LiveCctvCamera['networkId'], 'OPERATOR_CUSTOM'>>([
    'TFL_LONDON',
    'SINGAPORE_LTA',
    'AUSTIN_DOT',
  ]);

  // Europe / UK / Mediterranean
  if (lat >= 34 && lat <= 72 && lon >= -15 && lon <= 45) {
    selected.add('TFL_LONDON');
    selected.add('DIGITRAFFIC_FI');
  }
  // North America
  if (lat >= 18 && lat <= 60 && lon >= -135 && lon <= -55) {
    selected.add('AUSTIN_DOT');
    selected.add('IOWA_DOT');
    // US West Coast — target specific Caltrans district so D7 & D11 don't compete on bandwidth
    if (lon <= -114) {
      if (lat >= 33.35) {
        selected.add('CALTRANS_LA');
      }
      if (lat <= 33.55) {
        selected.add('CALTRANS_SD');
      }
    }
  }
  // Indo-Pacific
  if (lon >= 70 && lon <= 155) {
    selected.add('SINGAPORE_LTA');
  }

  return Array.from(selected);
}

export interface LiveCctvSweepResult {
  inSectorCameras: LiveCctvCamera[];
  nearestGlobalCameras: LiveCctvCamera[];
  globalHubShowcase: LiveCctvCamera[];
  totalCatalogCount: number;
  activeNetworks: string[];
}

export async function fetchLiveCctvForSector(
  lat: number,
  lon: number,
  radiusKm = 120,
  forceRefresh = false
): Promise<LiveCctvSweepResult> {
  const networks = selectNetworksForCoordinates(lat, lon);
  const catalogs = await Promise.all(networks.map((net) => getNetworkCatalog(net, forceRefresh)));
  const customCameras = getCustomCctvCameras();

  const allCameras: LiveCctvCamera[] = [...customCameras, ...catalogs.flat()].map((cam) => ({
    ...cam,
    distanceKm: Number(haversineDistanceKm(lat, lon, cam.lat, cam.lon).toFixed(1)),
    bearingDeg: calculateBearingDeg(lat, lon, cam.lat, cam.lon),
  }));

  allCameras.sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));

  const inSectorCameras = allCameras.filter((c) => (c.distanceKm ?? 99999) <= radiusKm).slice(0, 80);
  const nearestGlobalCameras = allCameras.slice(0, 12);

  // Pick 2 live cameras per active network so the Global Multi-Cam Matrix shows diverse worldwide feeds
  const globalHubShowcase: LiveCctvCamera[] = [];
  const seenPerNet = new Map<string, number>();
  for (const cam of [...customCameras, ...catalogs.flat()]) {
    const count = seenPerNet.get(cam.networkId) || 0;
    if (count < 2) {
      globalHubShowcase.push({
        ...cam,
        distanceKm: Number(haversineDistanceKm(lat, lon, cam.lat, cam.lon).toFixed(1)),
        bearingDeg: calculateBearingDeg(lat, lon, cam.lat, cam.lon),
      });
      seenPerNet.set(cam.networkId, count + 1);
    }
    if (globalHubShowcase.length >= 12) break;
  }

  const activeNetworks = Array.from(
    new Set(allCameras.map((c) => c.networkLabel))
  );

  return {
    inSectorCameras,
    nearestGlobalCameras,
    globalHubShowcase,
    totalCatalogCount: allCameras.length,
    activeNetworks,
  };
}

// ============================================================================
// 4. LIVE VIEWPORT ADS-B AIRSPACE RADAR (adsb.lol)
// ============================================================================

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
const ROTORCRAFT_PREFIXES = ['H60', 'UH1', 'EC35', 'EC45', 'AS50', 'A139', 'B407', 'B429', 'R44', 'S76', 'CH47'];

export async function fetchViewportLiveAirspace(
  lat: number,
  lon: number,
  radiusKm = 160
): Promise<{
  tracks: LiveAirspaceTrack[];
  totalCount: number;
  tacticalCount: number;
  observedAt: string;
}> {
  const radiusNm = Math.max(15, Math.min(180, Math.round(radiusKm * 0.539957)));
  const primaryUrl = `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;
  const failoverUrl = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;

  let json = await fetchLiveJson<any>(primaryUrl, 5500);
  if (!Array.isArray(json?.ac)) {
    json = await fetchLiveJson<any>(failoverUrl, 6000);
  }

  let rawAc: any[] = Array.isArray(json?.ac) ? json.ac : [];
  if (rawAc.length === 0 && !json) {
    // Secondary allowlisted OpenSky Network bounding-box failover
    const latDegDelta = Math.min(8, Math.max(0.25, radiusKm / 111));
    const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const lonDegDelta = Math.min(12, Math.max(0.25, radiusKm / (111 * cosLat)));
    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${(lat - latDegDelta).toFixed(4)}&lomin=${(lon - lonDegDelta).toFixed(4)}&lamax=${(lat + latDegDelta).toFixed(4)}&lomax=${(lon + lonDegDelta).toFixed(4)}`;
    const osJson = await fetchLiveJson<any>(openSkyUrl, 6500);
    if (Array.isArray(osJson?.states)) {
      rawAc = osJson.states
        .filter((s: any) => Array.isArray(s) && Number.isFinite(s[5]) && Number.isFinite(s[6]))
        .map((s: any) => ({
          hex: String(s[0] || '').trim(),
          flight: String(s[1] || '').trim(),
          lon: Number(s[5]),
          lat: Number(s[6]),
          alt_baro: s[8] === true ? 'ground' : Number.isFinite(s[7]) ? Math.round(Number(s[7]) * 3.28084) : null,
          gs: Number.isFinite(s[9]) ? Math.round(Number(s[9]) * 1.94384) : null,
          track: Number.isFinite(s[10]) ? Number(s[10]) : 0,
          baro_rate: Number.isFinite(s[11]) ? Math.round(Number(s[11]) * 196.85) : null,
          squawk: s[14] ? String(s[14]).trim() : null,
          category: s[17] === 8 ? 'A7' : undefined,
        }));
    }
  }
  const nowIso = new Date().toISOString();

  const tracks: LiveAirspaceTrack[] = [];
  let tacticalCount = 0;

  for (const ac of rawAc) {
    const acLat = Number(ac?.lat);
    const acLon = Number(ac?.lon);
    if (!Number.isFinite(acLat) || !Number.isFinite(acLon)) continue;

    const hex = String(ac.hex || '').toUpperCase().trim();
    const callsign = String(ac.flight || ac.r || hex || 'UNKN').trim();
    const acType = String(ac.t || '').toUpperCase().trim();
    const squawk = ac.squawk ? String(ac.squawk).trim() : null;
    const isEmergency = Boolean(squawk && EMERGENCY_SQUAWKS.has(squawk));
    const isMilGov = Boolean((Number(ac.dbFlags) & 1) === 1) || /^(RCH|CNV|NATO|RRR|ASCOT|FORTE|LAGR|HOMER|DUKE|PAT|GUARD|POLICE|MEDEVAC)/i.test(callsign);
    const isRotorcraft =
      String(ac.category || '').toUpperCase() === 'A7' ||
      ROTORCRAFT_PREFIXES.some((p) => acType.startsWith(p));

    const classification: LiveAirspaceTrack['classification'] = isEmergency
      ? 'EMERGENCY'
      : isMilGov
      ? 'MIL_GOV'
      : isRotorcraft
      ? 'ROTORCRAFT'
      : 'CIVIL';

    if (classification !== 'CIVIL') {
      tacticalCount++;
    }

    const altBaro: number | 'GROUND' | null =
      ac.alt_baro === 'ground'
        ? 'GROUND'
        : Number.isFinite(Number(ac.alt_baro))
        ? Math.round(Number(ac.alt_baro))
        : null;

    tracks.push({
      icaoHex: hex || `AC-${tracks.length}`,
      callsign,
      aircraftType: acType || 'ADSB',
      registration: String(ac.r || '').trim(),
      lat: acLat,
      lon: acLon,
      altBaroFt: altBaro,
      groundSpeedKts: Number.isFinite(Number(ac.gs)) ? Math.round(Number(ac.gs)) : null,
      trackDeg: Number.isFinite(Number(ac.track))
        ? Number(ac.track)
        : Number.isFinite(Number(ac.true_heading))
        ? Number(ac.true_heading)
        : 0,
      verticalRateFpm: Number.isFinite(Number(ac.baro_rate)) ? Math.round(Number(ac.baro_rate)) : null,
      squawk,
      classification,
      distanceKm: Number(haversineDistanceKm(lat, lon, acLat, acLon).toFixed(1)),
      bearingDeg: calculateBearingDeg(lat, lon, acLat, acLon),
      observedAt: nowIso,
    });
  }

  // Prioritize emergency & mil/gov/rotorcraft first, then closest to target center
  tracks.sort((a, b) => {
    const prio = (c: LiveAirspaceTrack['classification']) =>
      c === 'EMERGENCY' ? 0 : c === 'MIL_GOV' ? 1 : c === 'ROTORCRAFT' ? 2 : 3;
    const diff = prio(a.classification) - prio(b.classification);
    if (diff !== 0) return diff;
    return a.distanceKm - b.distanceKm;
  });

  return {
    tracks: tracks.slice(0, 140),
    totalCount: rawAc.length,
    tacticalCount,
    observedAt: nowIso,
  };
}

// ============================================================================
// 5. LIVE TARGET ENVIRONMENTAL, WIND VECTOR & OPTICAL CLOUD COVER RECON
// ============================================================================

export async function fetchLocalTargetEnvironment(
  lat: number,
  lon: number
): Promise<LiveTargetEnvTelemetry | null> {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,surface_pressure,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=us_aqi,pm2_5,nitrogen_dioxide`;

  const [weatherJson, aqiJson] = await Promise.all([
    fetchLiveJson<any>(weatherUrl, 5000),
    fetchLiveJson<any>(aqiUrl, 5000),
  ]);

  const wc = weatherJson?.current;
  const ac = aqiJson?.current;
  if (!wc && !ac) return null;

  const cloudCover = Number.isFinite(Number(wc?.cloud_cover)) ? Math.round(Number(wc.cloud_cover)) : null;
  const visibilityKm = Number.isFinite(Number(wc?.visibility))
    ? Number((Number(wc.visibility) / 1000).toFixed(1))
    : null;

  const opticalPassStatus: LiveTargetEnvTelemetry['opticalPassStatus'] =
    cloudCover !== null && cloudCover > 70
      ? 'CLOUD_OBSCURED'
      : (cloudCover !== null && cloudCover > 30) || (visibilityKm !== null && visibilityKm < 6)
      ? 'PARTIAL_HAZE'
      : 'OPTIMAL_CLEAR';

  return {
    lat,
    lon,
    temperatureC: Number.isFinite(Number(wc?.temperature_2m)) ? Number(wc.temperature_2m) : null,
    humidityPct: Number.isFinite(Number(wc?.relative_humidity_2m))
      ? Math.round(Number(wc.relative_humidity_2m))
      : null,
    surfacePressureHpa: Number.isFinite(Number(wc?.surface_pressure))
      ? Math.round(Number(wc.surface_pressure))
      : null,
    cloudCoverPct: cloudCover,
    visibilityKm,
    windSpeedKts: Number.isFinite(Number(wc?.wind_speed_10m))
      ? Math.round(Number(wc.wind_speed_10m))
      : null,
    windDirectionDeg: Number.isFinite(Number(wc?.wind_direction_10m))
      ? Math.round(Number(wc.wind_direction_10m))
      : null,
    windGustsKts: Number.isFinite(Number(wc?.wind_gusts_10m))
      ? Math.round(Number(wc.wind_gusts_10m))
      : null,
    usAqi: Number.isFinite(Number(ac?.us_aqi)) ? Math.round(Number(ac.us_aqi)) : null,
    pm25: Number.isFinite(Number(ac?.pm2_5)) ? Number(Number(ac.pm2_5).toFixed(1)) : null,
    no2: Number.isFinite(Number(ac?.nitrogen_dioxide))
      ? Number(Number(ac.nitrogen_dioxide).toFixed(1))
      : null,
    opticalPassStatus,
    observedAt: wc?.time || ac?.time || new Date().toISOString(),
  };
}

// ============================================================================
// 6. GLOBAL MACRO OVERLAYS (USGS WORLDWIDE + NASA EONET + NOAA SWPC + CISA KEV)
// ============================================================================

let cachedGlobalMacro: { fetchedAtMs: number; payload: GlobalMacroReconTelemetry } | null = null;
const GLOBAL_MACRO_TTL_MS = 90_000;

export async function fetchGlobalMacroReconTelemetry(
  forceRefresh = false
): Promise<GlobalMacroReconTelemetry> {
  const now = Date.now();
  if (!forceRefresh && cachedGlobalMacro && now - cachedGlobalMacro.fetchedAtMs < GLOBAL_MACRO_TTL_MS) {
    return cachedGlobalMacro.payload;
  }

  const [usgsJson, eonetJson, noaaJson, cisaJson] = await Promise.all([
    fetchLiveJson<any>(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
      6500
    ),
    fetchLiveJson<any>('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40', 6500),
    fetchLiveJson<any>(
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      5500
    ),
    fetchLiveJson<any>(
      'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      7500
    ),
  ]);

  const hazards: GlobalHazardEvent[] = [];

  // 1. USGS Global M2.5+ Seismic & Kinetic Events
  const usgsFeatures: any[] = Array.isArray(usgsJson?.features) ? usgsJson.features : [];
  for (const f of usgsFeatures.slice(0, 65)) {
    const coords = f?.geometry?.coordinates;
    const lon = Number(coords?.[0]);
    const lat = Number(coords?.[1]);
    const depthKm = Number(coords?.[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const mag = Number(f?.properties?.mag);
    const rawType = String(f?.properties?.type || 'earthquake').toLowerCase();
    const isNonTectonic = rawType !== 'earthquake';
    hazards.push({
      id: `usgs-${f.id}`,
      source: 'USGS_SEISMIC',
      category: isNonTectonic ? 'KINETIC_NON_TECTONIC' : 'SEISMIC',
      title: String(f?.properties?.title || `M${mag.toFixed(1)} ${f?.properties?.place || ''}`).trim(),
      lat,
      lon,
      magnitudeOrScale: Number.isFinite(mag) ? `M${mag.toFixed(1)}` : undefined,
      depthKm: Number.isFinite(depthKm) ? Number(depthKm.toFixed(1)) : undefined,
      observedAt: f?.properties?.time
        ? new Date(Number(f.properties.time)).toISOString()
        : new Date().toISOString(),
      sourceUrl: String(f?.properties?.url || 'https://earthquake.usgs.gov/'),
    });
  }

  // 2. NASA EONET Global Active Wildfires, Volcanoes, Severe Storms & Ice
  const eonetEvents: any[] = Array.isArray(eonetJson?.events) ? eonetJson.events : [];
  for (const ev of eonetEvents) {
    const geoms: any[] = Array.isArray(ev?.geometry) ? ev.geometry : [];
    const latestGeom = geoms[geoms.length - 1];
    if (!latestGeom) continue;
    let lon = NaN;
    let lat = NaN;
    if (latestGeom.type === 'Point' && Array.isArray(latestGeom.coordinates)) {
      lon = Number(latestGeom.coordinates[0]);
      lat = Number(latestGeom.coordinates[1]);
    } else if (
      latestGeom.type === 'Polygon' &&
      Array.isArray(latestGeom.coordinates?.[0]?.[0])
    ) {
      lon = Number(latestGeom.coordinates[0][0][0]);
      lat = Number(latestGeom.coordinates[0][0][1]);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const catId = String(ev?.categories?.[0]?.id || '').toLowerCase();
    const category: GlobalHazardEvent['category'] = catId.includes('volcano')
      ? 'VOLCANO'
      : catId.includes('wildfire')
      ? 'WILDFIRE'
      : catId.includes('ice')
      ? 'SEA_ICE'
      : 'SEVERE_STORM';

    hazards.push({
      id: `eonet-${ev.id}`,
      source: 'NASA_EONET',
      category,
      title: String(ev.title || 'NASA EONET Active Event').trim(),
      lat,
      lon,
      magnitudeOrScale: latestGeom.magnitudeValue
        ? `${latestGeom.magnitudeValue} ${latestGeom.magnitudeUnit || ''}`.trim()
        : category,
      observedAt: latestGeom.date || new Date().toISOString(),
      sourceUrl: String(ev?.sources?.[0]?.url || ev?.link || 'https://eonet.gsfc.nasa.gov/'),
    });
  }

  // 3. NOAA SWPC Planetary Kp Index (handles both 2026 object format and legacy tuple format)
  let spaceWeather: SpaceWeatherStatus | null = null;
  if (Array.isArray(noaaJson) && noaaJson.length > 0) {
    const lastEntry = noaaJson[noaaJson.length - 1];
    const kpRaw = Array.isArray(lastEntry) ? Number(lastEntry[1]) : Number(lastEntry?.Kp ?? lastEntry?.kp_index);
    const timeTag = Array.isArray(lastEntry)
      ? String(lastEntry[0] || '')
      : String(lastEntry?.time_tag || '');
    if (Number.isFinite(kpRaw)) {
      const stormLevel: SpaceWeatherStatus['stormLevel'] =
        kpRaw >= 9
          ? 'G5 EXTREME'
          : kpRaw >= 8
          ? 'G4 SEVERE'
          : kpRaw >= 7
          ? 'G3 STRONG'
          : kpRaw >= 6
          ? 'G2 MODERATE'
          : kpRaw >= 5
          ? 'G1 MINOR'
          : 'G0 NOMINAL';
      const gnssAndHfImpact =
        kpRaw >= 5
          ? `Geomagnetic Storm (${stormLevel}, Kp=${kpRaw.toFixed(1)}) — Elevated polar/mid-lat GNSS scintillation & HF comms fade.`
          : kpRaw >= 4
          ? `Unsettled Magnetosphere (Kp=${kpRaw.toFixed(1)}) — Minor high-latitude HF propagation jitter.`
          : `Nominal Ionosphere (Kp=${kpRaw.toFixed(2)}) — Optimal satellite downlink, GNSS L1/L5 lock & HF skywave.`;
      spaceWeather = {
        kpIndex: Number(kpRaw.toFixed(2)),
        stormLevel,
        gnssAndHfImpact,
        observedAt: timeTag || new Date().toISOString(),
      };
    }
  }

  // 4. CISA KEV Catalog (sorted newest first)
  const rawVulns: any[] = Array.isArray(cisaJson?.vulnerabilities) ? cisaJson.vulnerabilities : [];
  const cisaKevLatest: LiveCisaKevEntry[] = rawVulns
    .slice()
    .sort((a, b) => String(b?.dateAdded || '').localeCompare(String(a?.dateAdded || '')))
    .slice(0, 6)
    .map((v) => ({
      cveID: String(v.cveID || ''),
      vendorProject: String(v.vendorProject || ''),
      product: String(v.product || ''),
      vulnerabilityName: String(v.vulnerabilityName || ''),
      dateAdded: String(v.dateAdded || ''),
      shortDescription: String(v.shortDescription || ''),
      requiredAction: String(v.requiredAction || ''),
      knownRansomwareCampaignUse: String(v.knownRansomwareCampaignUse || 'Unknown'),
    }))
    .filter((v) => Boolean(v.cveID));

  const payload: GlobalMacroReconTelemetry = {
    hazards,
    seismicCount24h: usgsFeatures.length,
    eonetActiveCount: eonetEvents.length,
    spaceWeather,
    cisaKevLatest,
    fetchedAt: new Date().toISOString(),
  };

  cachedGlobalMacro = { fetchedAtMs: now, payload };
  return payload;
}
