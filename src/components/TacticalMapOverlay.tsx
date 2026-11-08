import React, { useEffect, useRef, useState } from 'react';

export interface TacticalIntelPin {
  id: string;
  lat: number; // Geographic latitude (-85..85)
  lon: number; // Geographic longitude (-180..180)
  x?: number; // Optional fallback percentage (0..100)
  y?: number; // Optional fallback percentage (0..100)
  title: string;
  summary: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: string;
  category?: string;
}

interface TacticalMapOverlayProps {
  intelligencePins?: TacticalIntelPin[];
  centerLat: number;
  centerLon: number;
  zoom: number;
  onSelectPin?: (pin: TacticalIntelPin | null) => void;
  onFlyToPin?: (pin: TacticalIntelPin) => void;
  onDispatchPinDirective?: (pin: TacticalIntelPin) => void;
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
function projectPinToCanvas(
  pin: TacticalIntelPin,
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

export default function TacticalMapOverlay({
  intelligencePins = [],
  centerLat,
  centerLon,
  zoom,
  onSelectPin,
  onFlyToPin,
  onDispatchPinDirective,
}: TacticalMapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPin, setSelectedPin] = useState<TacticalIntelPin | null>(null);

  const updateSelectedPin = (nextPin: TacticalIntelPin | null) => {
    setSelectedPin(nextPin);
    if (onSelectPin) {
      onSelectPin(nextPin);
    }
  };

  // Render tactical rings, crosshairs, and geographically anchored intel markers on canvas
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
    let pulseRadius = 10;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Draw subtle tactical grid lines (Retro Safehouse HUD effect)
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.1)'; // Emerald tint
      ctx.lineWidth = 1;
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

      // 2. Render Geographically Locked Intelligence & Wire Pins
      intelligencePins.forEach((pin) => {
        const { px, py, isVisible } = projectPinToCanvas(
          pin,
          centerLat,
          centerLon,
          zoom,
          canvas.width,
          canvas.height
        );

        const isSelected = selectedPin?.id === pin.id;

        if (!isVisible) {
          // Draw subtle edge direction indicator on the screen border so user knows where off-screen pins are located
          const pad = 16;
          const clampedX = Math.max(pad, Math.min(canvas.width - pad, px));
          const clampedY = Math.max(pad + 54, Math.min(canvas.height - pad - 48, py));

          ctx.save();
          ctx.fillStyle = pin.priority === 'HIGH' ? 'rgba(239, 68, 68, 0.75)' : 'rgba(56, 189, 248, 0.65)';
          ctx.strokeStyle = isSelected ? '#fde047' : 'rgba(15, 23, 42, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(clampedX, clampedY, 4.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          return;
        }

        // Draw pulsing outer threat ring for critical items
        if (pin.priority === 'HIGH') {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)'; // Red alert
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(px, py, pulseRadius, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (isSelected) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'; // Cyan selection ring
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, pulseRadius * 0.85, 0, 2 * Math.PI);
          ctx.stroke();
        }

        // Draw core node dot
        ctx.fillStyle = pin.priority === 'HIGH' ? '#ef4444' : '#38bdf8'; // Red or Cyan
        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 5.5 : 4, 0, 2 * Math.PI);
        ctx.fill();

        // Draw coordinate crosshair bracket
        ctx.strokeStyle = isSelected ? '#fde047' : '#38bdf8';
        ctx.lineWidth = isSelected ? 1.6 : 1.1;
        ctx.strokeRect(px - 8, py - 8, 16, 16);

        // Draw compact callout label next to pin with dark backing for readability
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        const shortLabel = pin.title.length > 24 ? `${pin.title.slice(0, 22)}..` : pin.title;
        const textWidth = ctx.measureText(shortLabel).width;
        const labelX = px + 12 + textWidth > canvas.width - 10 ? px - 12 - textWidth : px + 12;
        const labelY = py + 3;

        ctx.fillStyle = 'rgba(2, 8, 4, 0.82)';
        ctx.fillRect(labelX - 3, labelY - 10, textWidth + 6, 14);
        ctx.fillStyle = isSelected
          ? '#fde047'
          : pin.priority === 'HIGH'
          ? '#fca5a5'
          : '#7dd3fc';
        ctx.fillText(shortLabel, labelX, labelY);
      });

      // Pulse animation loop for threat rings
      pulseRadius = 8 + ((pulseRadius - 8 + 0.22) % 18);
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', syncCanvasSize);
      resizeObserver?.disconnect();
    };
  }, [intelligencePins, selectedPin, centerLat, centerLon, zoom]);

  // Handle canvas click/tap to select nearest intelligence pin (or edge indicator)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // 1. Check visible pins at their true geographic projection
    let clickedPin = intelligencePins.find((pin) => {
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

    // 2. Also allow clicking edge indicators to select & fly to off-screen pins
    if (!clickedPin) {
      const pad = 16;
      clickedPin = intelligencePins.find((pin) => {
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
        const clampedY = Math.max(pad + 54, Math.min(canvas.height - pad - 48, py));
        return Math.hypot(clampedX - clickX, clampedY - clickY) < 16;
      });
      if (clickedPin && onFlyToPin) {
        onFlyToPin(clickedPin);
      }
    }

    updateSelectedPin(clickedPin || null);
  };

  return (
    <div className="relative w-full h-full overflow-hidden pointer-events-auto">
      {/* Interactive Tactical Canvas Layer */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="absolute inset-0 z-10 cursor-crosshair block w-full h-full"
      />

      {/* Selected Pin Dossier Popup (Positioned cleanly above the bottom HUD bar so zero text is obstructed) */}
      {selectedPin && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-14 sm:bottom-16 left-2.5 sm:left-3 right-2.5 sm:right-3 z-40 bg-slate-950/95 border border-emerald-500/70 p-2.5 sm:p-3 rounded font-mono text-xs text-emerald-400 shadow-[0_0_28px_rgba(0,0,0,0.95)] backdrop-blur-md"
        >
          <div className="flex justify-between items-start gap-2 border-b border-emerald-500/30 pb-1.5 mb-1.5">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span
                className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                  selectedPin.priority === 'HIGH'
                    ? 'bg-red-950/80 text-red-400 border-red-500/60'
                    : 'bg-sky-950/80 text-sky-300 border-sky-500/50'
                }`}
              >
                {selectedPin.priority} PRIORITY
              </span>
              {selectedPin.category && (
                <span className="text-[9px] text-amber-400 font-bold">
                  [{selectedPin.category}]
                </span>
              )}
              <span className="font-bold text-amber-300 truncate">
                TARGET: {selectedPin.title}
              </span>
            </div>
            <button
              type="button"
              onClick={() => updateSelectedPin(null)}
              className="text-slate-300 hover:text-white px-1.5 py-0.5 bg-slate-800/90 border border-slate-600 rounded cursor-pointer shrink-0 text-[10px]"
            >
              [X]
            </button>
          </div>
          <p className="text-slate-100 leading-relaxed text-[11px] sm:text-xs line-clamp-3">
            {selectedPin.summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>
              TIMESTAMP: {selectedPin.timestamp} | GEO LOCK: [{selectedPin.lat.toFixed(4)}°, {selectedPin.lon.toFixed(4)}°]
            </span>
            <div className="flex items-center gap-1.5">
              {onFlyToPin &&
                (Math.abs(selectedPin.lat - centerLat) > 0.02 ||
                  Math.abs(selectedPin.lon - centerLon) > 0.02) && (
                  <button
                    type="button"
                    onClick={() => onFlyToPin(selectedPin)}
                    className="px-2 py-0.5 bg-sky-950/90 hover:bg-sky-900 border border-sky-500/60 text-sky-300 font-bold rounded cursor-pointer transition-colors"
                  >
                    [🎯 CENTER ON PIN]
                  </button>
                )}
              {onDispatchPinDirective && (
                <button
                  type="button"
                  onClick={() => onDispatchPinDirective(selectedPin)}
                  className="px-2 py-0.5 bg-emerald-950/90 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 font-bold rounded cursor-pointer transition-colors"
                >
                  [⚡ DISPATCH AGENT TO PIN]
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
