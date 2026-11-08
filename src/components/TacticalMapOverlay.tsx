import React, { useEffect, useRef, useState } from 'react';

export interface TacticalIntelPin {
  id: string;
  x: number; // 0..100 percentage of canvas width
  y: number; // 0..100 percentage of canvas height
  title: string;
  summary: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  timestamp: string;
  category?: string;
  lat?: number;
  lon?: number;
}

interface TacticalMapOverlayProps {
  intelligencePins?: TacticalIntelPin[];
  mapCenter?: { x: number; y: number };
  onSelectPin?: (pin: TacticalIntelPin) => void;
  onDispatchPinDirective?: (pin: TacticalIntelPin) => void;
}

export default function TacticalMapOverlay({
  intelligencePins = [],
  mapCenter = { x: 0, y: 0 },
  onSelectPin,
  onDispatchPinDirective,
}: TacticalMapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPin, setSelectedPin] = useState<TacticalIntelPin | null>(null);

  // Render tactical rings, crosshairs, and intel markers on canvas
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
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.12)'; // Emerald tint
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

      // 2. Render Intelligence & Wire Pins
      intelligencePins.forEach((pin) => {
        // Map lat/lng or normalized coordinates to canvas space
        const px = (pin.x / 100) * canvas.width;
        const py = (pin.y / 100) * canvas.height;
        const isSelected = selectedPin?.id === pin.id;

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
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.strokeRect(px - 8, py - 8, 16, 16);

        // Draw compact callout label next to pin
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.fillStyle = pin.priority === 'HIGH' ? '#fca5a5' : '#7dd3fc';
        const shortLabel = pin.title.length > 22 ? `${pin.title.slice(0, 20)}..` : pin.title;
        ctx.fillText(shortLabel, px + 11, py + 3);
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
  }, [intelligencePins, selectedPin, mapCenter]);

  // Handle canvas click/tap to select nearest intelligence pin
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // Find if click is near any pin (within 20px radius for mobile touch comfort)
    const clickedPin = intelligencePins.find((pin) => {
      const px = (pin.x / 100) * canvas.width;
      const py = (pin.y / 100) * canvas.height;
      return Math.hypot(px - clickX, py - clickY) < 20;
    });

    const nextPin = clickedPin || null;
    setSelectedPin(nextPin);
    if (nextPin && onSelectPin) {
      onSelectPin(nextPin);
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden pointer-events-auto">
      {/* Interactive Tactical Canvas Layer */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="absolute inset-0 z-10 cursor-crosshair block w-full h-full"
      />

      {/* Selected Pin Dossier Popup (Retro Terminal Style) */}
      {selectedPin && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 right-2 sm:right-3 z-20 bg-slate-900/95 border border-emerald-500/60 p-2.5 sm:p-3 rounded font-mono text-xs text-emerald-400 shadow-[0_0_24px_rgba(0,0,0,0.9)] backdrop-blur-md"
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
              onClick={() => setSelectedPin(null)}
              className="text-slate-400 hover:text-white px-1.5 py-0.5 bg-slate-800/80 border border-slate-700 rounded cursor-pointer shrink-0 text-[10px]"
            >
              [X]
            </button>
          </div>
          <p className="text-slate-200 leading-relaxed text-[11px] sm:text-xs line-clamp-3">
            {selectedPin.summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>
              TIMESTAMP: {selectedPin.timestamp} | COORD: [{selectedPin.x.toFixed(0)}%, {selectedPin.y.toFixed(0)}%]
              {typeof selectedPin.lat === 'number' && typeof selectedPin.lon === 'number'
                ? ` · (${selectedPin.lat.toFixed(2)}°, ${selectedPin.lon.toFixed(2)}°)`
                : ''}
            </span>
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
      )}
    </div>
  );
}
