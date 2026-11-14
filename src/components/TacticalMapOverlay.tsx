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

interface TacticalMapOverlayProps {
  intelligencePins?: TacticalIntelPin[];
  activeNai?: {
    label: string;
    lat: number;
    lon: number;
    radiusKm: number;
  } | null;
  centerLat: number;
  centerLon: number;
  zoom: number;
  onSelectPin?: (pin: TacticalIntelPin | null) => void;
  onFlyToPin?: (pin: TacticalIntelPin) => void;
  onDispatchPinDirective?: (pin: TacticalIntelPin) => void;
  onClustersMutated?: () => void;
}

/**
 * Converts (lat, lon, zoom) to exact Web Mercator world pixel coordinates (at 256px tile size)
 */
function latLonToWorldPixels(lat: number, lon: number, zoom: number): { wx: number; wy: number; worldSize: number } {
  const z = Math.max(1, Math.min(17, Math.round(zoom)));
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const worldSize = Math.pow(2, z) * 256;

  const wx = ((lon + 180) / 360) * worldSize;
  const wy =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * worldSize;

  return { wx, wy, worldSize };
}

/**
 * Projects a geographic pin (lat, lon) onto the current viewport canvas (width, height)
 * centered at (centerLat, centerLon) at the given Web Mercator zoom level.
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
    const centerWorld = latLonToWorldPixels(centerLat, centerLon, zoom);
    const pinWorld = latLonToWorldPixels(pin.lat, pin.lon, zoom);

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

  // Fallback if only percentage x/y provided
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

export default function TacticalMapOverlay({
  intelligencePins = [],
  activeNai = null,
  centerLat,
  centerLon,
  zoom,
  onSelectPin,
  onFlyToPin,
  onDispatchPinDirective,
  onClustersMutated,
}: TacticalMapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPin, setSelectedPin] = useState<TacticalIntelPin | null>(null);
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

  // Live 1-second timer while Provenance Drawer is open (keeps TTL countdown live)
  useEffect(() => {
    if (!selectedPin) return;
    setNowTickMs(Date.now());
    const id = setInterval(() => setNowTickMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [selectedPin]);

  // Escape key closes the slide-over provenance drawer
  useEffect(() => {
    if (!selectedPin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        updateSelectedPin(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPin]);

  // Sync selectedPin when intelligencePins updates (e.g., after nomination or score change)
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
    setGateActionMessage(null);
    setRawJsonByPacketId({});
    if (nextPin?.vanceSynthesis?.recommendedEffectorPackage.actionType) {
      setSelectedEffector(nextPin.vanceSynthesis.recommendedEffectorPackage.actionType);
    }
    if (onSelectPin) {
      onSelectPin(nextPin);
    }
  };

  const filteredPins = useMemo(() => {
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
  }, [intelligencePins, activeLayerFilter]);

  // Render tiered corroboration pins cleanly at 60 FPS on HTML5 Canvas (zero per-pin DOM nodes)
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

      // 1. Subtle tactical grid lines
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      const gridSize = 40;
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
        const zClamped = Math.max(1, Math.min(17, Math.round(zoom)));
        const metersPerPx =
          (156543.03392 * Math.max(0.15, Math.cos((activeNai.lat * Math.PI) / 180))) /
          Math.pow(2, zClamped);
        const radiusPx = Math.max(16, (activeNai.radiusKm * 1000) / Math.max(0.1, metersPerPx));

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.42)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(naiProj.px, naiProj.py, Math.min(radiusPx, 1800), 0, 2 * Math.PI);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
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
          ctx.fillStyle = 'rgba(2, 12, 8, 0.78)';
          ctx.fillRect(naiProj.px - tw / 2 - 3, naiProj.py + 11, tw + 6, 12);
          ctx.fillStyle = '#67e8f9';
          ctx.fillText(naiTag, naiProj.px - tw / 2, naiProj.py + 20);
        }
        ctx.restore();
      }

      // 2. Render Tiered Geographically Locked Intelligence Pins
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
          // STALE: dashed grey outline, zero pulse
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
          // CANDIDATE (< 0.50): single-source reticle at 45% opacity, static crosshair, no pulse
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
          // CORROBORATED (0.50 - 0.84): phosphor-green/cyan lock box, dual-source badge, slow radar sweep ring
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
          // CRITICAL_CONVERGENCE (>= 0.85): pulsing crimson threat ring, target vector leader line, priority tag
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

          // Target vector leader line
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

        // Draw compact canvas badge & callout label (Admiralty grade, kinetic tag, source track, live age)
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        const shortBase = pin.title.length > 20 ? `${pin.title.slice(0, 18)}..` : pin.title;
        const admiraltyPart = pin.admiraltyGrade ? `[${pin.admiraltyGrade}] ` : '';
        const kineticPart = pin.isKineticNonTectonic ? '[KINETIC/NON-TECTONIC] ' : '';
        const trackTag = pin.adapterId
          ? pin.adapterId.replace('GEOINT_', '').replace('MASINT_', '').replace('IMINT_', '').replace('SIGINT_', '').replace('CIVIC_', '')
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
  }, [filteredPins, selectedPin, activeNai, centerLat, centerLon, zoom]);

  // Handle canvas click/tap to select nearest visible (or off-screen edge) pin
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    let clickedPin = filteredPins.find((pin) => {
      const { px, py, isVisible } = projectPinToCanvas(
        pin,
        centerLat,
        centerLon,
        zoom,
        canvas.width,
        canvas.height
      );
      if (!isVisible) return false;
      return Math.hypot(px - clickX, py - clickY) < 22;
    });

    if (!clickedPin) {
      const pad = 16;
      clickedPin = filteredPins.find((pin) => {
        const { px, py, isVisible } = projectPinToCanvas(
          pin,
          centerLat,
          centerLon,
          zoom,
          canvas.width,
          canvas.height
        );
        if (isVisible) return false;
        const clampedX = Math.max(pad, Math.min(canvas.width - pad, px));
        const clampedY = Math.max(pad + 60, Math.min(canvas.height - pad - 48, py));
        return Math.hypot(clampedX - clickX, clampedY - clickY) < 16;
      });
      if (clickedPin && onFlyToPin) {
        onFlyToPin(clickedPin);
      }
    }

    updateSelectedPin(clickedPin || null);
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
      {/* Interactive 60FPS Tactical Canvas Layer */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="absolute inset-0 z-10 cursor-crosshair block w-full h-full"
      />

      {/* Compact Single-Row Layer Filter HUD Strip (< 12% viewport height) */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-35 flex items-center gap-1 bg-black/85 border border-emerald-500/45 rounded px-1.5 py-0.5 shadow-[0_0_16px_rgba(0,0,0,0.9)] max-w-[92%] overflow-x-auto no-scrollbar">
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
          [{filteredPins.length}/{intelligencePins.length}]
        </span>
      </div>

      {/* Non-Blocking Slide-Over Evidence Provenance Drawer */}
      {selectedPin && (
        <aside
          role="region"
          aria-label="Evidence Provenance Drawer"
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
                GEO: {selectedPin.lat.toFixed(4)}°, {selectedPin.lon.toFixed(4)}°
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
              (Math.abs(selectedPin.lat - centerLat) > 0.02 ||
                Math.abs(selectedPin.lon - centerLon) > 0.02) && (
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
