/**
 * Cloudflare Pages Function: /api/osint/premedia-sweep
 *
 * Server-side CORS-free collector for live pre-media telemetry bounded to [lat, lon, radiusKm]:
 * - NWS CAP Active Warning Polygons
 * - ADS-B Overhead Transponder State Vectors (api.adsb.lol)
 * - Open-Meteo Real-Time Atmospheric Smoke/Chemical Plume Sensors
 * - USGS All-Hour Micro-Seismic & Non-Tectonic Blast GeoJSON
 */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const onRequestGet = async (context: { request: Request }) => {
  const url = new URL(context.request.url);
  const lat = Number(url.searchParams.get('lat') ?? 38.9072);
  const lon = Number(url.searchParams.get('lon') ?? -77.0369);
  const radiusKm = Math.max(2, Math.min(250, Number(url.searchParams.get('radiusKm') ?? 35)));
  const radiusNm = Math.max(2, Math.min(135, Math.round(radiusKm * 0.539957)));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return new Response(JSON.stringify({ error: 'INVALID_COORDINATES' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const nwsEndpoint = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const adsbEndpoint = `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;
  const plumeEndpoint =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,dust,us_aqi`;
  const usgsEndpoint = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';

  const [nwsRes, adsbRes, plumeRes, usgsRes] = await Promise.allSettled([
    fetch(nwsEndpoint, {
      headers: { Accept: 'application/geo+json', 'User-Agent': 'PixelOps-Tactical-Edge/1.0' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(adsbEndpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(plumeEndpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
    fetch(usgsEndpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    }).then((r) => (r.ok ? r.json() : null)),
  ]);

  return new Response(
    JSON.stringify({
      status: 'ok',
      capturedAt: new Date().toISOString(),
      geofence: { lat, lon, radiusKm },
      nwsAlerts: nwsRes.status === 'fulfilled' ? nwsRes.value : null,
      adsb: adsbRes.status === 'fulfilled' ? adsbRes.value : null,
      plume: plumeRes.status === 'fulfilled' ? plumeRes.value : null,
      usgsHour: usgsRes.status === 'fulfilled' ? usgsRes.value : null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    }
  );
};
