import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Globe,
  Zap,
  Lock,
  Truck,
  Radar,
  RefreshCw,
  FileText,
  Terminal,
  Database,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  X,
  Compass,
  Cpu,
  Radio,
  Anchor,
  Video,
  Plane,
  Wind,
  Plus,
} from 'lucide-react';
import { writeWorkspaceFile } from '../engine/storageManager';
import {
  retrieveRelevantClassifiedBriefings,
  fetchLocalDispatchFeeds,
} from '../services/ClassifiedFeedService';
import { retrieveRelevantISWBriefings } from '../services/iswFeedService';
import {
  getLocalGeofenceConfig,
  saveLocalGeofenceConfig,
  type LocalGeofenceConfig,
} from '../services/OsintToolsService';
import { isHighAlertModeEnabled, setHighAlertMode } from '../services/NightShiftService';
import {
  runPreMediaLocalizedThreatSweep,
  type PreMediaSweepReport,
} from '../services/PreMediaSignalService';
import { analyzeDispatchSignal } from '../services/DispatchTriageService';
import {
  isRadioScannerDisabledForNai,
  setPrimaryNaiZone,
  UK_WTA_2006_SAFE_MODE_LABEL,
} from '../services/LocalSensorBus';
import {
  CCTV_STRATEGIC_HUBS,
  fetchGlobalMacroReconTelemetry,
  fetchLocalTargetEnvironment,
  fetchViewportLiveAirspace,
  fetchLiveCctvForSector,
  buildFreshCameraImageUrl,
  addCustomCctvCamera,
  haversineDistanceKm,
  type GlobalMacroReconTelemetry,
  type LiveTargetEnvTelemetry,
  type LiveCctvSweepResult,
  type LiveCctvCamera,
} from '../services/LiveReconFeedService';
import {
  TacticalSatelliteMonitor,
  parseReconTargetToCoords,
  resolveReconLocationAsync,
} from './TacticalSatelliteMonitor';

export interface ThreatCorrelationItem {
  id: string;
  operative: string;
  severity: 'ALPHA-CRITICAL' | 'BRAVO-ELEVATED' | 'CHARLIE-NOMINAL';
  globalEvent: string;
  sourceCitation: string;
  sourceUrl: string;
  trickleDownImpact: string;
  actionableOutput: string;
  recommendedActionType: string;
}

export interface InfrastructureGridStatus {
  threatBadge: string;
  threatLevel: 'ALPHA' | 'BRAVO' | 'CHARLIE';
  monitoredGrid: string;
  backboneHealth: string;
  frequencyHz: string;
  ispBackboneStatus: string;
  activeAdvisories: Array<{
    id: string;
    title: string;
    source: string;
    publishedAt: string;
    url: string;
    impact: string;
  }>;
  preparednessBriefingSummary: string;
}

export interface CyberVulnerabilityItem {
  id: string;
  cveId: string;
  title: string;
  severity: string;
  dateAdded: string;
  summary: string;
  operative: string;
  remediationChecklist: string[];
}

export interface SupplyChainDisruptionItem {
  id: string;
  category: string;
  chokepoint: string;
  status: string;
  headline: string;
  source: string;
  url: string;
  practicalImpact: string;
}

export interface ThreatMatrixPayload {
  status: string;
  operationalZone: {
    id: string;
    label: string;
    customLocation: string | null;
    coordinates: { lat: number; lon: number };
    primaryGridName: string;
    primaryBackboneCorridor: string;
    primaryMaritimeChokepoint: string;
    primaryAirspaceSector: string;
  };
  availableZones: Array<{ id: string; label: string }>;
  threatCorrelationMatrix: ThreatCorrelationItem[];
  infrastructureAndGrid: InfrastructureGridStatus;
  cyberThreatRadar: CyberVulnerabilityItem[];
  supplyChainDisruptions: SupplyChainDisruptionItem[];
  fetchedAt: string;
}

interface ThreatMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenVaultFile?: (filePath?: string) => void;
  onOpenLlmSettings?: () => void;
  onInjectTerminalReport?: (params: {
    agentName: string;
    title: string;
    markdown: string;
    savedFilePath?: string;
  }) => void;
}

const DEFAULT_ZONES: Array<{
  id: string;
  label: string;
  lat: number;
  lon: number;
  grid: string;
  backbone: string;
  maritime: string;
  airspace: string;
}> = [
  {
    id: 'north_america',
    label: 'North America (US / Canada Grid & East-West Backbones)',
    lat: 38.9072,
    lon: -77.0369,
    grid: 'NERC Interconnections (PJM / ERCOT / WECC)',
    backbone: 'US-East (Ashburn VA) <-> Trans-Atlantic & US-West Fiber Rings',
    maritime: 'Port of Los Angeles / Long Beach & Panama Canal Approach',
    airspace: 'FAA CONUS & North Atlantic Tracks (NAT)',
  },
  {
    id: 'western_europe',
    label: 'Western Europe (ENTSO-E / UK Grid, London/Frankfurt IXPs & TfL CCTV)',
    lat: 51.5074,
    lon: -0.1278,
    grid: 'ENTSO-E Continental European & UK National Grid',
    backbone: 'LINX London / DE-CIX Frankfurt <-> Mediterranean & Red Sea Submarine Corridor',
    maritime: 'English Channel, Strait of Gibraltar & Rotterdam Europort',
    airspace: 'EUROCONTROL Core European & UK London FIR',
  },
  {
    id: 'med_red_sea',
    label: 'Mediterranean & Red Sea Corridor (Submarine Cable & Suez Chokepoint)',
    lat: 30.5852,
    lon: 32.2654,
    grid: 'MENA & Eastern Mediterranean Regional Intertie',
    backbone: 'Red Sea / Suez Submarine Fiber Corridor (AAE-1, Seacom, EIG, TGN-EA)',
    maritime: 'Suez Canal & Bab el-Mandeb Strait',
    airspace: 'Cairo FIR / Jeddah FIR & Eastern Mediterranean',
  },
  {
    id: 'indo_pacific',
    label: 'Indo-Pacific & East Asia (Malacca Strait, Singapore CCTV & Taiwan Strait)',
    lat: 1.3521,
    lon: 103.8198,
    grid: 'APAC Regional Power Grids (EMA Singapore / Taipower / TEPCO)',
    backbone: 'Intra-Asia & Trans-Pacific Submarine Cable Systems (APG / SJC / Jupiter)',
    maritime: 'Strait of Malacca & Taiwan Strait Shipping Lanes',
    airspace: 'Singapore FIR / Taipei FIR / Tokyo FIR',
  },
  {
    id: 'global_overwatch',
    label: 'Global All-Sector Overwatch (Worldwide Macro-to-Micro Matrix)',
    lat: 25.0,
    lon: 15.0,
    grid: 'Global Multi-Region High-Voltage Interconnections',
    backbone: 'Red Sea / Mediterranean, Trans-Atlantic & Trans-Pacific Subsea Trunks',
    maritime: 'Suez Canal, Strait of Hormuz, Malacca Strait & Panama Canal',
    airspace: 'Global ICAO Flight Information Regions & GNSS Watchzones',
  },
];

export const ThreatMonitorModal: React.FC<ThreatMonitorModalProps> = ({
  isOpen,
  onClose,
  onOpenVaultFile,
  onOpenLlmSettings,
  onInjectTerminalReport,
}) => {
  const [selectedZone, setSelectedZone] = useState<string>('north_america');
  const [customLocation, setCustomLocation] = useState<string>('');
  const [selectedOperative, setSelectedOperative] = useState<
    'Agent Nyx' | 'Agent Vance' | 'Agent Cipher'
  >('Agent Nyx');
  const [activePillarTab, setActivePillarTab] = useState<
    'all' | 'satellite' | 'cctv' | 'correlation' | 'grid' | 'cyber' | 'supply'
  >('all');

  const [telemetry, setTelemetry] = useState<ThreatMatrixPayload | null>(null);
  const [resolvedCustomCoords, setResolvedCustomCoords] = useState<{
    lat: number;
    lon: number;
    label: string;
    sectorCode: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRunningSweep, setIsRunningSweep] = useState<boolean>(false);
  const [sweepStatusBanner, setSweepStatusBanner] = useState<{
    message: string;
    savedPath?: string;
    type: 'success' | 'info' | 'warning';
  } | null>(null);
  const [geofence, setGeofence] = useState<LocalGeofenceConfig>(getLocalGeofenceConfig);
  const [highAlert, setHighAlert] = useState<boolean>(isHighAlertModeEnabled);
  const [isRunningPreMedia, setIsRunningPreMedia] = useState<boolean>(false);
  const [preMediaReport, setPreMediaReport] = useState<PreMediaSweepReport | null>(null);
  const [customCadFeedInput, setCustomCadFeedInput] = useState<string>('');
  const [scannerTranscriptInput, setScannerTranscriptInput] = useState<string>('');
  const [isTriagingScanner, setIsTriagingScanner] = useState<boolean>(false);

  // Real-Time Global + Local Multi-INT Overlay Telemetry States
  const [globalMacro, setGlobalMacro] = useState<GlobalMacroReconTelemetry | null>(null);
  const [localEnv, setLocalEnv] = useState<LiveTargetEnvTelemetry | null>(null);
  const [airspaceSummary, setAirspaceSummary] = useState<{
    totalCount: number;
    tacticalCount: number;
  }>({ totalCount: 0, tacticalCount: 0 });
  const [cctvSweep, setCctvSweep] = useState<LiveCctvSweepResult>({
    inSectorCameras: [],
    nearestGlobalCameras: [],
    globalHubShowcase: [],
    totalCatalogCount: 0,
    activeNetworks: [],
  });
  const [cctvRefreshTick, setCctvRefreshTick] = useState<number>(0);
  const [cctvNvgMode, setCctvNvgMode] = useState<boolean>(false);
  const [selectedWallCam, setSelectedWallCam] = useState<LiveCctvCamera | null>(null);
  const [customWallCamName, setCustomWallCamName] = useState<string>('');
  const [customWallCamUrl, setCustomWallCamUrl] = useState<string>('');

  // Auto-tick CCTV snapshots every 10s when modal is open on CCTV or All tab
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => {
      setCctvRefreshTick((t) => t + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [isOpen]);

  /**
   * Synthesizes a 100% live-backed ThreatMatrixPayload directly from real global & local feeds
   * (USGS Seismic, NASA EONET, NOAA SWPC Kp, Open-Meteo, adsb.lol, CISA KEV, and Public DOT CCTV).
   */
  const synthesizeLiveClientThreatMatrix = useCallback(
    async (
      zoneId: string,
      customLoc: string,
      overrideCoords?: { lat: number; lon: number; label?: string } | null
    ): Promise<ThreatMatrixPayload> => {
      const zoneObj = DEFAULT_ZONES.find((z) => z.id === zoneId) || DEFAULT_ZONES[0];
      const targetLat = overrideCoords?.lat ?? zoneObj.lat;
      const targetLon = overrideCoords?.lon ?? zoneObj.lon;
      const displayLabel =
        overrideCoords?.label ||
        (customLoc ? `${customLoc} (${zoneObj.label.split(' (')[0]})` : zoneObj.label);

      const [macro, env, air, cctv] = await Promise.all([
        fetchGlobalMacroReconTelemetry(),
        fetchLocalTargetEnvironment(targetLat, targetLon),
        fetchViewportLiveAirspace(targetLat, targetLon, 180),
        fetchLiveCctvForSector(targetLat, targetLon, 140),
      ]);

      setGlobalMacro(macro);
      if (env) setLocalEnv(env);
      setAirspaceSummary({ totalCount: air.totalCount, tacticalCount: air.tacticalCount });
      setCctvSweep(cctv);

      // Sort global hazards by proximity to active sector so regional events surface first
      const sortedHazards = [...macro.hazards].sort(
        (a, b) =>
          haversineDistanceKm(targetLat, targetLon, a.lat, a.lon) -
          haversineDistanceKm(targetLat, targetLon, b.lat, b.lon)
      );
      const nearestHazard = sortedHazards[0];
      const nearestDistKm = nearestHazard
        ? Math.round(haversineDistanceKm(targetLat, targetLon, nearestHazard.lat, nearestHazard.lon))
        : null;

      const kp = macro.spaceWeather?.kpIndex ?? 0;
      const kpStorm = kp >= 5;

      const correlationItems: ThreatCorrelationItem[] = [];
      if (nearestHazard) {
        correlationItems.push({
          id: `live-hz-${nearestHazard.id}`,
          operative: 'Agent Cipher',
          severity:
            nearestDistKm !== null && nearestDistKm < 450
              ? 'ALPHA-CRITICAL'
              : 'BRAVO-ELEVATED',
          globalEvent: `[${nearestHazard.source}] ${nearestHazard.title} (${nearestHazard.lat.toFixed(
            3
          )}°, ${nearestHazard.lon.toFixed(3)}° — ${nearestDistKm?.toLocaleString()} km from target)`,
          sourceCitation: `${nearestHazard.source} Live Feed (${new Date(
            nearestHazard.observedAt
          ).toUTCString()})`,
          sourceUrl: nearestHazard.sourceUrl,
          trickleDownImpact: `Agent Cipher cross-referenced ${macro.seismicCount24h} global M2.5+ seismic events and ${macro.eonetActiveCount} active NASA EONET hazards against ${displayLabel} terrestrial/subsea infrastructure (${zoneObj.backbone}).`,
          actionableOutput:
            'Maintain multi-region inference failover and archive critical local VFS dossiers to IndexedDB.',
          recommendedActionType: 'BACKUP_VAULT_AND_FAILOVER',
        });
      }

      if (macro.spaceWeather) {
        correlationItems.push({
          id: 'live-noaa-swpc',
          operative: 'Agent Nyx',
          severity: kpStorm ? 'BRAVO-ELEVATED' : 'CHARLIE-NOMINAL',
          globalEvent: `NOAA SWPC Planetary Geomagnetic Index Kp=${macro.spaceWeather.kpIndex} (${macro.spaceWeather.stormLevel})`,
          sourceCitation: `NOAA Space Weather Prediction Center (${macro.spaceWeather.observedAt} UTC)`,
          sourceUrl: 'https://www.swpc.noaa.gov/',
          trickleDownImpact: macro.spaceWeather.gnssAndHfImpact,
          actionableOutput: kpStorm
            ? 'Cross-verify GNSS timing & ADS-B positional accuracy across regional air/maritime corridors.'
            : 'Ionospheric HF/GNSS propagation nominal for orbital optical & transponder correlation.',
          recommendedActionType: 'VERIFY_ENDPOINTS',
        });
      }

      const windGustElevated = (env?.windGustsKts ?? 0) >= 32;
      const aqiElevated = (env?.usAqi ?? 0) > 110;
      const gridElevated = kpStorm || windGustElevated || aqiElevated;

      const cyberItems: CyberVulnerabilityItem[] = macro.cisaKevLatest.map((v) => ({
        id: v.cveID,
        cveId: v.cveID,
        title: `${v.vendorProject} ${v.product} — ${v.vulnerabilityName}`,
        severity:
          v.knownRansomwareCampaignUse === 'Known'
            ? 'CRITICAL (CISA KEV // RANSOMWARE ACTIVE)'
            : 'CRITICAL (CISA KEV ACTIVE EXPLOIT)',
        dateAdded: v.dateAdded,
        summary: v.shortDescription,
        operative: 'Agent Vance',
        remediationChecklist: [
          v.requiredAction || `Apply vendor patch for ${v.vendorProject} ${v.product} immediately.`,
          `Audit safehouse and cloud dependency manifests for ${v.product} exposure.`,
          `Enforce strict egress allowlists and rotate exposed tokens for ${v.cveID}.`,
        ],
      }));

      return {
        status: 'ok',
        operationalZone: {
          id: zoneId,
          label: displayLabel,
          customLocation: customLoc || null,
          coordinates: { lat: targetLat, lon: targetLon },
          primaryGridName: zoneObj.grid,
          primaryBackboneCorridor: zoneObj.backbone,
          primaryMaritimeChokepoint: zoneObj.maritime,
          primaryAirspaceSector: zoneObj.airspace,
        },
        availableZones: DEFAULT_ZONES.map((z) => ({ id: z.id, label: z.label })),
        threatCorrelationMatrix: correlationItems,
        infrastructureAndGrid: {
          threatBadge: gridElevated
            ? 'THREAT LEVEL: BRAVO - WEATHER / PLUME / GIC WATCH'
            : 'THREAT LEVEL: CHARLIE - GRID & BACKBONE NOMINAL',
          threatLevel: gridElevated ? 'BRAVO' : 'CHARLIE',
          monitoredGrid: zoneObj.grid,
          backboneHealth: zoneObj.backbone,
          frequencyHz:
            zoneId === 'western_europe' || zoneId === 'med_red_sea' || zoneId === 'indo_pacific'
              ? '50.00 Hz Synchronous Grid'
              : '60.00 Hz Synchronous Grid',
          ispBackboneStatus: env
            ? `Live Target Weather: ${env.temperatureC ?? '--'}°C | Wind ${
                env.windSpeedKts ?? '--'
              }kt (Gusts ${env.windGustsKts ?? '--'}kt) | Visibility ${
                env.visibilityKm ?? '--'
              }km | AQI ${env.usAqi ?? '--'}`
            : 'Live Terrestrial & Subsea Peering Monitored',
          activeAdvisories: [
            {
              id: 'live-env-grid-watch',
              title: `Live Atmospheric, Wind & Plume Telemetry (${targetLat.toFixed(
                4
              )}°, ${targetLon.toFixed(4)}°)`,
              source: 'Open-Meteo Meteorological & Air Quality API',
              publishedAt: env?.observedAt || new Date().toISOString(),
              url: 'https://open-meteo.com/',
              impact: env
                ? `Cloud cover ${env.cloudCoverPct ?? '--'}% (${env.opticalPassStatus}), surface pressure ${
                    env.surfacePressureHpa ?? '--'
                  } hPa, PM2.5 ${env.pm25 ?? '--'} µg/m³.`
                : `Monitoring local substation & telecom environmental envelope for ${displayLabel}.`,
            },
          ],
          preparednessBriefingSummary: `Preparedness protocol for ${displayLabel}: Verify local UPS autonomy, snapshot IndexedDB VFS vaults, and monitor live pre-media sensor sweeps.`,
        },
        cyberThreatRadar: cyberItems,
        supplyChainDisruptions: [
          {
            id: 'live-adsb-corridor',
            category: 'LIVE ADS-B AIRSPACE & TRANSPONDER DENSITY',
            chokepoint: `${zoneObj.airspace} (${targetLat.toFixed(3)}°, ${targetLon.toFixed(3)}°)`,
            status: `${air.totalCount} LIVE AIRCRAFT (${air.tacticalCount} MIL/GOV/ROTOR)`,
            headline: `Live 180 km ADS-B sweep tracking ${air.totalCount} active transponders (${air.tacticalCount} military/government/rotorcraft/emergency contacts) around ${displayLabel}`,
            source: 'adsb.lol Real-Time Unfiltered ADS-B',
            url: 'https://adsb.lol/',
            practicalImpact:
              'Inspect individual directional aircraft chevrons directly on the Recon Monitor canvas for callsign, hex, altitude, and heading.',
          },
          {
            id: 'live-cctv-corridor',
            category: 'PUBLIC STREET, PORT & HIGHWAY CCTV COVERAGE',
            chokepoint: zoneObj.maritime,
            status:
              cctv.inSectorCameras.length > 0
                ? `${cctv.inSectorCameras.length} IN-SECTOR LIVE CAMS`
                : `${cctv.totalCatalogCount} GLOBAL HUB CAMS ONLINE`,
            headline:
              cctv.inSectorCameras.length > 0
                ? `${cctv.inSectorCameras.length} live municipal/DOT traffic & port cameras streaming within 140 km of target center (${cctv.activeNetworks.join(', ')})`
                : `Global public CCTV grids online (${cctv.activeNetworks.join(', ')}); use the Live CCTV tab to inspect covered ports & capitals`,
            source: 'Public Municipal & DOT Live Camera Feeds',
            url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
            practicalImpact:
              'Switch to the Live CCTV & Street Recon tab or click any green 📹 node on the Satellite Monitor to open live video/snapshot feeds.',
          },
        ],
        fetchedAt: new Date().toISOString(),
      };
    },
    []
  );

  const fetchThreatMatrix = useCallback(
    async (
      zoneId: string,
      customLoc: string,
      explicitCoords?: { lat: number; lon: number; label: string; sectorCode?: string }
    ) => {
      setIsLoading(true);
      const trimmedLoc = customLoc.trim();

      let geoCoords: { lat: number; lon: number; label: string; sectorCode: string } | null =
        explicitCoords
          ? {
              lat: explicitCoords.lat,
              lon: explicitCoords.lon,
              label: explicitCoords.label,
              sectorCode:
                explicitCoords.sectorCode ||
                `LOCK // ${explicitCoords.lat.toFixed(3)}°, ${explicitCoords.lon.toFixed(3)}°`,
            }
          : null;

      if (!geoCoords && trimmedLoc) {
        geoCoords = await resolveReconLocationAsync(trimmedLoc, zoneId);
      }
      setResolvedCustomCoords(geoCoords);

      // Always hydrate live client-side Global + Local feeds concurrently
      const liveClientPromise = synthesizeLiveClientThreatMatrix(zoneId, customLoc, geoCoords);

      try {
        const params = new URLSearchParams({ zone: zoneId });
        if (trimmedLoc) {
          params.set('customLocation', trimmedLoc);
        }
        const res = await fetch(`/api/osint/threat-matrix?${params.toString()}`);
        if (res.ok) {
          const data: ThreatMatrixPayload = await res.json();
          const clientData = await liveClientPromise;
          if (data && data.status === 'ok') {
            if (geoCoords && data.operationalZone) {
              data.operationalZone.coordinates = { lat: geoCoords.lat, lon: geoCoords.lon };
              data.operationalZone.label = geoCoords.label;
            }
            // Prefer non-empty live CISA KEV & live client ADS-B/CCTV supply corridor metrics
            const merged: ThreatMatrixPayload = {
              ...data,
              cyberThreatRadar:
                data.cyberThreatRadar?.length > 0
                  ? data.cyberThreatRadar
                  : clientData.cyberThreatRadar,
              supplyChainDisruptions: clientData.supplyChainDisruptions,
            };
            setTelemetry(merged);
            setIsLoading(false);
            return merged;
          }
        }
      } catch {
        // Use live client-synthesized telemetry seamlessly when running locally without Cloudflare Worker
      }

      const liveSynthesized = await liveClientPromise;
      setTelemetry(liveSynthesized);
      setIsLoading(false);
      return liveSynthesized;
    },
    [synthesizeLiveClientThreatMatrix]
  );

  useEffect(() => {
    if (isOpen) {
      setGeofence(getLocalGeofenceConfig());
      fetchThreatMatrix(selectedZone, customLocation);
    }
    const onNaiUpdated = () => setGeofence(getLocalGeofenceConfig());
    window.addEventListener('pixelops:nai-updated', onNaiUpdated);
    return () => window.removeEventListener('pixelops:nai-updated', onNaiUpdated);
  }, [isOpen, selectedZone, fetchThreatMatrix]);

  if (!isOpen) return null;

  const handleImmediateVaultBackup = async () => {
    if (!telemetry) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `intel/backups/cipher_emergency_vault_snapshot_${timestamp}.md`;
    const content = [
      `# AGENT CIPHER // EMERGENCY VAULT SNAPSHOT & ENDPOINT FAILOVER LOG`,
      `**Timestamp:** ${new Date().toUTCString()}`,
      `**Operational Zone:** ${telemetry.operationalZone.label}`,
      `**Trigger Event:** ${telemetry.threatCorrelationMatrix[0]?.globalEvent || 'Live Global Hazard Correlation'}`,
      ``,
      `## Trickle-Down Impact Assessment`,
      `${telemetry.threatCorrelationMatrix[0]?.trickleDownImpact || ''}`,
      ``,
      `## Recommended Failover Protocol`,
      `- **Action:** ${telemetry.threatCorrelationMatrix[0]?.actionableOutput || ''}`,
      `- **Primary Backbone Monitored:** ${telemetry.operationalZone.primaryBackboneCorridor}`,
      `- **Local IndexedDB VFS Sync:** VERIFIED & ARCHIVED`,
    ].join('\n');

    await writeWorkspaceFile(path, content, 'markdown', 'intel');
    setSweepStatusBanner({
      message: `Agent Cipher backed up emergency telemetry snapshot to VFS Vault: /${path}`,
      savedPath: path,
      type: 'success',
    });
  };

  const handleGeneratePreparednessBriefing = async () => {
    if (!telemetry) return;
    const dateSlug = new Date().toISOString().split('T')[0];
    const path = `intel/dossiers/grid_preparedness_briefing_${telemetry.operationalZone.id}_${dateSlug}.md`;
    const g = telemetry.infrastructureAndGrid;

    const markdown = [
      `# REGIONAL INFRASTRUCTURE & GRID PREPAREDNESS BRIEFING`,
      `**Status Badge:** \`${g.threatBadge}\``,
      `**Operational Zone:** ${telemetry.operationalZone.label}`,
      `**Monitored Power Grid:** ${g.monitoredGrid} (${g.frequencyHz})`,
      `**ISP / Telecom & Weather Envelope:** ${g.backboneHealth} — ${g.ispBackboneStatus}`,
      `**Generated At:** ${new Date().toUTCString()}`,
      ``,
      `---`,
      ``,
      `## 1. Active Grid, Environmental & Telecom Advisories`,
      ...g.activeAdvisories.map(
        (adv, i) =>
          `${i + 1}. **${adv.title}**\n   - *Source:* ${adv.source} (${adv.publishedAt})\n   - *Operational Impact:* ${adv.impact}\n   - *Reference:* ${adv.url}`
      ),
      ``,
      `## 2. Safehouse Preparedness Checklist`,
      `- [x] **Local VFS Vault Continuity:** Critical intelligence dossiers synced to IndexedDB (\`/intel/dossiers/\`).`,
      `- [ ] **Power & UPS Autonomy:** Verify local battery/UPS reserve for workstation and router hardware.`,
      `- [ ] **Telecom & LLM Endpoint Redundancy:** Configure secondary inference provider in case regional peering degrades.`,
      ``,
      `> ${g.preparednessBriefingSummary}`,
    ].join('\n');

    await writeWorkspaceFile(path, markdown, 'markdown', 'intel');
    setSweepStatusBanner({
      message: `Preparedness Briefing saved to Vault: /${path}`,
      savedPath: path,
      type: 'success',
    });

    if (onInjectTerminalReport) {
      onInjectTerminalReport({
        agentName: 'Agent Vance',
        title: `${g.threatBadge} // Preparedness Briefing (${telemetry.operationalZone.label})`,
        markdown,
        savedFilePath: path,
      });
    }
  };

  const handleFlagCveInTerminal = async (vuln: CyberVulnerabilityItem) => {
    const dateSlug = new Date().toISOString().split('T')[0];
    const path = `intel/dossiers/cyber_remediation_${vuln.cveId
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')}_${dateSlug}.md`;

    const markdown = [
      `# AGENT VANCE // CYBER THREAT & VULNERABILITY REMEDIATION ALERT`,
      `**Identifier:** \`${vuln.cveId}\` | **Severity:** \`${vuln.severity}\``,
      `**Target / Component:** ${vuln.title}`,
      `**Cataloged Date:** ${vuln.dateAdded}`,
      ``,
      `## Vulnerability Telemetry`,
      `${vuln.summary}`,
      ``,
      `## Direct Remediation Checklist`,
      ...vuln.remediationChecklist.map((step) => `- [ ] ${step}`),
    ].join('\n');

    await writeWorkspaceFile(path, markdown, 'markdown', 'intel');
    setSweepStatusBanner({
      message: `Agent Vance flagged ${vuln.cveId} remediation checklist to Terminal Feed & Vault (/intel/dossiers/)`,
      savedPath: path,
      type: 'warning',
    });

    if (onInjectTerminalReport) {
      onInjectTerminalReport({
        agentName: 'Agent Vance',
        title: `CYBER RADAR ALERT: ${vuln.cveId} — ${vuln.title}`,
        markdown,
        savedFilePath: path,
      });
    }
  };

  const handleRunAutonomousReconSweep = async () => {
    setIsRunningSweep(true);
    setSweepStatusBanner({
      message: `${selectedOperative} is pulling live ADS-B, CCTV, CISA KEV, USGS/EONET & S2 telemetry for ${
        customLocation || selectedZone
      }...`,
      type: 'info',
    });

    try {
      const freshData = await fetchThreatMatrix(selectedZone, customLocation);
      const zoneLabel = freshData.operationalZone.label;

      const classifiedMatches = await retrieveRelevantClassifiedBriefings(
        `recon sweep threat matrix grid cyber supply chain ${zoneLabel} ${customLocation}`,
        2
      );
      const iswMatches = await retrieveRelevantISWBriefings(
        `${zoneLabel} ${customLocation} conflict assessment front offensive`,
        2
      );

      const timestampIso = new Date().toISOString();
      const dateSlug = timestampIso.split('T')[0];
      const timeSlug = timestampIso.split('T')[1].slice(0, 5).replace(':', '');
      const dossierPath = `intel/dossiers/recon_sweep_${freshData.operationalZone.id}_${dateSlug}_${timeSlug}.md`;

      const corr = freshData.threatCorrelationMatrix[0];
      const grid = freshData.infrastructureAndGrid;

      const dossierMarkdown = [
        `# TACTICAL MULTI-INT RECON DOSSIER // ${zoneLabel.toUpperCase()}`,
        `**Lead Operative:** ${selectedOperative} (with Agent Cipher Correlation Matrix)`,
        `**Operational Zone:** ${zoneLabel} (${freshData.operationalZone.coordinates.lat.toFixed(4)}°, ${freshData.operationalZone.coordinates.lon.toFixed(4)}°)`,
        `**Grid Threat Badge:** \`${grid.threatBadge}\``,
        `**Sweep Timestamp:** ${new Date().toUTCString()}`,
        `**VFS Vault Location:** \`/${dossierPath}\``,
        ``,
        `---`,
        ``,
        `## 1. The Threat Correlation Matrix (Live Global-to-Local Feed)`,
        ...freshData.threatCorrelationMatrix.map(
          (item, idx) =>
            `### 1.${idx + 1} Event: ${item.globalEvent}\n` +
            `- **Severity:** \`${item.severity}\` | **Source:** [${item.sourceCitation}](${item.sourceUrl})\n` +
            `- **Trickle-Down Impact (${item.operative}):** ${item.trickleDownImpact}\n` +
            `- **Actionable Output:** **${item.actionableOutput}**`
        ),
        ``,
        `---`,
        ``,
        `## 2. Infrastructure, Weather & Grid Stability Monitor`,
        `- **Status Badge:** \`${grid.threatBadge}\``,
        `- **Monitored Energy Grid:** ${grid.monitoredGrid} (\`${grid.frequencyHz}\`)`,
        `- **Backbone & Meteorological Envelope:** ${grid.backboneHealth} — *${grid.ispBackboneStatus}*`,
        ...grid.activeAdvisories.map(
          (adv) => `- **${adv.title}** (*${adv.source}*, ${adv.publishedAt}) — ${adv.impact}`
        ),
        ``,
        `---`,
        ``,
        `## 3. Live CISA KEV Cyber Threat Radar (Agent Vance)`,
        ...freshData.cyberThreatRadar.map(
          (v) =>
            `### \`${v.cveId}\` — ${v.title} (\`${v.severity}\`)\n` +
            `- **Summary:** ${v.summary}\n` +
            `- **Remediation Checklist:**\n` +
            v.remediationChecklist.map((step) => `  - [ ] ${step}`).join('\n')
        ),
        ``,
        `---`,
        ``,
        `## 4. Airspace, CCTV & Supply Line Telemetry`,
        ...freshData.supplyChainDisruptions.map(
          (sc) =>
            `### ${sc.category} — ${sc.chokepoint}\n` +
            `- **Status:** \`${sc.status}\`\n` +
            `- **Live Telemetry:** ${sc.headline} (*${sc.source}*)\n` +
            `- **Operational Note:** ${sc.practicalImpact}`
        ),
        ...(classifiedMatches.length > 0
          ? [
              ``,
              `---`,
              ``,
              `## 5. Corroborated Classified Feed Intelligence`,
              ...classifiedMatches.map(
                (cb) =>
                  `- **${cb.title}** (*Published: ${cb.published}*) — Tags: \`${cb.threatTags.join(
                    ', '
                  )}\`\n  - ${cb.summary}`
              ),
            ]
          : []),
        ...(iswMatches.length > 0
          ? [
              ``,
              `---`,
              ``,
              `## 6. Corroborated ISW Conflict Research`,
              ...iswMatches.map(
                (ib) =>
                  `- **${ib.title}** (*Theater: ${ib.theater.toUpperCase()}*) — [ISW Source](${
                    ib.url
                  })\n  - ${ib.summary}`
              ),
            ]
          : []),
      ].join('\n');

      await writeWorkspaceFile(dossierPath, dossierMarkdown, 'markdown', 'intel');

      if (onInjectTerminalReport) {
        onInjectTerminalReport({
          agentName: selectedOperative,
          title: `RECON SWEEP DOSSIER // ${zoneLabel} [${corr?.severity || 'BRAVO'}]`,
          markdown: dossierMarkdown,
          savedFilePath: dossierPath,
        });
      }

      setSweepStatusBanner({
        message: `Autonomous Multi-INT Recon Sweep complete! Dossier saved to VFS Vault: /${dossierPath}`,
        savedPath: dossierPath,
        type: 'success',
      });
    } catch (err: any) {
      setSweepStatusBanner({
        message: `Recon Sweep encountered an error: ${err?.message || 'Unknown error'}`,
        type: 'warning',
      });
    } finally {
      setIsRunningSweep(false);
    }
  };

  const activeCoords = {
    lat:
      resolvedCustomCoords?.lat ??
      parseReconTargetToCoords(customLocation)?.lat ??
      telemetry?.operationalZone?.coordinates?.lat ??
      38.9072,
    lon:
      resolvedCustomCoords?.lon ??
      parseReconTargetToCoords(customLocation)?.lon ??
      telemetry?.operationalZone?.coordinates?.lon ??
      -77.0369,
  };

  const cctvWallCameras =
    cctvSweep.inSectorCameras.length > 0
      ? cctvSweep.inSectorCameras.slice(0, 12)
      : cctvSweep.globalHubShowcase;

  const gridBadgeIsElevated =
    telemetry?.infrastructureAndGrid?.threatLevel === 'BRAVO' ||
    telemetry?.infrastructureAndGrid?.threatLevel === 'ALPHA';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-7xl bg-[#090d16] border-2 border-cyan-500/60 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.25)] text-slate-100 flex flex-col max-h-[94vh] overflow-hidden font-mono">
        {/* Top Tactical Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-950 via-cyan-950/40 to-slate-950 border-b border-cyan-500/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-cyan-500/15 border border-cyan-400/50 text-cyan-300">
              <Radar className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold tracking-wider text-cyan-300 uppercase">
                  Multi-INT Threat Matrix &amp; Live Recon Command
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  GLOBAL + LOCAL LIVE TELEMETRY
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Precision Z:18 Hybrid Satellite • Live Public CCTV Feeds • ADS-B Airspace • USGS / NASA EONET • CISA KEV
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {telemetry?.infrastructureAndGrid && (
              <div
                className={`px-2.5 py-1 rounded text-[11px] font-bold tracking-wider uppercase flex items-center gap-1.5 border ${
                  gridBadgeIsElevated
                    ? 'bg-amber-500/20 text-amber-300 border-amber-400/60 shadow-[0_0_15px_rgba(245,158,11,0.3)] animate-pulse'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{telemetry.infrastructureAndGrid.threatBadge}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded bg-slate-800/80 hover:bg-red-900/50 text-slate-300 hover:text-red-200 border border-slate-700 transition-colors cursor-pointer"
              title="Close Threat Monitor"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* User Interaction Control Bar */}
        <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-3 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1">
            <div>
              <label
                htmlFor="threat-operational-zone"
                className="block text-[10px] uppercase tracking-wider text-cyan-400 font-bold mb-1 flex items-center gap-1"
              >
                <Compass className="w-3 h-3" /> Target Focus (Operational Zone)
              </label>
              <select
                id="threat-operational-zone"
                name="operational_zone"
                value={selectedZone}
                onChange={(e) => {
                  setCustomLocation('');
                  setResolvedCustomCoords(null);
                  setSelectedZone(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-cyan-500/50 rounded text-slate-100 focus:outline-none focus:border-cyan-400"
              >
                {DEFAULT_ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="threat-custom-location"
                className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1 cursor-pointer"
              >
                <Globe className="w-3 h-3 text-cyan-400" /> Street, Postal Code, City, or Lat,Lon
              </label>
              <div className="flex gap-1.5">
                <input
                  id="threat-custom-location"
                  name="custom_location"
                  type="text"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchThreatMatrix(selectedZone, customLocation);
                  }}
                  placeholder="e.g., SW1A 1AA, 90210, Port of LA, 51.5074, -0.1278"
                  autoComplete="off"
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="button"
                  onClick={() => fetchThreatMatrix(selectedZone, customLocation)}
                  disabled={isLoading}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-xs font-bold shrink-0 cursor-pointer"
                  title="Pinpoint & Refresh Zone Telemetry"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="threat-lead-operative"
                className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1"
              >
                <Cpu className="w-3 h-3 text-purple-400" /> Lead Recon Operative
              </label>
              <select
                id="threat-lead-operative"
                name="lead_operative"
                value={selectedOperative}
                onChange={(e) => setSelectedOperative(e.target.value as any)}
                className="w-full px-2.5 py-1.5 text-xs bg-slate-950 border border-purple-500/50 rounded text-slate-100 focus:outline-none focus:border-purple-400"
              >
                <option value="Agent Nyx">Agent Nyx (Signals, Airspace &amp; Deep OSINT Sweep)</option>
                <option value="Agent Vance">Agent Vance (Strategic Grid, CVE &amp; Threat Dossier)</option>
                <option value="Agent Cipher">Agent Cipher (Macro-to-Micro Latency &amp; Vault Failover)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleRunAutonomousReconSweep}
              disabled={isRunningSweep || isLoading}
              className="w-full lg:w-auto px-4 py-2 rounded font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-300/60 shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Radar className={`w-4 h-4 ${isRunningSweep ? 'animate-spin' : ''}`} />
              <span>{isRunningSweep ? 'Executing Multi-INT Sweep...' : 'Run Recon Sweep'}</span>
            </button>
          </div>
        </div>

        {/* Global + Local Live Situational Telemetry Ribbon */}
        <div className="px-4 py-1.5 bg-[#050910] border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[10px] shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-cyan-500/40 text-cyan-300 font-bold">
              ☀ NOAA SWPC: Kp {globalMacro?.spaceWeather?.kpIndex ?? '--'} (
              {globalMacro?.spaceWeather?.stormLevel || 'LIVE'})
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-amber-500/40 text-amber-300 font-bold">
              🌍 GLOBAL 24H: {globalMacro?.seismicCount24h ?? 0} USGS SEISMIC •{' '}
              {globalMacro?.eonetActiveCount ?? 0} EONET HAZARDS
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-900 border border-sky-500/40 text-sky-300 font-bold flex items-center gap-1">
              <Plane className="w-3 h-3" />
              <span>
                SECTOR AIR: {airspaceSummary.totalCount} ADS-B ({airspaceSummary.tacticalCount} MIL/TAC)
              </span>
            </span>
            <button
              type="button"
              onClick={() => setActivePillarTab('cctv')}
              className="px-2 py-0.5 rounded bg-teal-950/80 hover:bg-teal-900 border border-teal-400/60 text-teal-200 font-bold flex items-center gap-1 cursor-pointer"
            >
              <Video className="w-3 h-3" />
              <span>
                LIVE CCTV: {cctvSweep.inSectorCameras.length > 0 ? `${cctvSweep.inSectorCameras.length} IN-SECTOR` : `${cctvSweep.totalCatalogCount} GLOBAL`}
              </span>
            </button>
            {localEnv && (
              <span className="px-2 py-0.5 rounded bg-slate-900 border border-emerald-500/40 text-emerald-300 flex items-center gap-1">
                <Wind className="w-3 h-3" />
                <span>
                  {localEnv.temperatureC ?? '--'}°C • {localEnv.windSpeedKts ?? '--'}kt@{localEnv.windDirectionDeg ?? '--'}° • CLD {localEnv.cloudCoverPct ?? '--'}% • AQI {localEnv.usAqi ?? '--'}
                </span>
              </span>
            )}
          </div>
          <span className="text-rose-300 font-bold">
            🛡️ CISA KEV: {globalMacro?.cisaKevLatest?.[0]?.cveID || 'SYNCED'} (
            {globalMacro?.cisaKevLatest?.[0]?.dateAdded || 'LIVE'})
          </span>
        </div>

        {/* Local Geofencing & 60s High Alert Rapid Ingest Strip */}
        <div className="px-4 py-1.5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-emerald-400 font-bold uppercase tracking-wider text-[10px]">
              GEOFENCE:
            </span>
            <label htmlFor="geofence-lat-input" className="text-slate-400 text-[10px]">
              LAT
            </label>
            <input
              id="geofence-lat-input"
              name="geofence_lat"
              type="number"
              step="0.0001"
              value={geofence.lat}
              onChange={(e) => {
                const next = saveLocalGeofenceConfig({ lat: Number(e.target.value) });
                setGeofence(next);
              }}
              className="w-24 px-1.5 py-0.5 bg-black border border-slate-700 rounded text-emerald-300 text-[11px]"
            />
            <label htmlFor="geofence-lon-input" className="text-slate-400 text-[10px]">
              LON
            </label>
            <input
              id="geofence-lon-input"
              name="geofence_lon"
              type="number"
              step="0.0001"
              value={geofence.lon}
              onChange={(e) => {
                const next = saveLocalGeofenceConfig({ lon: Number(e.target.value) });
                setGeofence(next);
              }}
              className="w-24 px-1.5 py-0.5 bg-black border border-slate-700 rounded text-emerald-300 text-[11px]"
            />
            <label htmlFor="geofence-radius-input" className="text-slate-400 text-[10px]">
              RADIUS(KM)
            </label>
            <input
              id="geofence-radius-input"
              name="geofence_radius_km"
              type="number"
              min="1"
              max="500"
              value={geofence.radiusKm}
              onChange={(e) => {
                const next = saveLocalGeofenceConfig({ radiusKm: Number(e.target.value) });
                setGeofence(next);
              }}
              className="w-16 px-1.5 py-0.5 bg-black border border-slate-700 rounded text-emerald-300 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const nextVal = !highAlert;
                setHighAlert(nextVal);
                setHighAlertMode(nextVal);
                setGeofence(saveLocalGeofenceConfig({ highAlertMode: nextVal }));
                if (nextVal) {
                  const res = await fetchLocalDispatchFeeds({ logToLedger: true });
                  setSweepStatusBanner({
                    message: `HIGH ALERT MODE ARMED (60s rapid poll) — polled ${res.feedsPolled} local feed(s), ${res.incidents.length} bounded incident(s).`,
                    type: 'warning',
                  });
                } else {
                  setSweepStatusBanner({
                    message: 'High Alert Mode set to standby (180s interval).',
                    type: 'info',
                  });
                }
              }}
              className={`px-2.5 py-1 rounded font-bold text-[10px] uppercase tracking-wider border cursor-pointer transition-colors ${
                highAlert
                  ? 'bg-red-950/90 text-red-300 border-red-500 animate-pulse'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500/60'
              }`}
            >
              {highAlert ? '● HIGH ALERT: 60s POLL ON' : '○ HIGH ALERT MODE (60s)'}
            </button>
            <button
              type="button"
              disabled={isRunningPreMedia}
              onClick={async () => {
                setIsRunningPreMedia(true);
                try {
                  const report = await runPreMediaLocalizedThreatSweep({
                    lat: geofence.lat,
                    lon: geofence.lon,
                    radiusKm: geofence.radiusKm,
                    ingestIntoCorroboration: true,
                  });
                  setPreMediaReport(report);
                  setSweepStatusBanner({
                    message: `PRE-MEDIA SWEEP COMPLETE — CAD/NWS: ${report.municipalDispatches.length} | ADS-B Tactical: ${report.adsbTacticalContacts.length}/${report.adsbTotalAircraft} | Plume: ${report.plumeReading?.anomalyDetected ? report.plumeReading.anomalyType : 'NOMINAL'} | Corroborated: ${report.corroboration.activeCorroboratedCount}`,
                    type: report.corroboration.activeCorroboratedCount > 0 ? 'warning' : 'success',
                  });
                } finally {
                  setIsRunningPreMedia(false);
                }
              }}
              className="px-2.5 py-1 rounded font-bold text-[10px] uppercase tracking-wider border cursor-pointer transition-colors bg-cyan-950/80 text-cyan-200 border-cyan-500/60 hover:bg-cyan-900/70 disabled:opacity-50"
            >
              {isRunningPreMedia
                ? '⟳ SWEEPING PRE-MEDIA...'
                : '⚡ PRE-MEDIA SWEEP (CAD + ADS-B + PLUME)'}
            </button>
          </div>
        </div>

        {/* Live Pre-Media Scanner Triage & Custom County CAD Ingress Strip */}
        <div className="px-4 py-1.5 bg-[#070b11] border-b border-slate-800/80 flex flex-col gap-1.5 text-[11px] font-mono shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-cyan-400 font-bold uppercase tracking-wider text-[10px]">
              SCANNER / 911 CAD TRIAGE:
            </span>
            {isRadioScannerDisabledForNai({
              lat: geofence.lat,
              lon: geofence.lon,
              jurisdiction: 'AUTO',
            }) ? (
              <div className="flex-1 min-w-[240px] px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold flex items-center gap-2">
                <Lock size={12} className="text-emerald-400 shrink-0" />
                <span>{UK_WTA_2006_SAFE_MODE_LABEL}</span>
                <span className="text-emerald-400/70 font-normal hidden sm:inline">
                  (Private VHF/UHF radio scanner modules hard-disabled; UK EA Floods, TfL JamCams &amp; WebTRIS active)
                </span>
              </div>
            ) : (
              <>
                <input
                  id="scanner-transcript-input"
                  name="scanner_transcript"
                  type="text"
                  value={scannerTranscriptInput}
                  onChange={(e) => setScannerTranscriptInput(e.target.value)}
                  placeholder="Paste live scanner / OpenMHz / Broadcastify dispatch transcript for instant Gemini 3.1 Flash Lite triage..."
                  className="flex-1 min-w-[220px] px-2 py-1 bg-black border border-slate-700 rounded text-slate-200 text-[11px]"
                />
                <button
                  type="button"
                  disabled={isTriagingScanner || !scannerTranscriptInput.trim()}
                  onClick={async () => {
                    if (!scannerTranscriptInput.trim()) return;
                    setIsTriagingScanner(true);
                    try {
                      const triage = await analyzeDispatchSignal({
                        transcript: scannerTranscriptInput.trim(),
                        lat: geofence.lat,
                        lon: geofence.lon,
                        sectorKey: geofence.label,
                        sourceLabel: 'OPERATOR_SCANNER_INTERCEPT',
                        ingestIntoSwarm: true,
                      });
                      setSweepStatusBanner({
                        message: `SCANNER TRIAGE [${triage.severity} // ${triage.type}]: ${triage.summary}${
                          triage.packetId ? ` (packet ${triage.packetId.slice(0, 10)}…)` : ''
                        }`,
                        type: triage.threatDetected ? 'warning' : 'info',
                      });
                      setScannerTranscriptInput('');
                    } finally {
                      setIsTriagingScanner(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-amber-950/80 hover:bg-amber-900/70 border border-amber-500/60 text-amber-200 font-bold text-[10px] uppercase cursor-pointer disabled:opacity-40"
                >
                  {isTriagingScanner ? 'TRIAGING...' : 'TRIAGE & INGEST'}
                </button>
              </>
            )}

            <input
              id="custom-cad-url-input"
              name="custom_cad_url"
              type="url"
              value={customCadFeedInput}
              onChange={(e) => setCustomCadFeedInput(e.target.value)}
              placeholder="Add County CAD / PulsePoint / OpenMHz RSS or JSON URL..."
              className="w-60 px-2 py-1 bg-black border border-slate-700 rounded text-slate-200 text-[11px]"
            />
            <button
              type="button"
              disabled={!customCadFeedInput.trim()}
              onClick={() => {
                const url = customCadFeedInput.trim();
                if (!url) return;
                const nextUrls = Array.from(new Set([...(geofence.dispatchFeedUrls || []), url]));
                const updated = saveLocalGeofenceConfig({ dispatchFeedUrls: nextUrls });
                setGeofence(updated);
                setCustomCadFeedInput('');
                setSweepStatusBanner({
                  message: `Registered live municipal CAD/scanner feed (${nextUrls.length} active custom endpoint(s)).`,
                  type: 'success',
                });
              }}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300 font-bold text-[10px] uppercase cursor-pointer disabled:opacity-40"
            >
              + ADD CAD ({geofence.dispatchFeedUrls?.length || 0})
            </button>
          </div>

          {preMediaReport && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px]">
              <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="text-slate-400">911 CAD &amp; NWS CAP</div>
                <div className="text-emerald-300 font-bold">
                  {preMediaReport.municipalDispatches.length} bounded alert(s)
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="text-slate-400">ADS-B AIRSPACE</div>
                <div className="text-cyan-300 font-bold">
                  {preMediaReport.adsbTacticalContacts.length} tactical / {preMediaReport.adsbTotalAircraft} total
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="text-slate-400">PLUME / AIR SENSOR</div>
                <div
                  className={
                    preMediaReport.plumeReading?.anomalyDetected
                      ? 'text-red-300 font-bold'
                      : 'text-emerald-300 font-bold'
                  }
                >
                  {preMediaReport.plumeReading
                    ? `${
                        preMediaReport.plumeReading.anomalyType === 'NONE'
                          ? 'NOMINAL'
                          : preMediaReport.plumeReading.anomalyType
                      }${
                        preMediaReport.plumeReading.usAqi !== null
                          ? ` (AQI ${preMediaReport.plumeReading.usAqi})`
                          : ''
                      }`
                    : 'OFFLINE'}
                </div>
              </div>
              <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                <div className="text-slate-400">SWARM CORROBORATION</div>
                <div className="text-amber-300 font-bold">
                  {preMediaReport.corroboration.activeCorroboratedCount} corroborated (
                  {preMediaReport.corroboration.packetsIngested} pkts)
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Status / Vault Save Banner */}
        {sweepStatusBanner && (
          <div
            className={`px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-b shrink-0 ${
              sweepStatusBanner.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                : sweepStatusBanner.type === 'warning'
                ? 'bg-amber-950/70 border-amber-500/50 text-amber-200'
                : 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{sweepStatusBanner.message}</span>
            </div>
            <div className="flex items-center gap-2">
              {sweepStatusBanner.savedPath && onOpenVaultFile && (
                <button
                  type="button"
                  onClick={() => onOpenVaultFile(sweepStatusBanner.savedPath)}
                  className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-200 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <FileText className="w-3 h-3" /> Open Dossier in VFS Vault
                </button>
              )}
              <button
                type="button"
                onClick={() => setSweepStatusBanner(null)}
                className="text-slate-400 hover:text-white text-[11px] px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Pillar Filter Tabs */}
        <div className="px-4 py-1.5 bg-slate-950 border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'all', label: 'All Pillars + Live Recon', icon: Globe },
            { id: 'satellite', label: '🛰️ Full Satellite & ADS-B Monitor', icon: Radar },
            {
              id: 'cctv',
              label: `📹 Live CCTV & Street Recon (${
                cctvSweep.inSectorCameras.length || cctvSweep.totalCatalogCount
              })`,
              icon: Video,
            },
            { id: 'correlation', label: '1. Global-to-Local Matrix', icon: ShieldAlert },
            { id: 'grid', label: '2. Grid & Weather Envelope', icon: Zap },
            { id: 'cyber', label: '3. CISA KEV Cyber Radar', icon: Lock },
            { id: 'supply', label: '4. Airspace & Chokepoints', icon: Truck },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activePillarTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActivePillarTab(tab.id as any)}
                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/60'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Main Content Scroll Area */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1 bg-[#070b12]">
          {/* Live Tactical Satellite, Hybrid Street Labels, ADS-B & CCTV Monitor */}
          {(activePillarTab === 'all' || activePillarTab === 'satellite') && (
            <TacticalSatelliteMonitor
              initialLat={activeCoords.lat}
              initialLon={activeCoords.lon}
              initialLabel={
                resolvedCustomCoords?.label ??
                parseReconTargetToCoords(customLocation)?.label ??
                telemetry?.operationalZone?.label ??
                'US-East Backbone & PJM Grid'
              }
              initialSectorCode={
                resolvedCustomCoords?.sectorCode ??
                parseReconTargetToCoords(customLocation)?.sectorCode ??
                `SECTOR-${selectedZone.toUpperCase()}`
              }
              activeOperativeName={selectedOperative}
              threatBadgeText={
                telemetry?.infrastructureAndGrid?.threatBadge ||
                'THREAT LEVEL: CHARLIE - LIVE OVERWATCH'
              }
              compact={activePillarTab === 'all'}
              onViewportTargetSync={(coords) => {
                const updatedGeo = saveLocalGeofenceConfig({
                  lat: coords.lat,
                  lon: coords.lon,
                  label: coords.label,
                });
                setGeofence(updatedGeo);
                fetchThreatMatrix(selectedZone, `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, {
                  lat: coords.lat,
                  lon: coords.lon,
                  label: coords.label,
                });
              }}
              onDispatchReconDirective={(directive, coords) => {
                setCustomLocation(`${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);
                fetchThreatMatrix(selectedZone, `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, {
                  lat: coords.lat,
                  lon: coords.lon,
                  label: coords.label,
                });
                setSweepStatusBanner({
                  message: `Recon Monitor locked onto ${coords.label} [${coords.lat.toFixed(
                    5
                  )}°, ${coords.lon.toFixed(5)}°] for directive: "${directive}"`,
                  type: 'info',
                });
              }}
            />
          )}

          {/* Dedicated Live CCTV & Street Recon Multi-Cam Wall */}
          {activePillarTab === 'cctv' && (
            <div className="recon-containment-pillar bg-slate-900/95 border border-emerald-500/50 rounded-lg p-4 space-y-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                    <Video className="w-4 h-4 text-emerald-400" />
                    <span>
                      {cctvSweep.inSectorCameras.length > 0
                        ? `Live In-Sector Municipal & DOT CCTV Wall (${cctvSweep.inSectorCameras.length} Active Cameras within 140 km)`
                        : `Global Strategic Chokepoint & Capital Live CCTV Wall (${cctvSweep.totalCatalogCount} Live Cameras Indexed)`}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Zero-mock live traffic, port approach, and civic camera feeds (TfL London MP4/JPEG, Caltrans Port of LA &amp; San Diego, Austin TX DOT, Singapore LTA HD, Digitraffic Baltic, US I-80).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCctvNvgMode((v) => !v)}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                      cctvNvgMode
                        ? 'bg-emerald-900 text-emerald-200 border-emerald-400'
                        : 'bg-slate-950 text-slate-300 border-slate-700'
                    }`}
                  >
                    {cctvNvgMode ? '🟢 NVG SHADER: ON' : '⚪ NVG SHADER: OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCctvRefreshTick((t) => t + 1)}
                    className="px-2.5 py-1 rounded text-[11px] font-bold bg-cyan-950 hover:bg-cyan-900 text-cyan-200 border border-cyan-500/60 cursor-pointer"
                  >
                    ↻ Refresh Live Frames
                  </button>
                </div>
              </div>

              {/* 1-Click Strategic CCTV Hub Selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                <span className="text-[10px] font-bold uppercase text-cyan-400 shrink-0 mr-1">
                  Switch Live CCTV Sector:
                </span>
                {CCTV_STRATEGIC_HUBS.map((hub) => (
                  <button
                    key={hub.id}
                    type="button"
                    onClick={() => {
                      setCustomLocation(`${hub.lat.toFixed(4)}, ${hub.lon.toFixed(4)}`);
                      setPrimaryNaiZone({
                        lat: hub.lat,
                        lon: hub.lon,
                        label: hub.label,
                      }).catch(() => {});
                      fetchThreatMatrix(selectedZone, `${hub.lat.toFixed(4)}, ${hub.lon.toFixed(4)}`, {
                        lat: hub.lat,
                        lon: hub.lon,
                        label: hub.label,
                        sectorCode: hub.sectorCode,
                      });
                    }}
                    className="px-2.5 py-1 rounded bg-slate-950 hover:bg-teal-950 text-teal-200 border border-teal-500/40 text-[10px] font-bold whitespace-nowrap cursor-pointer"
                  >
                    {hub.shortTag}
                  </button>
                ))}
              </div>

              {/* Register Custom Live Camera Stream */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customWallCamUrl.trim()) return;
                  const list = addCustomCctvCamera({
                    name:
                      customWallCamName.trim() ||
                      `Custom Cam (${activeCoords.lat.toFixed(3)}, ${activeCoords.lon.toFixed(3)})`,
                    lat: activeCoords.lat,
                    lon: activeCoords.lon,
                    streamUrl: customWallCamUrl.trim(),
                  });
                  setCustomWallCamName('');
                  setCustomWallCamUrl('');
                  fetchLiveCctvForSector(activeCoords.lat, activeCoords.lon, 140, true).then(
                    setCctvSweep
                  );
                  if (list[0]) setSelectedWallCam(list[0]);
                }}
                className="p-2.5 rounded bg-slate-950 border border-slate-800 flex flex-wrap items-center gap-2 text-xs"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <input
                  id="threat-custom-cam-name"
                  name="threat_custom_cam_name"
                  type="text"
                  value={customWallCamName}
                  onChange={(e) => setCustomWallCamName(e.target.value)}
                  placeholder="Custom Camera Label (optional)"
                  className="w-48 px-2 py-1 bg-black border border-slate-700 rounded text-slate-100 text-[11px]"
                />
                <input
                  id="threat-custom-cam-url"
                  name="threat_custom_cam_url"
                  type="url"
                  value={customWallCamUrl}
                  onChange={(e) => setCustomWallCamUrl(e.target.value)}
                  placeholder="Paste custom public live camera URL (.jpg, .mjpeg, .mp4, .m3u8)..."
                  className="flex-1 min-w-[220px] px-2 py-1 bg-black border border-slate-700 rounded text-slate-100 text-[11px]"
                />
                <button
                  type="submit"
                  disabled={!customWallCamUrl.trim()}
                  className="px-3 py-1 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/60 text-emerald-100 text-[11px] font-bold cursor-pointer disabled:opacity-40"
                >
                  + Pin Camera to Sector
                </button>
              </form>

              {/* Featured Expanded Camera Stream (if clicked) */}
              {selectedWallCam && (
                <div className="p-3 rounded-lg bg-black border-2 border-emerald-400/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-emerald-300">
                        🎥 ACTIVE PRIMARY FEED: {selectedWallCam.name}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-2">
                        ({selectedWallCam.networkLabel} • {selectedWallCam.lat.toFixed(5)}°,{' '}
                        {selectedWallCam.lon.toFixed(5)}°)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          fetchThreatMatrix(
                            selectedZone,
                            `${selectedWallCam.lat.toFixed(5)}, ${selectedWallCam.lon.toFixed(5)}`,
                            {
                              lat: selectedWallCam.lat,
                              lon: selectedWallCam.lon,
                              label: selectedWallCam.name,
                            }
                          );
                          setActivePillarTab('satellite');
                        }}
                        className="px-2.5 py-1 rounded bg-sky-950 hover:bg-sky-900 border border-sky-500/60 text-sky-200 text-[10px] font-bold cursor-pointer"
                      >
                        [🛰️ Lock Satellite Z:16 on Camera]
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedWallCam(null)}
                        className="px-2 py-1 rounded bg-slate-900 text-slate-300 text-[10px] cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div
                    className={`w-full max-h-[400px] aspect-video bg-slate-950 rounded overflow-hidden flex items-center justify-center ${
                      cctvNvgMode ? 'tactical-satellite-monitor' : ''
                    }`}
                  >
                    {selectedWallCam.videoUrl && selectedWallCam.streamType === 'MP4_CLIP' ? (
                      <video
                        key={`${selectedWallCam.id}-wall-vid-${cctvRefreshTick}`}
                        src={selectedWallCam.videoUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        controls
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <img
                        src={buildFreshCameraImageUrl(selectedWallCam, cctvRefreshTick)}
                        alt={selectedWallCam.name}
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Multi-Cam Live Feed Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {cctvWallCameras.map((cam) => (
                  <div
                    key={cam.id}
                    className="bg-slate-950 border border-slate-800 hover:border-emerald-400/70 rounded-md overflow-hidden flex flex-col justify-between transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedWallCam(cam)}
                      className="text-left w-full cursor-pointer"
                    >
                      <div
                        className={`relative w-full aspect-video bg-black overflow-hidden ${
                          cctvNvgMode ? 'tactical-satellite-monitor' : ''
                        }`}
                      >
                        <img
                          src={buildFreshCameraImageUrl(cam, cctvRefreshTick)}
                          alt={cam.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 border border-red-500/60 text-[9px] font-bold text-red-300 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                          <span>{cam.networkLabel}</span>
                        </span>
                        {cam.streamType === 'MP4_CLIP' && (
                          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-400/60 text-[8.5px] font-bold text-emerald-200">
                            ▶ MP4 VIDEO
                          </span>
                        )}
                      </div>
                      <div className="p-2 space-y-0.5">
                        <div className="text-xs font-bold text-slate-100 truncate">{cam.name}</div>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span>{cam.regionLabel}</span>
                          {cam.distanceKm !== undefined && (
                            <span className="text-cyan-300 font-bold">{cam.distanceKm} km</span>
                          )}
                        </div>
                      </div>
                    </button>
                    <div className="px-2 pb-2 flex items-center justify-between gap-1 text-[9.5px]">
                      <span className="text-slate-500">
                        {cam.lat.toFixed(4)}°, {cam.lon.toFixed(4)}°
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          fetchThreatMatrix(
                            selectedZone,
                            `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}`,
                            {
                              lat: cam.lat,
                              lon: cam.lon,
                              label: cam.name,
                            }
                          );
                          setActivePillarTab('satellite');
                        }}
                        className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-sky-950 text-sky-300 border border-slate-700 font-bold cursor-pointer"
                      >
                        🎯 Map Lock
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4-Pillar Intelligence Grid */}
          {activePillarTab !== 'satellite' && activePillarTab !== 'cctv' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* PILLAR 1: THREAT CORRELATION MATRIX */}
              {(activePillarTab === 'all' || activePillarTab === 'correlation') && (
                <div className="recon-containment-pillar bg-slate-900/90 border border-cyan-500/40 rounded-lg p-4 flex flex-col justify-between shadow-lg">
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-cyan-300">
                          1. Global-to-Local Threat Correlation Matrix
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold">
                        LIVE USGS + EONET + SWPC
                      </span>
                    </div>

                    <div className="space-y-3">
                      {(telemetry?.threatCorrelationMatrix || []).map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded bg-slate-950/90 border border-slate-800 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              LIVE EVENT • {item.severity}
                            </span>
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-cyan-400 hover:underline flex items-center gap-1"
                            >
                              <span>{item.sourceCitation}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          </div>

                          <p className="text-xs font-bold text-slate-100 leading-snug">
                            {item.globalEvent}
                          </p>

                          <div className="p-2 rounded bg-cyan-950/30 border-l-2 border-cyan-400 text-[11px] text-cyan-100">
                            <span className="font-bold text-cyan-300 uppercase block text-[10px] mb-0.5">
                              ⚡ Sector Impact Correlation ({item.operative}):
                            </span>
                            {item.trickleDownImpact}
                          </div>

                          <div className="p-2 rounded bg-emerald-950/30 border-l-2 border-emerald-400 text-[11px] text-emerald-100">
                            <span className="font-bold text-emerald-300 uppercase block text-[10px] mb-0.5">
                              🎯 Actionable Output:
                            </span>
                            {item.actionableOutput}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleImmediateVaultBackup}
                      className="px-3 py-1.5 rounded text-[11px] font-bold bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/50 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Backup Local Vault Immediately</span>
                    </button>
                    {onOpenLlmSettings && (
                      <button
                        type="button"
                        onClick={onOpenLlmSettings}
                        className="px-3 py-1.5 rounded text-[11px] font-bold bg-cyan-600/20 hover:bg-cyan-600/35 text-cyan-200 border border-cyan-500/50 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Switch Primary LLM Endpoint</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* PILLAR 2: INFRASTRUCTURE, WEATHER & GRID STABILITY */}
              {(activePillarTab === 'all' || activePillarTab === 'grid') &&
                telemetry?.infrastructureAndGrid && (
                  <div className="recon-containment-pillar bg-slate-900/90 border border-amber-500/40 rounded-lg p-4 flex flex-col justify-between shadow-lg">
                    <div>
                      <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-amber-400" />
                          <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-amber-300">
                            2. Infrastructure, Weather &amp; Grid Stability
                          </h3>
                        </div>
                        <span className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          {telemetry.infrastructureAndGrid.threatBadge}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 text-[11px]">
                        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                          <span className="text-[10px] text-slate-400 uppercase block">
                            Monitored Energy Grid
                          </span>
                          <span className="font-bold text-slate-100">
                            {telemetry.infrastructureAndGrid.monitoredGrid}
                          </span>
                          <span className="block text-[10px] text-emerald-400 mt-0.5">
                            {telemetry.infrastructureAndGrid.frequencyHz}
                          </span>
                        </div>
                        <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
                          <span className="text-[10px] text-slate-400 uppercase block">
                            Target Atmospheric &amp; Backbone Status
                          </span>
                          <span className="font-bold text-slate-100">
                            {telemetry.infrastructureAndGrid.ispBackboneStatus}
                          </span>
                          <span className="block text-[10px] text-cyan-400 mt-0.5 truncate">
                            {telemetry.infrastructureAndGrid.backboneHealth}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Live Environmental &amp; Substation Telemetry:
                        </span>
                        {telemetry.infrastructureAndGrid.activeAdvisories.map((adv) => (
                          <div
                            key={adv.id}
                            className="p-2.5 rounded bg-slate-950/90 border border-slate-800 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-bold text-amber-200">{adv.title}</span>
                              <a
                                href={adv.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-cyan-400 hover:underline shrink-0 flex items-center gap-0.5"
                              >
                                <span>{adv.source}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                            <p className="text-[11px] text-slate-300">{adv.impact}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">
                        Exports localized UPS/comms resilience briefing to VFS Vault
                      </span>
                      <button
                        type="button"
                        onClick={handleGeneratePreparednessBriefing}
                        className="px-3 py-1.5 rounded text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/35 text-amber-200 border border-amber-400/50 flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Generate Preparedness Briefing &rarr; Vault</span>
                      </button>
                    </div>
                  </div>
                )}

              {/* PILLAR 3: LIVE CISA KEV CYBER RADAR */}
              {(activePillarTab === 'all' || activePillarTab === 'cyber') && (
                <div className="recon-containment-pillar bg-slate-900/90 border border-rose-500/40 rounded-lg p-4 flex flex-col justify-between shadow-lg">
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Lock className="w-4 h-4 text-rose-400" />
                        <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-rose-300">
                          3. Live CISA KEV Cyber Vulnerability Radar
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                        CISA KEV LIVE • AGENT VANCE
                      </span>
                    </div>

                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                      {(telemetry?.cyberThreatRadar || []).map((vuln) => (
                        <div
                          key={vuln.id}
                          className="p-3 rounded bg-slate-950/90 border border-slate-800 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              {vuln.cveId} • {vuln.severity}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              Added: {vuln.dateAdded}
                            </span>
                          </div>

                          <p className="text-xs font-bold text-slate-100">{vuln.title}</p>
                          <p className="text-[11px] text-slate-300 leading-relaxed">
                            {vuln.summary}
                          </p>

                          <div className="p-2 rounded bg-rose-950/25 border border-rose-500/30">
                            <span className="text-[10px] font-bold uppercase text-rose-300 block mb-1">
                              🛡️ Agent Vance Remediation Checklist:
                            </span>
                            <ul className="space-y-1 text-[11px] text-slate-200 list-disc list-inside">
                              {vuln.remediationChecklist.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleFlagCveInTerminal(vuln)}
                              className="px-2.5 py-1 rounded text-[10px] font-bold bg-rose-500/20 hover:bg-rose-500/35 text-rose-200 border border-rose-400/50 flex items-center gap-1 cursor-pointer"
                            >
                              <Terminal className="w-3 h-3" />
                              <span>Flag in Terminal Feed &amp; Save Checklist</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* PILLAR 4: LIVE AIRSPACE, CCTV & MARITIME CORRIDORS */}
              {(activePillarTab === 'all' || activePillarTab === 'supply') && (
                <div className="recon-containment-pillar bg-slate-900/90 border border-purple-500/40 rounded-lg p-4 flex flex-col justify-between shadow-lg">
                  <div>
                    <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-purple-400" />
                        <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-purple-300">
                          4. Live Airspace, CCTV &amp; Supply Corridors
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 text-[10px] rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold">
                        ADS-B • CCTV • MARITIME
                      </span>
                    </div>

                    <div className="space-y-3">
                      {(telemetry?.supplyChainDisruptions || []).map((sc) => (
                        <div
                          key={sc.id}
                          className="p-3 rounded bg-slate-950/90 border border-slate-800 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center gap-1">
                              {sc.category.includes('MARITIME') || sc.category.includes('CCTV') ? (
                                <Anchor className="w-3 h-3" />
                              ) : (
                                <Radio className="w-3 h-3" />
                              )}
                              <span>{sc.category}</span>
                            </span>
                            <span className="text-[10px] font-bold text-amber-300">
                              {sc.status}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400">
                            Corridor: <strong className="text-slate-200">{sc.chokepoint}</strong>
                          </div>

                          <p className="text-xs font-bold text-slate-100">{sc.headline}</p>

                          <div className="p-2 rounded bg-purple-950/25 border-l-2 border-purple-400 text-[11px] text-purple-100">
                            <span className="font-bold text-purple-300 uppercase block text-[10px] mb-0.5">
                              📦 Operational Recon Utility:
                            </span>
                            {sc.practicalImpact}
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                            <span>Source: {sc.source}</span>
                            {sc.id === 'live-cctv-corridor' ? (
                              <button
                                type="button"
                                onClick={() => setActivePillarTab('cctv')}
                                className="text-emerald-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <span>Open Live CCTV Wall &rarr;</span>
                              </button>
                            ) : (
                              <a
                                href={sc.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-cyan-400 hover:underline flex items-center gap-1"
                              >
                                <span>Inspect Live Feed</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Synced with Live ADS-B &amp; Public CCTV Grids</span>
                    <button
                      type="button"
                      onClick={handleRunAutonomousReconSweep}
                      disabled={isRunningSweep}
                      className="px-3 py-1 rounded bg-purple-500/20 hover:bg-purple-500/35 text-purple-200 border border-purple-400/50 font-bold text-[11px] cursor-pointer"
                    >
                      Compile Multi-INT Dossier
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
          <div>
            Active Recon Lock:{' '}
            <strong className="text-cyan-300">
              {telemetry?.operationalZone?.label || selectedZone}
            </strong>{' '}
            ({activeCoords.lat.toFixed(4)}°, {activeCoords.lon.toFixed(4)}°)
          </div>
          <div className="flex items-center gap-3">
            {onOpenVaultFile && (
              <button
                type="button"
                onClick={() => onOpenVaultFile()}
                className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Open VFS Vault (/intel/dossiers/)</span>
              </button>
            )}
            <span>
              Last Sync:{' '}
              {telemetry?.fetchedAt ? new Date(telemetry.fetchedAt).toLocaleTimeString() : 'Live'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatMonitorModal;
