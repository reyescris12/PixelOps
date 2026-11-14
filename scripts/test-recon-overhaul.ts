/**
 * End-to-End Verification Suite: High-Grade Intel Recon Monitor & Threat Matrix Overhaul
 *
 * Verifies:
 * 1. Continuous Sub-Pixel Web Mercator Math (Z:2..18 round-trip precision, pan, cursor-anchored zoom invariance)
 * 2. Slippy Tile Grid & Hybrid Reference Layer URL generation up to street-level Z:18
 * 3. Live Public Geotagged CCTV Feeds (TfL London JamCams, Singapore LTA HD, Global Hubs, Custom CCTV registry)
 * 4. Live Local Multi-INT Overlays (adsb.lol Airspace Radar + Open-Meteo Wind/Cloud/AQI)
 * 5. Live Global Macro Overlays (USGS M2.5+ Seismic, NASA EONET Hazards, NOAA SWPC Kp, CISA KEV CVEs)
 * 6. Edge Security & Allowlist (`/api/fetch` + `/api/osint/threat-matrix`)
 * 7. Codebase Guardrails (extensionless relative imports, `<input>`/`<select>` id+name accessibility, zero forbidden refs)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  latLonToContinuousWorldPx,
  continuousWorldPxToLatLon,
  panLatLonByCanvasPixels,
  canvasPixelToLatLon,
  zoomAroundCanvasPoint,
  haversineDistanceKm,
  calculateBearingDeg,
  fetchLiveCctvForSector,
  fetchViewportLiveAirspace,
  fetchLocalTargetEnvironment,
  fetchGlobalMacroReconTelemetry,
  buildFreshCameraImageUrl,
  CCTV_STRATEGIC_HUBS,
} from '../src/services/LiveReconFeedService';

import { projectPinToCanvas } from '../src/components/TacticalMapOverlay';
import {
  latLonToTileXYZ,
  buildSatelliteTileUrl,
  buildHybridReferenceTileUrls,
} from '../src/components/TacticalSatelliteMonitor';

import {
  ALLOWED_SENSOR_HOSTS,
  validateTargetUrl,
} from '../functions/api/fetch';

import { onRequest as threatMatrixOnRequest } from '../functions/api/osint/threat-matrix';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function run() {
  console.log('=== [1/7] Verifying Sub-Pixel Web Mercator Math & Cursor-Anchored Zoom (Z:2..18) ===');

  const testLocations = [
    { name: 'London Westminster', lat: 51.500729, lon: -0.124625 },
    { name: 'Port of Los Angeles', lat: 33.740512, lon: -118.271895 },
    { name: 'Strait of Malacca / Singapore', lat: 1.264431, lon: 103.822188 },
    { name: 'Ashburn Data Center Alley', lat: 39.043757, lon: -77.487442 },
  ];

  for (const loc of testLocations) {
    for (const z of [3, 8, 12, 16, 18]) {
      const worldPx = latLonToContinuousWorldPx(loc.lat, loc.lon, z);
      const roundTrip = continuousWorldPxToLatLon(worldPx.wx, worldPx.wy, z);
      assert(
        Math.abs(roundTrip.lat - loc.lat) < 1e-6 && Math.abs(roundTrip.lon - loc.lon) < 1e-6,
        `WorldPx round-trip drift too high at Z:${z} for ${loc.name}`
      );

      // Verify projectPinToCanvas <-> canvasPixelToLatLon exact inverse
      const canvasW = 960;
      const canvasH = 540;
      const targetLat = loc.lat + (z >= 14 ? 0.0024 : 0.15);
      const targetLon = loc.lon - (z >= 14 ? 0.0031 : 0.22);
      const projected = projectPinToCanvas(
        { lat: targetLat, lon: targetLon },
        loc.lat,
        loc.lon,
        z,
        canvasW,
        canvasH
      );
      const inverted = canvasPixelToLatLon(
        projected.px,
        projected.py,
        loc.lat,
        loc.lon,
        z,
        canvasW,
        canvasH
      );
      assert(
        Math.abs(inverted.lat - targetLat) < 1e-5 && Math.abs(inverted.lon - targetLon) < 1e-5,
        `Canvas pixel <-> LatLon mismatch at Z:${z} for ${loc.name}`
      );
    }
  }

  // Verify 1:1 drag-to-pan: dragging right by +120px and down by +80px shifts center so original center lands at (W/2 + 120, H/2 + 80)
  const startCenter = { lat: 51.5074, lon: -0.1278 };
  const afterDrag = panLatLonByCanvasPixels(startCenter.lat, startCenter.lon, 15, 120, 80);
  const startProjectedAfterDrag = projectPinToCanvas(
    startCenter,
    afterDrag.lat,
    afterDrag.lon,
    15,
    800,
    500
  );
  assert(
    Math.abs(startProjectedAfterDrag.px - (400 + 120)) < 0.01 &&
      Math.abs(startProjectedAfterDrag.py - (250 + 80)) < 0.01,
    `1:1 drag-pan pixel lock failed: got (${startProjectedAfterDrag.px}, ${startProjectedAfterDrag.py})`
  );

  // Verify cursor-anchored zoom invariance: spot under cursor (px=640, py=180) stays at (640, 180) after zooming Z:12 -> Z:17!
  const cursorX = 640;
  const cursorY = 180;
  const spotBeforeZoom = canvasPixelToLatLon(cursorX, cursorY, 38.8977, -77.0365, 12, 900, 520);
  const zoomedView = zoomAroundCanvasPoint(38.8977, -77.0365, 12, 17, cursorX, cursorY, 900, 520);
  assert(zoomedView.zoom === 17, 'Expected zoom 17');
  const spotAfterZoomProj = projectPinToCanvas(
    spotBeforeZoom,
    zoomedView.lat,
    zoomedView.lon,
    zoomedView.zoom,
    900,
    520
  );
  assert(
    Math.abs(spotAfterZoomProj.px - cursorX) < 0.05 &&
      Math.abs(spotAfterZoomProj.py - cursorY) < 0.05,
    `Cursor-anchored zoom drifted: expected (${cursorX}, ${cursorY}), got (${spotAfterZoomProj.px}, ${spotAfterZoomProj.py})`
  );

  const distKm = haversineDistanceKm(51.5074, -0.1278, 51.47, -0.4543); // Central London -> Heathrow (~23 km)
  const brgDeg = calculateBearingDeg(51.5074, -0.1278, 51.47, -0.4543);
  assert(distKm > 20 && distKm < 26, `Unexpected London->LHR distance: ${distKm} km`);
  assert(brgDeg > 250 && brgDeg < 270, `Unexpected London->LHR bearing: ${brgDeg}°`);
  console.log('  ✓ Sub-pixel Web Mercator round-trip, 1:1 drag-pan & cursor-anchored Z:18 zoom verified.');

  console.log('=== [2/7] Verifying Z:18 Slippy Tile XYZ & Hybrid Street/Border Reference URLs ===');
  const tile18 = latLonToTileXYZ(51.5007, -0.1246, 18);
  assert(tile18.z === 18, `latLonToTileXYZ clamped below Z:18 (got Z:${tile18.z})`);
  assert(tile18.x > 130000 && tile18.y > 87000, `Unexpected Z:18 tile indices: ${JSON.stringify(tile18)}`);
  const hybridUrls = buildHybridReferenceTileUrls(tile18.z, tile18.y, tile18.x);
  assert(
    hybridUrls.roadsUrl.includes('World_Transportation/MapServer/tile/18/'),
    'Missing Esri World_Transportation Z:18 tile URL'
  );
  assert(
    hybridUrls.placesUrl.includes('World_Boundaries_and_Places/MapServer/tile/18/'),
    'Missing Esri World_Boundaries_and_Places Z:18 tile URL'
  );
  const cartoUrl = buildSatelliteTileUrl('carto_dark_tactical', 16, 21790, 32745, '2026-11-13');
  assert(cartoUrl.startsWith('https://basemaps.cartocdn.com/dark_all/16/'), 'Invalid Carto Dark URL');
  console.log('  ✓ Z:18 tile math, Esri Hybrid Reference layers, and Carto Dark Tactical URLs verified.');

  console.log('=== [3/7] Verifying Live Public Geotagged CCTV Networks (Zero Mock Streams) ===');
  assert(CCTV_STRATEGIC_HUBS.length >= 6, 'Expected at least 6 strategic live CCTV hubs');

  const londonCctv = await fetchLiveCctvForSector(51.5074, -0.1278, 45);
  assert(
    londonCctv.inSectorCameras.length >= 25,
    `Expected >= 25 live TfL JamCams in Central London, got ${londonCctv.inSectorCameras.length}`
  );
  const sampleLondonCam = londonCctv.inSectorCameras[0];
  assert(
    sampleLondonCam.imageUrl.startsWith('https://') && sampleLondonCam.imageUrl.endsWith('.jpg'),
    `Invalid London CCTV imageUrl: ${sampleLondonCam.imageUrl}`
  );
  assert(
    Boolean(sampleLondonCam.videoUrl && sampleLondonCam.videoUrl.endsWith('.mp4')),
    `Expected live MP4 clip URL on TfL JamCam: ${sampleLondonCam.videoUrl}`
  );

  const singaporeCctv = await fetchLiveCctvForSector(1.3521, 103.8198, 50);
  assert(
    singaporeCctv.inSectorCameras.length >= 5,
    `Expected >= 5 live LTA Singapore HD cameras, got ${singaporeCctv.inSectorCameras.length}`
  );
  const sampleSgCam = singaporeCctv.inSectorCameras[0];
  assert(
    sampleSgCam.supportsQueryCacheBust === false,
    'Singapore LTA timestamped URLs must set supportsQueryCacheBust=false'
  );
  assert(
    buildFreshCameraImageUrl(sampleSgCam, 42) === sampleSgCam.imageUrl,
    'buildFreshCameraImageUrl must not append query string when supportsQueryCacheBust=false'
  );

  const laPortCctv = await fetchLiveCctvForSector(33.7701, -118.1937, 55);
  assert(
    laPortCctv.inSectorCameras.length >= 25,
    `Expected >= 25 live Caltrans D7 LA / Port of Long Beach cameras, got ${laPortCctv.inSectorCameras.length}`
  );
  console.log(
    `  ✓ Live Public CCTV verified: ${laPortCctv.totalCatalogCount} global cameras indexed (${londonCctv.inSectorCameras.length} in London, ${laPortCctv.inSectorCameras.length} in LA/Port LB, ${singaporeCctv.inSectorCameras.length} in Singapore).`
  );

  console.log('=== [4/7] Verifying Live Local Airspace (adsb.lol) & Target Weather/AQI (Open-Meteo) ===');
  const [airspace, localEnv] = await Promise.all([
    fetchViewportLiveAirspace(51.5074, -0.1278, 160),
    fetchLocalTargetEnvironment(51.5074, -0.1278),
  ]);
  assert(
    airspace.totalCount > 0 && airspace.tracks.length > 0,
    `Expected live ADS-B aircraft in London FIR, got ${airspace.totalCount}`
  );
  assert(
    typeof airspace.tracks[0].icaoHex === 'string' && Number.isFinite(airspace.tracks[0].lat),
    'Malformed ADS-B aircraft track'
  );
  assert(
    localEnv !== null &&
      localEnv.temperatureC !== null &&
      localEnv.cloudCoverPct !== null &&
      localEnv.windSpeedKts !== null,
    `Expected live Open-Meteo local telemetry, got ${JSON.stringify(localEnv)}`
  );
  console.log(
    `  ✓ Live Local Multi-INT verified: ${airspace.totalCount} ADS-B aircraft (${airspace.tacticalCount} tactical/mil/rotor), Temp ${localEnv!.temperatureC}°C, Wind ${localEnv!.windSpeedKts}kt, Cloud ${localEnv!.cloudCoverPct}% (${localEnv!.opticalPassStatus}), US AQI ${localEnv!.usAqi ?? 'N/A'}.`
  );

  console.log('=== [5/7] Verifying Live Global Macro Telemetry (USGS, NASA EONET, NOAA SWPC Kp, CISA KEV) ===');
  const globalMacro = await fetchGlobalMacroReconTelemetry(true);
  assert(globalMacro.seismicCount24h > 0, 'Expected > 0 live USGS M2.5+ seismic events in past 24h');
  assert(globalMacro.eonetActiveCount > 0, 'Expected > 0 live NASA EONET natural hazards');
  assert(
    globalMacro.spaceWeather !== null &&
      globalMacro.spaceWeather.kpIndex >= 0 &&
      globalMacro.spaceWeather.kpIndex <= 9,
    `Expected valid NOAA SWPC planetary Kp index (0..9), got ${JSON.stringify(globalMacro.spaceWeather)}`
  );
  assert(
    globalMacro.cisaKevLatest.length > 0 && globalMacro.cisaKevLatest[0].cveID.startsWith('CVE-'),
    'Expected live CISA KEV catalog entries'
  );
  console.log(
    `  ✓ Live Global Macro verified: ${globalMacro.seismicCount24h} USGS quakes, ${globalMacro.eonetActiveCount} EONET hazards, Kp ${globalMacro.spaceWeather!.kpIndex} (${globalMacro.spaceWeather!.stormLevel}), latest CISA KEV ${globalMacro.cisaKevLatest[0].cveID}.`
  );

  console.log('=== [6/7] Verifying Hardened /api/fetch Allowlist & Live /api/osint/threat-matrix ===');
  const requiredNewHosts = [
    'cwwp2.dot.ca.gov',
    'data.austintexas.gov',
    'services.arcgis.com',
    'api.data.gov.sg',
    'tie.digitraffic.fi',
    'eonet.gsfc.nasa.gov',
    'services.swpc.noaa.gov',
    'api.open-meteo.com',
    'air-quality-api.open-meteo.com',
  ];
  for (const h of requiredNewHosts) {
    assert(ALLOWED_SENSOR_HOSTS.includes(h), `Host ${h} missing from ALLOWED_SENSOR_HOSTS`);
    const validCheck = validateTargetUrl(new URL(`https://${h}/test`));
    assert(validCheck.valid === true, `Expected https://${h}/test to pass validateTargetUrl`);
  }
  assert(validateTargetUrl(new URL('http://api.tfl.gov.uk/Place/Type/JamCam')).valid === false, 'HTTP must be blocked');
  assert(validateTargetUrl(new URL('https://169.254.169.254/latest/meta-data/')).valid === false, 'Metadata IP must be blocked');
  assert(validateTargetUrl(new URL('https://127.0.0.1:8080/')).valid === false, 'Loopback must be blocked');
  assert(validateTargetUrl(new URL('https://evil.example.com/feed.json')).valid === false, 'Unlisted host must be blocked');

  const tmReq = new Request(
    'https://pixelops.local/api/osint/threat-matrix?zone=western_europe&customLocation=SW1A%201AA'
  );
  const tmRes = await threatMatrixOnRequest({ request: tmReq });
  assert(tmRes.status === 200, `Expected 200 from threat-matrix function, got ${tmRes.status}`);
  const tmJson: any = await tmRes.json();
  assert(
    tmJson.operationalZone?.coordinates &&
      Math.abs(tmJson.operationalZone.coordinates.lat - 51.5) < 0.1,
    `Expected geocoded SW1A 1AA coordinates near 51.5N, got ${JSON.stringify(tmJson.operationalZone?.coordinates)}`
  );
  assert(
    Array.isArray(tmJson.threatCorrelationMatrix) &&
      tmJson.threatCorrelationMatrix.length >= 2,
    'Expected live Pillar 1 threat correlation entries'
  );
  assert(
    Boolean(tmJson.infrastructureAndGrid?.threatBadge) &&
      Array.isArray(tmJson.cyberThreatRadar) &&
      tmJson.cyberThreatRadar.length > 0 &&
      Array.isArray(tmJson.supplyChainDisruptions) &&
      tmJson.supplyChainDisruptions.length >= 2,
    'Expected live Pillar 2 infrastructure object, Pillar 3 CISA KEV radar, and Pillar 4 supply-chain corridors'
  );
  console.log('  ✓ /api/fetch SSRF/allowlist guards & live /api/osint/threat-matrix endpoint verified.');

  console.log('=== [7/7] Auditing Codebase Guardrails (Imports, Form id+name, Forbidden Refs) ===');
  const rootDir = path.resolve(process.cwd());
  const auditedSrcFiles = [
    'src/services/LiveReconFeedService.ts',
    'src/components/TacticalMapOverlay.tsx',
    'src/components/TacticalSatelliteMonitor.tsx',
    'src/components/ThreatMonitorModal.tsx',
  ];

  const relImportWithExtRegex = /from\s+['"](\.[^'"]+\.(?:ts|tsx|js|jsx))['"]/g;
  const tagRegex = /<(input|select)\b([\s\S]*?)>/g;

  for (const relPath of auditedSrcFiles) {
    const absPath = path.join(rootDir, relPath);
    const content = fs.readFileSync(absPath, 'utf8');

    // 1. Extensionless relative imports
    const badImports = [...content.matchAll(relImportWithExtRegex)];
    assert(
      badImports.length === 0,
      `Found relative import with extension in ${relPath}: ${badImports.map((m) => m[1]).join(', ')}`
    );

    // 2. Zero forbidden model / auth providers
    assert(!/gemini-2\.5-flash/i.test(content), `Forbidden gemini-2.5-flash found in ${relPath}`);
    assert(!/supabase|auth0/i.test(content), `Forbidden supabase/auth0 reference found in ${relPath}`);

    // 3. Every <input> and <select> must have both id= and name=
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      const tagName = match[1];
      const attrs = match[2];
      assert(
        /\bid\s*=/.test(attrs) && /\bname\s*=/.test(attrs),
        `Missing id or name attribute on <${tagName}> in ${relPath}: <${tagName}${attrs.slice(0, 120)}...>`
      );
    }
  }
  console.log('  ✓ All static guardrails (extensionless imports, <input>/<select> id+name, zero forbidden refs) passed.');

  console.log('\n✅ ALL RECON MONITOR & THREAT MATRIX OVERHAUL VERIFICATION CHECKS PASSED!');
}

run().catch((err) => {
  console.error('\n❌ RECON OVERHAUL VERIFICATION FAILED:', err);
  process.exit(1);
});
