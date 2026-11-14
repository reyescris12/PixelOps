import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPacketRawPayloadJson,
  nominateClusterPackage,
  dismissClusterFalsePositive,
  type CorroborationSourceTrack,
  type CorroborationClusterStatus,
  type VanceSynthesisOutput,
  type EffectorActionType,
} from '../services/CorroborationEngine';
import {
  latLonToContinuousWorldPx,
  canvasPixelToLatLon,
  panLatLonByCanvasPixels,
  zoomAroundCanvasPoint,
  haversineDistanceKm,
  calculateBearingDeg,
  type LiveAirspaceTrack,
  type LiveCctvCamera,
  type GlobalHazardEvent,
} from '../services/LiveReconFeedService';

export type TacticalLayerFilter =
  | 'ALL'
  | 'CORROBORATED_ONLY'
  | 'WIDE_AREA'
  | 'SIGNALS'
  | 'WIRES';

export interface TacticalProvenancePacket {
  packetId: string;
  sourceTrack: CorroborationSourceTrack;
  sourceType: string;
  sourceEndpoint: string;
  ingestedBy: string;
  capturedAt: string;
  ttlSeconds: number;
  rawPayloadRef: string;
  summaryHeadline: string;
  confidenceWeight: number;
}

export interface TacticalIntelPin {
  id: string;
  clusterId?: string;
  lat: number; // Geographic latitude (-85..85)
  lon: number; // Geographic longitude (-180..180)
  x?: number; // Optional fallback percentage (0..100)
  y?: number; // Optional fallback percentage (0..100)
  title: string;
  summary: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: string;
  capturedAt?: string;
  expiresAt?: string;
  category?: string;
  corroborationScore?: number;
  corroborationStatus?: CorroborationClusterStatus;
  sourceTracks?: CorroborationSourceTrack[];
  sourceCount?: number;
  vectorAzimuthDeg?: number;
  sitrepPath?: string;
  nominationId?: string;
  nominationStatus?:
    | 'UNNOMINATED'
    | 'PENDING_HUMAN_REVIEW'
    | 'NOMINATED_APPROVED'
    | 'DISMISSED_FALSE_POSITIVE';
  vanceSynthesis?: VanceSynthesisOutput;
  provenancePackets?: TacticalProvenancePacket[];
  admiraltyGrade?: string;
  adapterId?: string;
  observationTime?: string;
  firstIngestedAt?: string;
  lastMaterialChangeAt?: string;
  isKineticNonTectonic?: boolean;
  seismicTypeVerbatim?: string;
  isLifeSafetyA1?: boolean;
  spotlightedSummary?: string;
}

export interface TacticalOverlayVisibility {
  intelPins: boolean;
  adsbAirspace: boolean;
  adsbTacticalOnly: boolean;
  cctvNodes: boolean;
  globalHazards: boolean;
}

interface TacticalMapOverlayProps {
  intelligencePins?: TacticalIntelPin[];
  airspaceTracks?: LiveAirspaceTrack[];
  cctvCameras?: LiveCctvCamera[];
  globalHazards?: GlobalHazardEvent[];
  overlayVisibility?: TacticalOverlayVisibility;
  pinpointMode?: boolean;
  pinpointTarget?: { lat: number; lon: number; label?: string } | null;
  activeNai?: {
    label: string;
    lat: number;
    lon: number;
    radiusKm: number;
  } | null;
  centerLat: number;
  centerLon: number;
  zoom: number;
  maxZoom?: number;
  onSelectPin?: (pin: TacticalIntelPin | null) => void;
  onSelectCctv?: (camera: LiveCctvCamera) => void;
  onFlyToPin?: (pin: TacticalIntelPin) => void;
  onPanZoomChange?: (next: { lat: number; lon: number; zoom?: number; isDragging?: boolean }) => void;
  onCursorTelemetryChange?: (cursor: {
    lat: number;
    lon: number;
    distanceKm: number;
    bearingDeg: number;
  } | null) => void;
  onSpotPinpoint?: (spot: { lat: number; lon: number; lockCenter: boolean }) => void;
  onLockNaiAtCoords?: (coords: { lat: number; lon: number }) => void;
  onDispatchPinDirective?: (pin: TacticalIntelPin) => void;
  onClustersMutated?: () => void;
  suppressInlineDossier?: boolean;
  hideInternalFilterStrip?: boolean;
}

/**
 * Projects a geographic pin (lat, lon) onto the current viewport canvas (width, height)
 * centered at (centerLat, centerLon) at the given Web Mercator zoom level (Z:2..18).
 */
export function projectPinToCanvas(
  pin: Pick<TacticalIntelPin, 'lat' | 'lon' | 'x' | 'y'>,
  centerLat: number,
  centerLon: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number
): { px: number; py: number; isVisible: boolean } {
  if (typeof pin.lat === 'number' && typeof pin.lon === 'number') {
    const centerWorld = latLonToContinuousWorldPx(centerLat, centerLon, zoom);
    const pinWorld = latLonToContinuousWorldPx(pin.lat, pin.lon, zoom);

    let dx = pinWorld.wx - centerWorld.wx;
    const halfWorld = centerWorld.worldSize / 2;
    if (dx > halfWorld) dx -= centerWorld.worldSize;
    if (dx < -halfWorld) dx += centerWorld.worldSize;

    const dy = pinWorld.wy - centerWorld.wy;

    const px = canvasWidth / 2 + dx;
    const py = canvasHeight / 2 + dy;

    const margin = 48;
    const isVisible =
      px >= -margin &&
      px <= canvasWidth + margin &&
      py >= -margin &&
      py <= canvasHeight + margin;

    return { px, py, isVisible };
  }

  const px = ((pin.x ?? 50) / 100) * canvasWidth;
  const py = ((pin.y ?? 50) / 100) * canvasHeight;
  return { px, py, isVisible: true };
}

function resolvePinVisualTier(pin: TacticalIntelPin, nowMs: number): {
  tier: 'STALE' | 'CANDIDATE' | 'CORROBORATED' | 'CRITICAL_CONVERGENCE';
  score: number;
  srcCount: number;
} {
  const score =
    typeof pin.corroborationScore === 'number'
      ? pin.corroborationScore
      : pin.priority === 'HIGH'
      ? 0.35
      : 0.25;
  const srcCount = pin.sourceCount ?? pin.sourceTracks?.length ?? 1;
  const isExpired =
    pin.corroborationStatus === 'STALE' ||
    (Boolean(pin.expiresAt) && nowMs > Date.parse(pin.expiresAt!));

  if (isExpired) {
    return { tier: 'STALE', score, srcCount };
  }
  if (pin.corroborationStatus === 'CRITICAL_CONVERGENCE' || score >= 0.85) {
    return { tier: 'CRITICAL_CONVERGENCE', score, srcCount };
  }
  if (
    pin.corroborationStatus === 'CORROBORATED' ||
    pin.isLifeSafetyA1 ||
    srcCount >= 2 ||
    score >= 0.5
  ) {
    return { tier: 'CORROBORATED', score: Math.max(score, 0.55), srcCount };
  }
  return { tier: 'CANDIDATE', score, srcCount };
}

function formatObservationAge(iso: string | undefined, nowMs: number): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (isNaN(parsed)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}

function formatRemainingTtl(expiresAt: string | undefined, nowMs: number): {
  label: string;
  isStale: boolean;
} {
  if (!expiresAt) return { label: 'LIVE VFS DOSSIER', isStale: false };
  const diffSec = Math.floor((Date.parse(expiresAt) - nowMs) / 1000);
  if (isNaN(diffSec)) return { label: 'UNKNOWN TTL', isStale: false };
  if (diffSec <= 0) {
    const overdueSec = Math.abs(diffSec);
    const mins = Math.floor(overdueSec / 60);
    return {
      label: `STALE (+${mins}m ${overdueSec % 60}s past TTL)`,
      isStale: true,
    };
  }
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return {
    label: `TTL FRESH: ${mins}m ${String(secs).padStart(2, '0')}s`,
    isStale: false,
  };
}

const DEFAULT_VISIBILITY: TacticalOverlayVisibility = {
  intelPins: true,
  adsbAirspace: true,
  adsbTacticalOnly: false,
  cctvNodes: true,
  globalHazards: true,
};

export default function TacticalMapOverlay({
  intelligencePins = [],
  airspaceTracks = [],
  cctvCameras = [],
  globalHazards = [],
  overlayVisibility = DEFAULT_VISIBILITY,
  pinpointMode = false,
  pinpointTarget = null,
  activeNai = null,
  centerLat,
  centerLon,
  zoom,
  maxZoom = 18,
  onSelectPin,
  onSelectCctv,
  onFlyToPin,
  onPanZoomChange,
  onCursorTelemetryChange,
  onSpotPinpoint,
  onLockNaiAtCoords,
  onDispatchPinDirective,
  onClustersMutated,
  suppressInlineDossier = false,
  hideInternalFilterStrip = false,
}: TacticalMapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPin, setSelectedPin] = useState<TacticalIntelPin | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<LiveAirspaceTrack | null>(null);
  const [selectedHazard, setSelectedHazard] = useState<GlobalHazardEvent | null>(null);
  const [clickedSpot, setClickedSpot] = useState<{ lat: number; lon: number } | null>(null);
  const [activeLayerFilter, setActiveLayerFilter] = useState<TacticalLayerFilter>('ALL');
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const [rawJsonByPacketId, setRawJsonByPacketId] = useState<Record<string, string>>({});
  const [loadingRawPacketId, setLoadingRawPacketId] = useState<string | null>(null);
  const [selectedEffector, setSelectedEffector] =
    useState<EffectorActionType>('COMPOSIO_GITHUB_ISSUE');
  const [gateActionMessage, setGateActionMessage] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [isMutatingGate, setIsMutatingGate] = useState(false);
  const [isDraggingSurface, setIsDraggingSurface] = useState(false);
  const [liveA11yAnnouncement, setLiveA11yAnnouncement] = useState<string>('');

  // Pointer drag state ref (zero re-render overhead during 60FPS pointermove)
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLat: number;
    startLon: number;
    hasExceededThreshold: boolean;
  } | null>(null);

  const wheelAccumRef = useRef<number>(0);

  // Live 1-second timer while Provenance Drawer is open
  useEffect(() => {
    if (!selectedPin) return;
    setNowTickMs(Date.now());
    const id = setInterval(() => setNowTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [selectedPin]);

  // Escape key closes active inspector / drawer
  useEffect(() => {
    if (!selectedPin && !selectedAircraft && !selectedHazard && !clickedSpot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        updateSelectedPin(null);
        setSelectedAircraft(null);
        setSelectedHazard(null);
        setClickedSpot(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPin, selectedAircraft, selectedHazard, clickedSpot]);

  // Sync selectedPin when intelligencePins updates
  useEffect(() => {
    if (!selectedPin) return;
    const refreshed = intelligencePins.find((p) => p.id === selectedPin.id);
    if (refreshed) {
      setSelectedPin(refreshed);
      if (refreshed.vanceSynthesis?.recommendedEffectorPackage.actionType) {
        setSelectedEffector(refreshed.vanceSynthesis.recommendedEffectorPackage.actionType);
      }
    }
  }, [intelligencePins]);

  const updateSelectedPin = (nextPin: TacticalIntelPin | null) => {
    setSelectedPin(nextPin);
    if (nextPin) {
      setSelectedAircraft(null);
      setSelectedHazard(null);
      setClickedSpot(null);
    }
    setGateActionMessage(null);
    setRawJsonByPacketId({});
    if (nextPin?.vanceSynthesis?.recommendedEffectorPackage.actionType) {
      setSelectedEffector(nextPin.vanceSynthesis.recommendedEffectorPackage.actionType);
    }
    if (onSelectPin) {
      onSelectPin(nextPin);
    }
  };

  const visibleAirspaceTracks = useMemo(() => {
    if (!overlayVisibility.adsbAirspace) return [];
    if (overlayVisibility.adsbTacticalOnly) {
      return airspaceTracks.filter((t) => t.classification !== 'CIVIL');
    }
    return airspaceTracks;
  }, [airspaceTracks, overlayVisibility.adsbAirspace, overlayVisibility.adsbTacticalOnly]);

  const filteredPins = useMemo(() => {
    if (!overlayVisibility.intelPins) return [];
    const now = Date.now();
    return intelligencePins.filter((pin) => {
      if (pin.corroborationStatus === 'DISMISSED') return false;
      const { tier } = resolvePinVisualTier(pin, now);
      if (activeLayerFilter === 'CORROBORATED_ONLY') {
        return tier === 'CORROBORATED' || tier === 'CRITICAL_CONVERGENCE';
      }
      if (activeLayerFilter === 'WIDE_AREA') {
        return (
          Boolean(pin.sourceTracks?.includes('WIDE_AREA')) ||
          /seismic|maritime|recon|wide_area/i.test(pin.category || '')
        );
      }
      if (activeLayerFilter === 'SIGNALS') {
        return (
          Boolean(
            pin.sourceTracks?.includes('SIGNALS_INFRA') ||
              pin.sourceTracks?.includes('CYBER_CVE')
          ) || /infrastructure|signals|dns|cve/i.test(pin.category || '')
        );
      }
      if (activeLayerFilter === 'WIRES') {
        return (
          Boolean(pin.sourceTracks?.includes('WRITTEN_WIRE')) ||
          /wire|isw|sitrep/i.test(pin.category || '')
        );
      }
      return true;
    });
  }, [intelligencePins, activeLayerFilter, overlayVisibility.intelPins]);

  // Cursor-anchored mouse wheel / trackpad zoom listener (non-passive so scrolling inside canvas zooms cleanly)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onPanZoomChange) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAccumRef.current += e.deltaY;
      if (Math.abs(wheelAccumRef.current) < 65) return;

      const step = wheelAccumRef.current < 0 ? 1 : -1;
      wheelAccumRef.current = 0;

      const nextZ = Math.max(2, Math.min(maxZoom, zoom + step));
      if (nextZ === zoom) return;

      const rect = canvas.getBoundingClientRect();
      const anchorPx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width;
      const anchorPy = ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height;

      const zoomed = zoomAroundCanvasPoint(
        centerLat,
        centerLon,
        zoom,
        nextZ,
        anchorPx,
        anchorPy,
        canvas.width,
        canvas.height
      );
      onPanZoomChange({
        lat: zoomed.lat,
        lon: zoomed.lon,
        zoom: zoomed.zoom,
        isDragging: false,
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [centerLat, centerLon, zoom, maxZoom, onPanZoomChange]);

  // Render multi-layer intelligence vectors cleanly at 60 FPS on HTML5 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const syncCanvasSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth || 640;
      const h = parent.clientHeight || 360;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    syncCanvasSize();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(() => {
        syncCanvasSize();
      });
      resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('resize', syncCanvasSize);

    let animationFrameId: number;
    let pulseRadius = 11;
    let radarSweepAngle = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Subtle tactical graticule lines
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.07)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const gridSize = 48;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      const frameNow = Date.now();

      // 1b. Render Active NAI Center Reticle & Geofence Sector Perimeter
      if (activeNai && Number.isFinite(activeNai.lat) && Number.isFinite(activeNai.lon)) {
        const naiProj = projectPinToCanvas(
          { lat: activeNai.lat, lon: activeNai.lon },
          centerLat,
          centerLon,
          zoom,
          canvas.width,
          canvas.height
        );
        const zClamped = Math.max(2, Math.min(18, Math.round(zoom)));
        const metersPerPx =
          (156543.03392 * Math.max(0.15, Math.cos((activeNai.lat * Math.PI) / 180))) /
          Math.pow(2, zClamped);
        const radiusPx = Math.max(16, (activeNai.radiusKm * 1000) / Math.max(0.05, metersPerPx));

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.42)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(naiProj.px, naiProj.py, Math.min(radiusPx, 2400), 0, 2 * Math.PI);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(naiProj.px - 9, naiProj.py);
        ctx.lineTo(naiProj.px + 9, naiProj.py);
        ctx.moveTo(naiProj.px, naiProj.py - 9);
        ctx.lineTo(naiProj.px, naiProj.py + 9);
        ctx.stroke();

        if (naiProj.isVisible) {
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
          const naiTag = `[NAI: ${activeNai.label.slice(0, 22)} • ${activeNai.radiusKm}km]`;
          const tw = ctx.measureText(naiTag).width;
          ctx.fillStyle = 'rgba(2, 12, 8, 0.82)';
          ctx.fillRect(naiProj.px - tw / 2 - 3, naiProj.py + 11, tw + 6, 12);
          ctx.fillStyle = '#67e8f9';
          ctx.fillText(naiTag, naiProj.px - tw / 2, naiProj.py + 20);
        }
        ctx.restore();
      }

      // 2. Render Global Macro Hazards (USGS Worldwide Seismic + NASA EONET Wildfires/Volcanoes/Storms)
      if (overlayVisibility.globalHazards && globalHazards.length > 0) {
        for (const hz of globalHazards) {
          const proj = projectPinToCanvas(
            { lat: hz.lat, lon: hz.lon },
            centerLat,
            centerLon,
            zoom,
            canvas.width,
            canvas.height
          );
          if (!proj.isVisible) continue;
          const isHzSelected = selectedHazard?.id === hz.id;

          ctx.save();
          if (hz.category === 'WILDFIRE' || hz.category === 'VOLCANO') {
            ctx.fillStyle = hz.category === 'VOLCANO' ? 'rgba(239, 68, 68, 0.88)' : 'rgba(249, 115, 22, 0.85)';
            ctx.strokeStyle = isHzSelected ? '#fde047' : '#fed7aa';
            ctx.lineWidth = isHzSelected ? 2 : 1.1;
            ctx.beginPath();
            ctx.moveTo(proj.px, proj.py - 7);
            ctx.lineTo(proj.px + 6.5, proj.py + 5.5);
            ctx.lineTo(proj.px - 6.5, proj.py + 5.5);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (hz.category === 'SEVERE_STORM' || hz.category === 'SEA_ICE') {
            ctx.strokeStyle = isHzSelected ? '#fde047' : 'rgba(192, 132, 252, 0.85)';
            ctx.fillStyle = 'rgba(168, 85, 247, 0.35)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(proj.px, proj.py, 6.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } else {
            // SEISMIC or KINETIC_NON_TECTONIC
            const isKinetic = hz.category === 'KINETIC_NON_TECTONIC';
            ctx.strokeStyle = isHzSelected
              ? '#fde047'
              : isKinetic
              ? 'rgba(251, 146, 60, 0.9)'
              : 'rgba(250, 204, 21, 0.75)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(proj.px, proj.py, 8.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = isKinetic ? '#fb923c' : '#eab308';
            ctx.beginPath();
            ctx.arc(proj.px, proj.py, 3.2, 0, Math.PI * 2);
            ctx.fill();
          }

          if (zoom >= 5 || isHzSelected) {
            ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
            const tag = `${hz.magnitudeOrScale ? `[${hz.magnitudeOrScale}] ` : ''}${hz.title.slice(0, 22)}`;
            const tw = ctx.measureText(tag).width;
            ctx.fillStyle = 'rgba(4, 9, 14, 0.78)';
            ctx.fillRect(proj.px + 9, proj.py - 8, tw + 5, 11);
            ctx.fillStyle = isHzSelected ? '#fde047' : '#fed7aa';
            ctx.fillText(tag, proj.px + 11, proj.py);
          }
          ctx.restore();
        }
      }

      // 3. Render Live Geotagged Public CCTV Camera Nodes
      if (overlayVisibility.cctvNodes && cctvCameras.length > 0) {
        for (const cam of cctvCameras) {
          const proj = projectPinToCanvas(
            { lat: cam.lat, lon: cam.lon },
            centerLat,
            centerLon,
            zoom,
            canvas.width,
            canvas.height
          );
          if (!proj.isVisible) continue;

          ctx.save();
          // Camera FOV wedge
          ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
          ctx.beginPath();
          ctx.moveTo(proj.px, proj.py);
          ctx.arc(proj.px, proj.py, 15, -Math.PI * 0.72, -Math.PI * 0.28);
          ctx.closePath();
          ctx.fill();

          // Camera icon body
          ctx.fillStyle = 'rgba(4, 47, 46, 0.92)';
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 1.4;
          ctx.fillRect(proj.px - 6, proj.py - 4.5, 12, 9);
          ctx.strokeRect(proj.px - 6, proj.py - 4.5, 12, 9);

          ctx.fillStyle = '#6ee7b7';
          ctx.beginPath();
          ctx.arc(proj.px, proj.py, 2.1, 0, Math.PI * 2);
          ctx.fill();

          if (zoom >= 11) {
            ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
            const camLabel = `📹 ${cam.name.slice(0, 18)}`;
            const tw = ctx.measureText(camLabel).width;
            ctx.fillStyle = 'rgba(2, 14, 10, 0.84)';
            ctx.fillRect(proj.px + 8, proj.py - 6, tw + 5, 11);
            ctx.fillStyle = '#6ee7b7';
            ctx.fillText(camLabel, proj.px + 10, proj.py + 2);
          }
          ctx.restore();
        }
      }

      // 4. Render Live ADS-B Airspace Transponder Vectors (Directional Aircraft Icons)
      if (visibleAirspaceTracks.length > 0) {
        for (const ac of visibleAirspaceTracks) {
          const proj = projectPinToCanvas(
            { lat: ac.lat, lon: ac.lon },
            centerLat,
            centerLon,
            zoom,
            canvas.width,
            canvas.height
          );
          if (!proj.isVisible) continue;
          const isAcSelected = selectedAircraft?.icaoHex === ac.icaoHex;

          const color =
            ac.classification === 'EMERGENCY'
              ? '#ef4444'
              : ac.classification === 'MIL_GOV'
              ? '#f472b6'
              : ac.classification === 'ROTORCRAFT'
              ? '#fb923c'
              : '#38bdf8';

          ctx.save();
          ctx.translate(proj.px, proj.py);
          const headingRad = ((ac.trackDeg || 0) * Math.PI) / 180;
          ctx.rotate(headingRad);

          // Velocity leader vector ahead of nose
          const speedLen = Math.min(20, Math.max(6, (ac.groundSpeedKts || 120) / 28));
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(0, -6);
          ctx.lineTo(0, -6 - speedLen);
          ctx.stroke();

          // Directional swept-wing aircraft chevron
          ctx.fillStyle = isAcSelected ? '#fde047' : color;
          ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(5.5, 5);
          ctx.lineTo(0, 2.2);
          ctx.lineTo(-5.5, 5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          if (isAcSelected || ac.classification !== 'CIVIL' || zoom >= 10) {
            ctx.save();
            ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
            const altText =
              ac.altBaroFt === 'GROUND'
                ? 'GND'
                : typeof ac.altBaroFt === 'number'
                ? `FL${String(Math.round(ac.altBaroFt / 100)).padStart(3, '0')}`
                : '';
            const acTag = `${ac.callsign}${altText ? ` ${altText}` : ''}`;
            const tw = ctx.measureText(acTag).width;
            ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
            ctx.fillRect(proj.px + 8, proj.py - 9, tw + 5, 11);
            ctx.fillStyle = isAcSelected ? '#fde047' : color;
            ctx.fillText(acTag, proj.px + 10, proj.py - 1);
            ctx.restore();
          }
        }
      }

      // 5. Render Precision Pinpoint Target Reticle (if dropped by operator)
      const activeSpot = pinpointTarget || clickedSpot;
      if (activeSpot && Number.isFinite(activeSpot.lat) && Number.isFinite(activeSpot.lon)) {
        const spotProj = projectPinToCanvas(
          { lat: activeSpot.lat, lon: activeSpot.lon },
          centerLat,
          centerLon,
          zoom,
          canvas.width,
          canvas.height
        );
        if (spotProj.isVisible) {
          ctx.save();
          ctx.strokeStyle = '#fde047';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(spotProj.px, spotProj.py, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(spotProj.px - 16, spotProj.py);
          ctx.lineTo(spotProj.px - 5, spotProj.py);
          ctx.moveTo(spotProj.px + 5, spotProj.py);
          ctx.lineTo(spotProj.px + 16, spotProj.py);
          ctx.moveTo(spotProj.px, spotProj.py - 16);
          ctx.lineTo(spotProj.px, spotProj.py - 5);
          ctx.moveTo(spotProj.px, spotProj.py + 5);
          ctx.lineTo(spotProj.px, spotProj.py + 16);
          ctx.stroke();
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(spotProj.px, spotProj.py, 2.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 6. Render Tiered Geographically Locked Intelligence Pins
      filteredPins.forEach((pin) => {
        const { px, py, isVisible } = projectPinToCanvas(
          pin,
          centerLat,
          centerLon,
          zoom,
          canvas.width,
          canvas.height
        );

        const isSelected = selectedPin?.id === pin.id;
        const { tier, srcCount } = resolvePinVisualTier(pin, frameNow);

        if (!isVisible) {
          const pad = 16;
          const clampedX = Math.max(pad, Math.min(canvas.width - pad, px));
          const clampedY = Math.max(pad + 60, Math.min(canvas.height - pad - 48, py));

          ctx.save();
          ctx.setLineDash(tier === 'STALE' ? [3, 2] : []);
          ctx.fillStyle =
            tier === 'CRITICAL_CONVERGENCE'
              ? 'rgba(239, 68, 68, 0.85)'
              : tier === 'CORROBORATED'
              ? 'rgba(16, 185, 129, 0.85)'
              : tier === 'STALE'
              ? 'rgba(148, 163, 184, 0.5)'
              : 'rgba(245, 158, 11, 0.45)';
          ctx.strokeStyle = isSelected ? '#fde047' : 'rgba(15, 23, 42, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(clampedX, clampedY, tier === 'CRITICAL_CONVERGENCE' ? 5.5 : 4.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          return;
        }

        ctx.save();

        if (tier === 'STALE') {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isSelected ? '#fde047' : 'rgba(148, 163, 184, 0.72)';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(px - 9, py - 9, 18, 18);
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
          ctx.beginPath();
          ctx.arc(px, py, 3.2, 0, 2 * Math.PI);
          ctx.fill();
        } else if (tier === 'CANDIDATE') {
          ctx.globalAlpha = isSelected ? 0.9 : 0.45;
          ctx.strokeStyle = isSelected ? '#fde047' : '#f59e0b';
          ctx.fillStyle = isSelected ? '#fde047' : '#f59e0b';
          ctx.lineWidth = 1.15;
          ctx.beginPath();
          ctx.moveTo(px - 10, py);
          ctx.lineTo(px - 4, py);
          ctx.moveTo(px + 4, py);
          ctx.lineTo(px + 10, py);
          ctx.moveTo(px, py - 10);
          ctx.lineTo(px, py - 4);
          ctx.moveTo(px, py + 4);
          ctx.lineTo(px, py + 10);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, 2 * Math.PI);
          ctx.fill();
        } else if (tier === 'CORROBORATED') {
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(px, py, 17, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(16, 185, 129, 0.92)';
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.arc(px, py, 17, radarSweepAngle, radarSweepAngle + Math.PI * 0.42);
          ctx.stroke();

          ctx.strokeStyle = isSelected ? '#fde047' : '#22d3ee';
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.strokeRect(px - 9, py - 9, 18, 18);

          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          ctx.arc(px, py, pulseRadius, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(248, 113, 113, 0.5)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(px, py, 21, 0, 2 * Math.PI);
          ctx.stroke();

          const azRad = (((pin.vectorAzimuthDeg ?? 45) - 90) * Math.PI) / 180;
          const vx = px + Math.cos(azRad) * 28;
          const vy = py + Math.sin(azRad) * 28;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(vx, vy);
          ctx.stroke();

          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(px, py, 5.2, 0, 2 * Math.PI);
          ctx.fill();

          ctx.strokeStyle = isSelected ? '#fde047' : '#fca5a5';
          ctx.lineWidth = 1.6;
          ctx.strokeRect(px - 10, py - 10, 20, 20);
        }

        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        const shortBase = pin.title.length > 20 ? `${pin.title.slice(0, 18)}..` : pin.title;
        const admiraltyPart = pin.admiraltyGrade ? `[${pin.admiraltyGrade}] ` : '';
        const kineticPart = pin.isKineticNonTectonic ? '[KINETIC/NON-TECTONIC] ' : '';
        const trackTag = pin.adapterId
          ? pin.adapterId
              .replace('GEOINT_', '')
              .replace('MASINT_', '')
              .replace('IMINT_', '')
              .replace('SIGINT_', '')
              .replace('CIVIC_', '')
          : pin.sourceTracks?.[0] || '';
        const ageLabel = formatObservationAge(pin.observationTime || pin.capturedAt, frameNow);
        const badgePrefix =
          tier === 'CRITICAL_CONVERGENCE'
            ? `${admiraltyPart}[CRIT ${srcCount}x] ${kineticPart}`
            : tier === 'CORROBORATED'
            ? `${admiraltyPart}[${pin.isLifeSafetyA1 && srcCount < 2 ? 'LIFE-SAFETY' : `${srcCount}x SRC`}] ${kineticPart}`
            : tier === 'STALE'
            ? '[STALE] '
            : `${admiraltyPart}${trackTag ? `[${trackTag}] ` : ''}${kineticPart}`;
        const label = `${badgePrefix}${shortBase}${ageLabel ? ` • ${ageLabel}` : ''}`;
        const textWidth = ctx.measureText(label).width;
        const labelX = px + 14 + textWidth > canvas.width - 10 ? px - 14 - textWidth : px + 14;
        const labelY = py + 3;

        ctx.fillStyle =
          tier === 'CANDIDATE' ? 'rgba(2, 8, 4, 0.72)' : 'rgba(2, 8, 4, 0.9)';
        ctx.fillRect(labelX - 3, labelY - 10, textWidth + 6, 14);
        ctx.fillStyle = isSelected
          ? '#fde047'
          : pin.isKineticNonTectonic
          ? '#fb923c'
          : tier === 'CRITICAL_CONVERGENCE'
          ? '#fca5a5'
          : tier === 'CORROBORATED'
          ? '#6ee7b7'
          : tier === 'STALE'
          ? '#94a3b8'
          : '#fcd34d';
        ctx.fillText(label, labelX, labelY);

        ctx.restore();
      });

      pulseRadius = 10 + ((pulseRadius - 10 + 0.24) % 18);
      radarSweepAngle = (radarSweepAngle + 0.025) % (Math.PI * 2);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', syncCanvasSize);
      resizeObserver?.disconnect();
    };
  }, [
    filteredPins,
    visibleAirspaceTracks,
    cctvCameras,
    globalHazards,
    overlayVisibility.cctvNodes,
    overlayVisibility.globalHazards,
    pinpointTarget,
    clickedSpot,
    selectedPin,
    selectedAircraft,
    selectedHazard,
    activeNai,
    centerLat,
    centerLon,
    zoom,
  ]);

  // ==========================================================================
  // POINTER DRAG-TO-PAN + HOVER CURSOR TELEMETRY + PRECISION CLICK PINPOINTING
  // ==========================================================================

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      px: (clientX - rect.left) * scaleX,
      py: (clientY - rect.top) * scaleY,
      width: canvas.width,
      height: canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLat: centerLat,
      startLon: centerLon,
      hasExceededThreshold: false,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const drag = dragStateRef.current;
    if (drag && drag.pointerId === e.pointerId && canvas.hasPointerCapture(e.pointerId)) {
      const dxClient = e.clientX - drag.startClientX;
      const dyClient = e.clientY - drag.startClientY;

      // Wait for ~4px movement before entering dragging state so clicks/taps remain clean
      if (!drag.hasExceededThreshold && Math.hypot(dxClient, dyClient) >= 4) {
        drag.hasExceededThreshold = true;
        setIsDraggingSurface(true);
      }

      if (drag.hasExceededThreshold && onPanZoomChange) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / Math.max(1, rect.width);
        const scaleY = canvas.height / Math.max(1, rect.height);
        const panned = panLatLonByCanvasPixels(
          drag.startLat,
          drag.startLon,
          zoom,
          dxClient * scaleX,
          dyClient * scaleY
        );
        onPanZoomChange({
          lat: panned.lat,
          lon: panned.lon,
          isDragging: true,
        });
      }
      return;
    }

    // Update live cursor coordinates, range, and bearing
    if (onCursorTelemetryChange) {
      const pos = getCanvasCoords(e.clientX, e.clientY);
      if (pos) {
        const geo = canvasPixelToLatLon(
          pos.px,
          pos.py,
          centerLat,
          centerLon,
          zoom,
          pos.width,
          pos.height
        );
        const refLat = activeNai?.lat ?? centerLat;
        const refLon = activeNai?.lon ?? centerLon;
        onCursorTelemetryChange({
          lat: geo.lat,
          lon: geo.lon,
          distanceKm: Number(haversineDistanceKm(refLat, refLon, geo.lat, geo.lon).toFixed(2)),
          bearingDeg: calculateBearingDeg(refLat, refLon, geo.lat, geo.lon),
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    const wasDragging = Boolean(drag?.hasExceededThreshold);
    dragStateRef.current = null;
    setIsDraggingSurface(false);

    if (wasDragging) {
      onPanZoomChange?.({ lat: centerLat, lon: centerLon, isDragging: false });
      setLiveA11yAnnouncement('Recon map viewport panned to updated sector');
      setTimeout(() => setLiveA11yAnnouncement(''), 1200);
      return;
    }

    // Clean click (< 4px movement): hit-test pins -> CCTV -> ADS-B -> Global Hazards -> Spot Pinpoint
    const pos = getCanvasCoords(e.clientX, e.clientY);
    if (!pos) return;
    const { px: clickX, py: clickY, width, height } = pos;

    // 1. Shift+Click or Pinpoint Mode forces exact coordinate pinpoint first
    if (e.shiftKey || pinpointMode) {
      const spotGeo = canvasPixelToLatLon(clickX, clickY, centerLat, centerLon, zoom, width, height);
      setClickedSpot(spotGeo);
      updateSelectedPin(null);
      setSelectedAircraft(null);
      setSelectedHazard(null);
      onSpotPinpoint?.({ lat: spotGeo.lat, lon: spotGeo.lon, lockCenter: e.shiftKey });
      return;
    }

    // 2. Hit-test Intelligence Pins (in-viewport first)
    let clickedPin = filteredPins.find((pin) => {
      const { px, py, isVisible } = projectPinToCanvas(
        pin,
        centerLat,
        centerLon,
        zoom,
        width,
        height
      );
      if (!isVisible) return false;
      return Math.hypot(px - clickX, py - clickY) < 20;
    });

    if (clickedPin) {
      updateSelectedPin(clickedPin);
      return;
    }

    // 3. Hit-test Live CCTV Camera Nodes
    if (overlayVisibility.cctvNodes && cctvCameras.length > 0) {
      const hitCam = cctvCameras.find((cam) => {
        const { px, py, isVisible } = projectPinToCanvas(
          { lat: cam.lat, lon: cam.lon },
          centerLat,
          centerLon,
          zoom,
          width,
          height
        );
        return isVisible && Math.hypot(px - clickX, py - clickY) < 16;
      });
      if (hitCam) {
        onSelectCctv?.(hitCam);
        return;
      }
    }

    // 4. Hit-test Live ADS-B Aircraft Vectors
    if (visibleAirspaceTracks.length > 0) {
      const hitAc = visibleAirspaceTracks.find((ac) => {
        const { px, py, isVisible } = projectPinToCanvas(
          { lat: ac.lat, lon: ac.lon },
          centerLat,
          centerLon,
          zoom,
          width,
          height
        );
        return isVisible && Math.hypot(px - clickX, py - clickY) < 16;
      });
      if (hitAc) {
        updateSelectedPin(null);
        setSelectedHazard(null);
        setClickedSpot(null);
        setSelectedAircraft(hitAc);
        return;
      }
    }

    // 5. Hit-test Global Macro Hazards
    if (overlayVisibility.globalHazards && globalHazards.length > 0) {
      const hitHz = globalHazards.find((hz) => {
        const { px, py, isVisible } = projectPinToCanvas(
          { lat: hz.lat, lon: hz.lon },
          centerLat,
          centerLon,
          zoom,
          width,
          height
        );
        return isVisible && Math.hypot(px - clickX, py - clickY) < 16;
      });
      if (hitHz) {
        updateSelectedPin(null);
        setSelectedAircraft(null);
        setClickedSpot(null);
        setSelectedHazard(hitHz);
        return;
      }
    }

    // 6. Hit-test off-screen clamped edge intelligence pins
    const pad = 16;
    clickedPin = filteredPins.find((pin) => {
      const { px, py, isVisible } = projectPinToCanvas(
        pin,
        centerLat,
        centerLon,
        zoom,
        width,
        height
      );
      if (isVisible) return false;
      const clampedX = Math.max(pad, Math.min(width - pad, px));
      const clampedY = Math.max(pad + 60, Math.min(height - pad - 48, py));
      return Math.hypot(clampedX - clickX, clampedY - clickY) < 16;
    });
    if (clickedPin) {
      onFlyToPin?.(clickedPin);
      updateSelectedPin(clickedPin);
      return;
    }

    // 7. Empty map space click -> drop precision Spot Coordinate Reticle & Quick-Lock Pill
    const spotGeo = canvasPixelToLatLon(clickX, clickY, centerLat, centerLon, zoom, width, height);
    updateSelectedPin(null);
    setSelectedAircraft(null);
    setSelectedHazard(null);
    setClickedSpot(spotGeo);
    onSpotPinpoint?.({ lat: spotGeo.lat, lon: spotGeo.lon, lockCenter: false });
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasCoords(e.clientX, e.clientY);
    if (!pos) return;
    const spotGeo = canvasPixelToLatLon(
      pos.px,
      pos.py,
      centerLat,
      centerLon,
      zoom,
      pos.width,
      pos.height
    );
    setClickedSpot(spotGeo);
    const nextZoom = Math.min(maxZoom, zoom + 1);
    onPanZoomChange?.({ lat: spotGeo.lat, lon: spotGeo.lon, zoom: nextZoom, isDragging: false });
    onSpotPinpoint?.({ lat: spotGeo.lat, lon: spotGeo.lon, lockCenter: true });
  };

  const handleLostPointerCapture = () => {
    dragStateRef.current = null;
    setIsDraggingSurface(false);
  };

  // Keyboard navigation when canvas has focus (Arrow keys pan, +/- zoom)
  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!onPanZoomChange) return;
    const fineFactor = e.shiftKey ? 18 : 64;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = panLatLonByCanvasPixels(centerLat, centerLon, zoom, 0, fineFactor);
      onPanZoomChange({ lat: next.lat, lon: next.lon, isDragging: false });
      setLiveA11yAnnouncement('Map panned north');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = panLatLonByCanvasPixels(centerLat, centerLon, zoom, 0, -fineFactor);
      onPanZoomChange({ lat: next.lat, lon: next.lon, isDragging: false });
      setLiveA11yAnnouncement('Map panned south');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = panLatLonByCanvasPixels(centerLat, centerLon, zoom, fineFactor, 0);
      onPanZoomChange({ lat: next.lat, lon: next.lon, isDragging: false });
      setLiveA11yAnnouncement('Map panned west');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = panLatLonByCanvasPixels(centerLat, centerLon, zoom, -fineFactor, 0);
      onPanZoomChange({ lat: next.lat, lon: next.lon, isDragging: false });
      setLiveA11yAnnouncement('Map panned east');
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      onPanZoomChange({ lat: centerLat, lon: centerLon, zoom: Math.min(maxZoom, zoom + 1) });
      setLiveA11yAnnouncement('Map zoomed in');
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      onPanZoomChange({ lat: centerLat, lon: centerLon, zoom: Math.max(2, zoom - 1) });
      setLiveA11yAnnouncement('Map zoomed out');
    }
  };

  const handleToggleRawJson = async (pkt: TacticalProvenancePacket) => {
    if (rawJsonByPacketId[pkt.packetId] !== undefined) {
      setRawJsonByPacketId((prev) => {
        const next = { ...prev };
        delete next[pkt.packetId];
        return next;
      });
      return;
    }

    setLoadingRawPacketId(pkt.packetId);
    try {
      const rawJson = await getPacketRawPayloadJson(pkt.packetId);
      setRawJsonByPacketId((prev) => ({
        ...prev,
        [pkt.packetId]:
          rawJson || `Raw packet snapshot not found for ${pkt.packetId}`,
      }));
    } catch (err: any) {
      setRawJsonByPacketId((prev) => ({
        ...prev,
        [pkt.packetId]: `Error loading raw packet snapshot: ${err?.message || err}`,
      }));
    } finally {
      setLoadingRawPacketId(null);
    }
  };

  const handleNominatePackage = async () => {
    if (!selectedPin?.clusterId) return;
    setIsMutatingGate(true);
    setGateActionMessage(null);
    try {
      const res = await nominateClusterPackage(selectedPin.clusterId, {
        actionType: selectedEffector,
        approvedBy: 'WAR_ROOM_COMMANDER',
      });
      if (res.approved) {
        setGateActionMessage({
          type: 'ok',
          text: `NOMINATED [${selectedEffector}] // Ledger Hash: ${res.ledgerHash}`,
        });
        onClustersMutated?.();
      } else {
        setGateActionMessage({
          type: 'error',
          text: res.reason || 'Nomination rejected.',
        });
      }
    } catch (err: any) {
      setGateActionMessage({
        type: 'error',
        text: err?.message || 'Nomination failed.',
      });
    } finally {
      setIsMutatingGate(false);
    }
  };

  const handleDismissFalsePositive = async () => {
    if (!selectedPin?.clusterId) return;
    setIsMutatingGate(true);
    setGateActionMessage(null);
    try {
      const res = await dismissClusterFalsePositive(selectedPin.clusterId);
      if (res.dismissed) {
        updateSelectedPin(null);
        onClustersMutated?.();
      } else {
        setGateActionMessage({
          type: 'error',
          text: 'Could not dismiss cluster.',
        });
      }
    } finally {
      setIsMutatingGate(false);
    }
  };

  const selectedTierInfo = selectedPin ? resolvePinVisualTier(selectedPin, nowTickMs) : null;
  const selectedTtlInfo = selectedPin
    ? formatRemainingTtl(selectedPin.expiresAt, nowTickMs)
    : null;

  const filterChips: Array<{ id: TacticalLayerFilter; label: string }> = [
    { id: 'ALL', label: 'ALL' },
    { id: 'CORROBORATED_ONLY', label: 'CORROBORATED ONLY' },
    { id: 'WIDE_AREA', label: 'WIDE-AREA' },
    { id: 'SIGNALS', label: 'SIGNALS' },
    { id: 'WIRES', label: 'WIRES' },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden pointer-events-auto">
      {/* Screen-reader live region registered on page load for drag/keyboard movement announcements */}
      <div className="visually-hidden" aria-live="polite">
        {liveA11yAnnouncement}
      </div>

      {/* Interactive 60FPS Tactical Canvas Layer (Drag-to-Pan + Wheel Zoom + Click-to-Pinpoint) */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="Interactive reconnaissance map surface. Drag to pan, scroll wheel or plus/minus to zoom, arrow keys to nudge, click or Shift+click to pinpoint coordinates."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handleLostPointerCapture}
        onPointerLeave={() => onCursorTelemetryChange?.(null)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleCanvasKeyDown}
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          cursor: isDraggingSurface
            ? 'grabbing'
            : pinpointMode
            ? 'crosshair'
            : 'grab',
        }}
        className="absolute inset-0 z-10 block w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
      />

      {/* Compact Single-Row Layer Filter HUD Strip */}
      {!hideInternalFilterStrip && (
        <div
          data-no-map-drag="true"
          className="absolute top-1.5 left-1/2 -translate-x-1/2 z-35 flex items-center gap-1 bg-black/85 border border-emerald-500/45 rounded px-1.5 py-0.5 shadow-[0_0_16px_rgba(0,0,0,0.9)] max-w-[94%] overflow-x-auto no-scrollbar"
        >
          {filterChips.map((chip) => {
            const active = activeLayerFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setActiveLayerFilter(chip.id)}
                className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400'
                    : 'bg-slate-900/90 text-slate-400 hover:text-emerald-200 border border-slate-800'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
          <span className="text-[9px] font-mono text-emerald-400/80 pl-1 whitespace-nowrap">
            [{filteredPins.length} PINS • {visibleAirspaceTracks.length} AIR • {cctvCameras.length} CAM]
          </span>
        </div>
      )}

      {/* Live ADS-B Aircraft Track Quick-Inspector */}
      {selectedAircraft && !selectedPin && (
        <div
          data-no-map-drag="true"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-12 left-2.5 z-40 w-72 sm:w-80 bg-slate-950/95 border border-sky-400/70 rounded p-2.5 font-mono text-[10px] text-slate-100 shadow-[0_0_24px_rgba(0,0,0,0.95)] space-y-1.5"
        >
          <div className="flex items-center justify-between border-b border-sky-500/30 pb-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                  selectedAircraft.classification === 'EMERGENCY'
                    ? 'bg-red-950 text-red-200 border-red-500'
                    : selectedAircraft.classification === 'MIL_GOV'
                    ? 'bg-fuchsia-950 text-fuchsia-200 border-fuchsia-400'
                    : selectedAircraft.classification === 'ROTORCRAFT'
                    ? 'bg-orange-950 text-orange-200 border-orange-400'
                    : 'bg-sky-950 text-sky-200 border-sky-400'
                }`}
              >
                ✈️ {selectedAircraft.classification}
              </span>
              <span className="font-bold text-amber-200">{selectedAircraft.callsign}</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAircraft(null)}
              className="text-slate-400 hover:text-white px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9.5px] text-slate-300">
            <div>ICAO HEX: <strong className="text-sky-300">{selectedAircraft.icaoHex}</strong></div>
            <div>TYPE: <strong className="text-white">{selectedAircraft.aircraftType}</strong></div>
            <div>
              ALT:{' '}
              <strong className="text-emerald-300">
                {selectedAircraft.altBaroFt === 'GROUND'
                  ? 'GROUND'
                  : selectedAircraft.altBaroFt !== null
                  ? `${selectedAircraft.altBaroFt.toLocaleString()} ft`
                  : 'N/A'}
              </strong>
            </div>
            <div>
              GS / HDG:{' '}
              <strong className="text-emerald-300">
                {selectedAircraft.groundSpeedKts ?? '--'} kt @ {Math.round(selectedAircraft.trackDeg)}°
              </strong>
            </div>
            <div>SQUAWK: <strong className="text-amber-300">{selectedAircraft.squawk || 'N/A'}</strong></div>
            <div>RNG: <strong className="text-cyan-300">{selectedAircraft.distanceKm} km</strong></div>
          </div>
          <div className="text-[9px] text-slate-400">
            POS: {selectedAircraft.lat.toFixed(5)}°, {selectedAircraft.lon.toFixed(5)}°
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() =>
                onPanZoomChange?.({
                  lat: selectedAircraft.lat,
                  lon: selectedAircraft.lon,
                  zoom: Math.max(zoom, 11),
                })
              }
              className="px-2 py-1 rounded bg-sky-950 hover:bg-sky-900 border border-sky-500/60 text-sky-200 font-bold cursor-pointer"
            >
              [🎯 CENTER TRACK]
            </button>
            {onDispatchPinDirective && (
              <button
                type="button"
                onClick={() =>
                  onDispatchPinDirective({
                    id: `adsb-${selectedAircraft.icaoHex}`,
                    lat: selectedAircraft.lat,
                    lon: selectedAircraft.lon,
                    title: `ADS-B Track ${selectedAircraft.callsign} (${selectedAircraft.icaoHex})`,
                    summary: `Live transponder ${selectedAircraft.classification} aircraft (${selectedAircraft.aircraftType}) at ${selectedAircraft.altBaroFt ?? 'N/A'} ft, ${selectedAircraft.groundSpeedKts ?? 'N/A'} kts, heading ${Math.round(selectedAircraft.trackDeg)}°, squawk ${selectedAircraft.squawk || 'N/A'}.`,
                    priority: selectedAircraft.classification === 'CIVIL' ? 'MEDIUM' : 'HIGH',
                    timestamp: selectedAircraft.observedAt,
                  })
                }
                className="px-2 py-1 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold cursor-pointer"
              >
                [⚡ TASK AGENT]
              </button>
            )}
          </div>
        </div>
      )}

      {/* Global Hazard Event Quick-Inspector */}
      {selectedHazard && !selectedPin && (
        <div
          data-no-map-drag="true"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-12 left-2.5 z-40 w-72 sm:w-80 bg-slate-950/95 border border-orange-400/70 rounded p-2.5 font-mono text-[10px] text-slate-100 shadow-[0_0_24px_rgba(0,0,0,0.95)] space-y-1.5"
        >
          <div className="flex items-center justify-between border-b border-orange-500/30 pb-1">
            <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-950 text-orange-200 border border-orange-500/60">
              {selectedHazard.source} // {selectedHazard.category}
            </span>
            <button
              type="button"
              onClick={() => setSelectedHazard(null)}
              className="text-slate-400 hover:text-white px-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="font-bold text-amber-200">{selectedHazard.title}</div>
          <div className="text-[9.5px] text-slate-300">
            GEO: {selectedHazard.lat.toFixed(4)}°, {selectedHazard.lon.toFixed(4)}°
            {selectedHazard.depthKm !== undefined ? ` • Depth: ${selectedHazard.depthKm} km` : ''}
          </div>
          <div className="text-[9px] text-slate-400">OBSERVED: {selectedHazard.observedAt}</div>
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() =>
                onPanZoomChange?.({
                  lat: selectedHazard.lat,
                  lon: selectedHazard.lon,
                  zoom: Math.max(zoom, 9),
                })
              }
              className="px-2 py-1 rounded bg-amber-950 hover:bg-amber-900 border border-amber-500/60 text-amber-200 font-bold cursor-pointer"
            >
              [🎯 ZOOM TO EVENT]
            </button>
            <a
              href={selectedHazard.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 font-bold"
            >
              [↗ OFFICIAL FEED]
            </a>
          </div>
        </div>
      )}

      {/* Precision Spot Pinpoint Pill (when clicking any coordinate on the map) */}
      {clickedSpot && !selectedPin && !selectedAircraft && !selectedHazard && (
        <div
          data-no-map-drag="true"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-12 left-2.5 z-40 bg-slate-950/95 border border-yellow-400/70 rounded px-2.5 py-2 font-mono text-[10px] text-slate-100 shadow-[0_0_20px_rgba(0,0,0,0.9)] flex flex-wrap items-center gap-1.5 max-w-[92%]"
        >
          <span className="text-yellow-300 font-bold">
            📌 SPOT: {clickedSpot.lat.toFixed(5)}°, {clickedSpot.lon.toFixed(5)}°
          </span>
          <button
            type="button"
            onClick={() => {
              onPanZoomChange?.({
                lat: clickedSpot.lat,
                lon: clickedSpot.lon,
                zoom: Math.max(zoom, 13),
              });
            }}
            className="px-1.5 py-0.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-bold cursor-pointer"
          >
            [🎯 Center &amp; Zoom]
          </button>
          {onLockNaiAtCoords && (
            <button
              type="button"
              onClick={() => onLockNaiAtCoords(clickedSpot)}
              className="px-1.5 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 font-bold cursor-pointer"
            >
              [🛡️ Lock NAI Geofence]
            </button>
          )}
          {onDispatchPinDirective && (
            <button
              type="button"
              onClick={() =>
                onDispatchPinDirective({
                  id: `spot-${clickedSpot.lat.toFixed(4)}-${clickedSpot.lon.toFixed(4)}`,
                  lat: clickedSpot.lat,
                  lon: clickedSpot.lon,
                  title: `Pinpoint Target (${clickedSpot.lat.toFixed(5)}°, ${clickedSpot.lon.toFixed(5)}°)`,
                  summary: `Operator precision coordinate pinpoint at ${clickedSpot.lat.toFixed(5)}°, ${clickedSpot.lon.toFixed(5)}°.`,
                  priority: 'HIGH',
                  timestamp: new Date().toISOString(),
                })
              }
              className="px-1.5 py-0.5 rounded bg-amber-950 hover:bg-amber-900 border border-amber-500/60 text-amber-200 font-bold cursor-pointer"
            >
              [⚡ Recon Spot]
            </button>
          )}
          <button
            type="button"
            onClick={() => setClickedSpot(null)}
            className="text-slate-400 hover:text-white px-1 cursor-pointer"
            title="Clear Spot Reticle"
          >
            ✕
          </button>
        </div>
      )}

      {/* Non-Blocking Slide-Over Evidence Provenance Drawer */}
      {selectedPin && !suppressInlineDossier && (
        <aside
          role="region"
          aria-label="Evidence Provenance Drawer"
          data-no-map-drag="true"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 right-0 bottom-0 w-full sm:w-[390px] max-w-full z-40 bg-slate-950/95 border-l-2 border-emerald-500/75 p-3 font-mono text-xs text-emerald-200 shadow-[-12px_0_32px_rgba(0,0,0,0.95)] backdrop-blur-md flex flex-col gap-2.5 overflow-y-auto"
        >
          {/* Drawer Header */}
          <div className="flex items-start justify-between gap-2 border-b border-emerald-500/35 pb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                    selectedTierInfo?.tier === 'CRITICAL_CONVERGENCE'
                      ? 'bg-red-950/90 text-red-300 border-red-500/70'
                      : selectedTierInfo?.tier === 'CORROBORATED'
                      ? 'bg-emerald-950/90 text-emerald-300 border-emerald-400/70'
                      : selectedTierInfo?.tier === 'STALE'
                      ? 'bg-slate-900 text-slate-400 border-slate-600 border-dashed'
                      : 'bg-amber-950/80 text-amber-300 border-amber-500/60'
                  }`}
                >
                  {selectedTierInfo?.tier}
                </span>
                {selectedPin.admiraltyGrade && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-950/90 text-cyan-200 border border-cyan-500/70">
                    NATO [{selectedPin.admiraltyGrade}]
                  </span>
                )}
                {selectedPin.isKineticNonTectonic && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-orange-950/90 text-orange-300 border border-orange-500/80">
                    [KINETIC/NON-TECTONIC{selectedPin.seismicTypeVerbatim ? `: ${selectedPin.seismicTypeVerbatim}` : ''}]
                  </span>
                )}
                {selectedPin.isLifeSafetyA1 && (
                  <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-950/90 text-red-200 border border-red-400/80">
                    A1 LIFE-SAFETY
                  </span>
                )}
                {selectedPin.clusterId && (
                  <span className="text-[9px] text-cyan-300 font-bold">
                    {selectedPin.clusterId}
                  </span>
                )}
              </div>
              <h3 className="text-xs font-bold text-amber-200 break-words">
                {selectedPin.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => updateSelectedPin(null)}
              aria-label="Close Evidence Provenance Drawer"
              className="px-2 py-0.5 text-[10px] font-bold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-600 rounded cursor-pointer shrink-0"
            >
              [✕]
            </button>
          </div>

          {/* Confidence Score Bar & Live Staleness Timer */}
          <div className="bg-black/60 border border-emerald-500/30 rounded p-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-300 font-bold">
                CONFIDENCE: {Math.round((selectedTierInfo?.score ?? 0) * 100)}% (
                {(selectedTierInfo?.score ?? 0).toFixed(2)})
              </span>
              <span
                className={`font-bold ${
                  selectedTtlInfo?.isStale ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {selectedTtlInfo?.label}
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-300 ${
                  selectedTierInfo?.tier === 'CRITICAL_CONVERGENCE'
                    ? 'bg-red-500'
                    : selectedTierInfo?.tier === 'CORROBORATED'
                    ? 'bg-emerald-400'
                    : selectedTierInfo?.tier === 'STALE'
                    ? 'bg-slate-500'
                    : 'bg-amber-400'
                }`}
                style={{ width: `${Math.min(100, Math.round((selectedTierInfo?.score ?? 0) * 100))}%` }}
              />
            </div>
            <div className="text-[10px] text-slate-400 flex items-center justify-between">
              <span>
                GEO: {selectedPin.lat.toFixed(5)}°, {selectedPin.lon.toFixed(5)}°
              </span>
              <span>
                SOURCES: {selectedPin.adapterId || selectedPin.sourceTracks?.join(' + ') || selectedPin.category || 'SINGLE'}
              </span>
            </div>
            {(selectedPin.observationTime || selectedPin.firstIngestedAt || selectedPin.lastMaterialChangeAt) && (
              <div className="pt-1.5 border-t border-slate-800 text-[9px] text-slate-300 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">OBSERVED AT:</span>
                  <span className="text-cyan-200 font-bold">
                    {selectedPin.observationTime || 'N/A'}
                    {selectedPin.observationTime
                      ? ` (${formatObservationAge(selectedPin.observationTime, nowTickMs) || '0s'} ago)`
                      : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">FIRST INGESTED:</span>
                  <span>{selectedPin.firstIngestedAt || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">LAST DELTA:</span>
                  <span className="text-emerald-300">{selectedPin.lastMaterialChangeAt || 'N/A'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Fused Summary */}
          <div className="text-[11px] leading-relaxed text-slate-100 bg-slate-900/60 border border-slate-800 rounded p-2">
            {selectedPin.summary}
          </div>

          {selectedPin.spotlightedSummary && (
            <details className="bg-slate-900/80 border border-cyan-500/35 rounded p-2 text-[9px]">
              <summary className="cursor-pointer font-bold text-cyan-300 select-none">
                SPOTLIGHTING ENVELOPE (DEFANGED UNTRUSTED PAYLOAD)
              </summary>
              <pre className="mt-1.5 p-1.5 bg-black border border-slate-800 rounded text-emerald-300 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {selectedPin.spotlightedSummary}
              </pre>
            </details>
          )}

          {/* Agent Vance Synthesis Details */}
          {selectedPin.vanceSynthesis && (
            <details className="bg-emerald-950/25 border border-emerald-500/35 rounded p-2 text-[10px]">
              <summary className="cursor-pointer font-bold text-emerald-300 select-none">
                WAR ROOM VANCE SYNTHESIS ({selectedPin.vanceSynthesis.agreedIndicators.length} indicators)
              </summary>
              <div className="mt-2 space-y-1.5 text-slate-200">
                {selectedPin.vanceSynthesis.agreedIndicators.map((ind, idx) => (
                  <div key={idx} className="border-l-2 border-emerald-500/60 pl-2">
                    <div>{ind.claim}</div>
                    <div className="text-[9px] text-cyan-300">
                      Cites: {ind.packetIds.map((id) => id.slice(0, 12)).join(', ')}
                    </div>
                  </div>
                ))}
                {selectedPin.vanceSynthesis.conflictingGaps.length > 0 && (
                  <div className="pt-1 border-t border-emerald-500/20 text-amber-300">
                    <span className="font-bold">Gaps:</span>{' '}
                    {selectedPin.vanceSynthesis.conflictingGaps.map((g) => g.gap).join(' ')}
                  </div>
                )}
                {selectedPin.sitrepPath && (
                  <div className="text-[9px] text-emerald-400">
                    LEDGER REF: {selectedPin.sitrepPath}
                  </div>
                )}
              </div>
            </details>
          )}

          {/* Expandable Provenance Chain Tree */}
          <details open className="bg-slate-900/70 border border-emerald-500/35 rounded p-2 text-[10px]">
            <summary className="cursor-pointer font-bold text-cyan-300 select-none">
              EVIDENCE PROVENANCE CHAIN ({selectedPin.provenancePackets?.length ?? 0} PACKETS)
            </summary>
            <div className="mt-2 space-y-2">
              {selectedPin.provenancePackets && selectedPin.provenancePackets.length > 0 ? (
                selectedPin.provenancePackets.map((pkt) => {
                  const hasRaw = rawJsonByPacketId[pkt.packetId] !== undefined;
                  return (
                    <div
                      key={pkt.packetId}
                      className="bg-black/70 border border-slate-700 rounded p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-emerald-300">
                          {pkt.sourceTrack} // {pkt.sourceType}
                        </span>
                        <span className="text-[9px] text-amber-300">
                          WT {(pkt.confidenceWeight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-[9px] text-slate-300 break-all">
                        ID: {pkt.packetId}
                      </div>
                      <div className="text-[9px] text-slate-400 break-all">
                        SRC: {pkt.sourceEndpoint}
                      </div>
                      <div className="text-[9px] text-slate-400">
                        AT: {pkt.capturedAt} (TTL {pkt.ttlSeconds}s) • BY {pkt.ingestedBy.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleToggleRawJson(pkt)}
                          className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 cursor-pointer"
                        >
                          {loadingRawPacketId === pkt.packetId
                            ? '[LOADING...]'
                            : hasRaw
                            ? '[HIDE RAW JSON]'
                            : '[VIEW RAW JSON]'}
                        </button>
                      </div>
                      {hasRaw && (
                        <pre className="mt-1 p-1.5 bg-black border border-emerald-500/30 rounded text-[9px] text-emerald-300 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                          {rawJsonByPacketId[pkt.packetId]}
                        </pre>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-400">
                  Single-source VFS intelligence record ({selectedPin.timestamp}).
                </div>
              )}
            </div>
          </details>

          {/* War Room Human-in-the-Loop Nomination Gate */}
          {selectedPin.clusterId && (
            <div className="bg-black/75 border border-amber-500/50 rounded p-2 space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-amber-300">WAR ROOM ACTION NOMINATION</span>
                <span className="text-[9px] text-cyan-300">
                  {selectedPin.nominationStatus || 'UNNOMINATED'}
                </span>
              </div>

              <label
                htmlFor="nomination-effector-select"
                className="block text-[9px] text-slate-400"
              >
                OUTBOUND EFFECTOR PAYLOAD TYPE
              </label>
              <select
                id="nomination-effector-select"
                name="nomination_effector_select"
                value={selectedEffector}
                onChange={(e) => setSelectedEffector(e.target.value as EffectorActionType)}
                className="w-full px-2 py-1 text-[10px] bg-slate-950 border border-emerald-500/50 rounded text-emerald-200 focus:outline-none"
              >
                <option value="COMPOSIO_GITHUB_ISSUE">Composio GitHub Advisory Issue</option>
                <option value="WEBHOOK_DISPATCH">Signed C2 Webhook Dispatch</option>
                <option value="ARCHIVE_SITREP">Immutable Ledger SITREP Archive</option>
              </select>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isMutatingGate}
                  onClick={handleNominatePackage}
                  className="flex-1 px-2 py-1.5 text-[10px] font-bold rounded bg-emerald-900/80 hover:bg-emerald-800 border border-emerald-400/70 text-emerald-100 cursor-pointer disabled:opacity-50"
                >
                  [NOMINATE PACKAGE]
                </button>
                <button
                  type="button"
                  disabled={isMutatingGate}
                  onClick={handleDismissFalsePositive}
                  className="px-2 py-1.5 text-[10px] font-bold rounded bg-red-950/80 hover:bg-red-900 border border-red-500/60 text-red-200 cursor-pointer disabled:opacity-50"
                >
                  [DISMISS FALSE POSITIVE]
                </button>
              </div>

              {gateActionMessage && (
                <div
                  className={`p-1.5 rounded text-[9px] border break-all ${
                    gateActionMessage.type === 'ok'
                      ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300'
                      : 'bg-red-950/70 border-red-500/60 text-red-300'
                  }`}
                >
                  {gateActionMessage.text}
                </div>
              )}
            </div>
          )}

          {/* Fly-to & Agent Dispatch Footer Actions */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 mt-auto border-t border-emerald-500/25">
            {onFlyToPin &&
              (Math.abs(selectedPin.lat - centerLat) > 0.005 ||
                Math.abs(selectedPin.lon - centerLon) > 0.005) && (
                <button
                  type="button"
                  onClick={() => onFlyToPin(selectedPin)}
                  className="px-2 py-1 text-[10px] bg-sky-950/90 hover:bg-sky-900 border border-sky-500/60 text-sky-300 font-bold rounded cursor-pointer"
                >
                  [🎯 CENTER ON PIN]
                </button>
              )}
            {onDispatchPinDirective && (
              <button
                type="button"
                onClick={() => onDispatchPinDirective(selectedPin)}
                className="px-2 py-1 text-[10px] bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 font-bold rounded cursor-pointer"
              >
                [⚡ DISPATCH AGENT]
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
