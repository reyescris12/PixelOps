import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThemeId, useTheme } from '../context/ThemeContext';

export type LaneSymbol = '<' | 'A' | 'B' | '>';

interface FallingNode {
  id: number;
  symbol: LaneSymbol;
  lane: number; // 0, 1, 2, 3
  y: number; // 0 to 100 (%)
  status: 'falling' | 'hit' | 'missed';
}

export interface GameOverlayProps {
  isActive: boolean;
  isClosing?: boolean;
  themeId?: ThemeId;
  targetHits?: number;
  onBoostChange?: (boostPct: number) => void;
  onSequenceComplete: (finalBoostPct: number) => void;
  onAbort?: () => void;
}

const LANE_SYMBOLS: LaneSymbol[] = ['<', 'A', 'B', '>'];

const THEME_GAME_META: Record<
  ThemeId,
  {
    title: string;
    boostLabel: string;
    completeBanner: string;
    tintBg: string;
    borderColor: string;
    accentHex: string;
    targetZoneBg: string;
    buttonActiveBg: string;
  }
> = {
  green: {
    title: 'PHOSPHOR GREEN // BUFFER SYNC',
    boostLabel: 'BAUD BOOST',
    completeBanner: 'BUFFER SYNCED · +150 TOKEN BONUS',
    tintBg: 'rgba(4, 12, 8, 0.88)',
    borderColor: '#4ade80',
    accentHex: '#4ade80',
    targetZoneBg: 'rgba(74, 222, 128, 0.16)',
    buttonActiveBg: '#15803d',
  },
  amber: {
    title: 'AMBER CRT // FREQUENCY OVERRIDE',
    boostLabel: 'DECRYPTION BOOST',
    completeBanner: 'OVERRIDE COMPLETE · +150 TOKEN BONUS',
    tintBg: 'rgba(28, 18, 10, 0.88)',
    borderColor: '#f59e0b',
    accentHex: '#f59e0b',
    targetZoneBg: 'rgba(245, 158, 11, 0.16)',
    buttonActiveBg: '#92400e',
  },
  cyan: {
    title: 'NEON CYAN // ICE BREAKER',
    boostLabel: 'NEON BOOST',
    completeBanner: 'ICE BROKEN · +150 TOKEN BONUS',
    tintBg: 'rgba(8, 20, 36, 0.88)',
    borderColor: '#38bdf8',
    accentHex: '#38bdf8',
    targetZoneBg: 'rgba(56, 189, 248, 0.16)',
    buttonActiveBg: '#0369a1',
  },
  ruby: {
    title: 'CRIMSON RUBY // CORE OVERRIDE',
    boostLabel: 'RUBY BOOST',
    completeBanner: 'OVERRIDE COMPLETE · +150 TOKEN BONUS',
    tintBg: 'rgba(20, 8, 10, 0.88)',
    borderColor: '#ef4444',
    accentHex: '#ef4444',
    targetZoneBg: 'rgba(239, 68, 68, 0.16)',
    buttonActiveBg: '#991b1b',
  },
  purple: {
    title: 'AMETHYST PURPLE // FLUX SYNC',
    boostLabel: 'FLUX BOOST',
    completeBanner: 'FLUX SYNCHRONIZED · +150 TOKEN BONUS',
    tintBg: 'rgba(13, 8, 20, 0.88)',
    borderColor: '#c084fc',
    accentHex: '#c084fc',
    targetZoneBg: 'rgba(192, 132, 252, 0.16)',
    buttonActiveBg: '#6b21a8',
  },
};

export const GameOverlay: React.FC<GameOverlayProps> = ({
  isActive,
  isClosing = false,
  themeId: propThemeId,
  targetHits = 5,
  onBoostChange,
  onSequenceComplete,
  onAbort,
}) => {
  const { themeId: contextThemeId, playBeep } = useTheme();
  const activeThemeId = propThemeId || contextThemeId;
  const meta = THEME_GAME_META[activeThemeId] || THEME_GAME_META.green;

  const [nodes, setNodes] = useState<FallingNode[]>([]);
  const [hits, setHits] = useState(0);
  const [decryptionBoost, setDecryptionBoost] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<'HIT' | 'MISS' | 'READY'>('READY');
  const [flashLane, setFlashLane] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);

  const nextIdRef = useRef(1);
  const completedRef = useRef(false);
  const nodesRef = useRef<FallingNode[]>([]);
  const hitsRef = useRef(0);

  // Reset state when overlay activates
  useEffect(() => {
    if (isActive) {
      nodesRef.current = [];
      hitsRef.current = 0;
      setNodes([]);
      setHits(0);
      setDecryptionBoost(0);
      setLastFeedback('READY');
      setCompleted(false);
      completedRef.current = false;
      nextIdRef.current = 1;
    }
  }, [isActive]);

  // Spawn falling pixel symbols periodically
  useEffect(() => {
    if (!isActive || isClosing || completed) return;

    const spawnNode = () => {
      const lane = Math.floor(Math.random() * 4);
      const symbol = LANE_SYMBOLS[lane];
      const newNode: FallingNode = {
        id: nextIdRef.current++,
        symbol,
        lane,
        y: 6,
        status: 'falling',
      };
      const updated = [...nodesRef.current.slice(-10), newNode];
      nodesRef.current = updated;
      setNodes(updated);
    };

    // Immediate first node so player can act right away
    spawnNode();
    const spawnInterval = setInterval(spawnNode, 650);
    return () => clearInterval(spawnInterval);
  }, [isActive, isClosing, completed]);

  // 2D Gameplay loop advancing symbol Y positions toward target zone (y: 72% - 88%)
  useEffect(() => {
    if (!isActive || isClosing || completed) return;

    const tickInterval = setInterval(() => {
      const updated = nodesRef.current
        .map((node) => {
          if (node.status !== 'falling') return node;
          const nextY = node.y + 3.4;
          if (nextY > 94) {
            return { ...node, y: nextY, status: 'missed' as const };
          }
          return { ...node, y: nextY };
        })
        .filter((node) => node.y <= 98);

      nodesRef.current = updated;
      setNodes(updated);
    }, 50);

    return () => clearInterval(tickInterval);
  }, [isActive, isClosing, completed]);

  const handleLaneInput = useCallback(
    (laneIndex: number) => {
      if (!isActive || isClosing || completedRef.current) return;

      setFlashLane(laneIndex);
      setTimeout(() => setFlashLane(null), 140);

      // Find the lowest falling node in this lane within or near the target zone (50% to 92%)
      const candidates = nodesRef.current.filter(
        (n) => n.lane === laneIndex && n.status === 'falling' && n.y >= 50 && n.y <= 92
      );

      if (candidates.length === 0) {
        setLastFeedback('MISS');
        return;
      }

      const targetNode = candidates.reduce((a, b) => (a.y > b.y ? a : b));
      const updatedNodes = nodesRef.current.map((n) =>
        n.id === targetNode.id ? { ...n, status: 'hit' as const } : n
      );
      nodesRef.current = updatedNodes;
      setNodes(updatedNodes);

      playBeep('tap');
      setLastFeedback('HIT');

      const nextHits = hitsRef.current + 1;
      hitsRef.current = nextHits;
      setHits(nextHits);

      const nextBoost = Math.min(100, Math.round((nextHits / targetHits) * 100));
      setDecryptionBoost(nextBoost);
      onBoostChange?.(nextBoost);

      if (nextHits >= targetHits && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        playBeep('complete');
        setTimeout(() => {
          onSequenceComplete(100);
        }, 450);
      }
    },
    [isActive, isClosing, onBoostChange, onSequenceComplete, playBeep, targetHits]
  );

  // Keyboard shortcuts (< / ArrowLeft, A, B, > / ArrowRight)
  useEffect(() => {
    if (!isActive || isClosing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === '<' || e.key === ',') {
        e.preventDefault();
        handleLaneInput(0);
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handleLaneInput(1);
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        handleLaneInput(2);
      } else if (e.key === 'ArrowRight' || e.key === '>' || e.key === '.') {
        e.preventDefault();
        handleLaneInput(3);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, isClosing, handleLaneInput]);

  if (!isActive && !isClosing) return null;

  return (
    <div
      className={`absolute inset-0 z-30 flex flex-col justify-between select-none transition-opacity duration-300 ${
        isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{ backgroundColor: meta.tintBg }}
    >
      {/* Circuit-Board SVG Background Grid */}
      <svg
        viewBox="0 0 320 180"
        className="absolute inset-0 w-full h-full opacity-25 pointer-events-none pixelated"
        shapeRendering="crispEdges"
      >
        {/* Circuit traces */}
        <path
          d="M 10 20 H 60 V 50 H 110 M 220 15 H 280 V 65 H 310 M 25 130 H 85 V 95 H 140 M 200 120 H 265 V 85"
          fill="none"
          stroke={meta.accentHex}
          strokeWidth="1.5"
        />
        {/* Vertical lane dividers */}
        <line x1="80" y1="24" x2="80" y2="140" stroke={meta.accentHex} strokeWidth="0.75" strokeDasharray="3 3" />
        <line x1="160" y1="24" x2="160" y2="140" stroke={meta.accentHex} strokeWidth="0.75" strokeDasharray="3 3" />
        <line x1="240" y1="24" x2="240" y2="140" stroke={meta.accentHex} strokeWidth="0.75" strokeDasharray="3 3" />
      </svg>

      {/* Top Mini-Game Telemetry Header */}
      <div
        className="relative z-10 px-2.5 sm:px-3 py-1 sm:py-1.5 bg-[#090d12]/95 border-b flex items-center justify-between gap-2"
        style={{ borderColor: meta.borderColor }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-pixel text-[9px] sm:text-xs tracking-wider font-bold truncate"
            style={{ color: meta.accentHex }}
          >
            {meta.title}
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 font-mono-tabular text-[10px] sm:text-xs shrink-0 whitespace-nowrap">
          <span className="text-slate-300">
            <span className="hidden sm:inline">{meta.boostLabel}: </span>
            <strong style={{ color: meta.accentHex }}>+{decryptionBoost}%</strong>
          </span>
          <span className="text-slate-400">
            [{hits}/{targetHits}]
          </span>
          {onAbort && (
            <button
              type="button"
              onClick={onAbort}
              className="px-1.5 py-0.5 text-[10px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            >
              [SKIP]
            </button>
          )}
        </div>
      </div>

      {/* Central 4-Lane Scrolling Circuit Field */}
      <div className="relative z-10 flex-1 w-full max-w-lg mx-auto overflow-hidden">
        {/* Target Intercept Zone Band (y: 68% to 88%) */}
        <div
          className="absolute left-2 right-2 border-y-2 flex items-center justify-between px-3 pointer-events-none"
          style={{
            top: '68%',
            height: '20%',
            borderColor: meta.borderColor,
            backgroundColor: meta.targetZoneBg,
          }}
        >
          <span
            className="font-mono-tabular text-[10px] uppercase tracking-widest opacity-80"
            style={{ color: meta.accentHex }}
          >
            TARGET INTERCEPT ZONE
          </span>
          <span
            className="font-pixel text-[10px]"
            style={{
              color:
                lastFeedback === 'HIT'
                  ? '#4ade80'
                  : lastFeedback === 'MISS'
                  ? '#f87171'
                  : meta.accentHex,
            }}
          >
            [{lastFeedback}]
          </span>
        </div>

        {/* Scrolling Pixel Symbol Nodes */}
        {nodes.map((node) => {
          if (node.status === 'hit') return null;
          const leftPct = node.lane * 25 + 12.5;
          const isInZone = node.y >= 62 && node.y <= 90;
          return (
            <div
              key={node.id}
              style={{
                top: `${node.y}%`,
                left: `${leftPct}%`,
                borderColor: isInZone ? '#ffffff' : meta.borderColor,
                color: isInZone ? '#0a0a0c' : meta.accentHex,
                backgroundColor: isInZone ? meta.accentHex : '#0c1218',
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-7 sm:w-11 sm:h-8 border-2 font-pixel text-xs sm:text-sm font-bold flex items-center justify-center shadow-md pointer-events-none"
            >
              {node.symbol}
            </div>
          );
        })}

        {/* Sequence Complete Victory Banner */}
        {completed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 z-20">
            <div
              className="px-5 py-3 bg-[#0c1218] border-2 text-center shadow-2xl"
              style={{ borderColor: meta.borderColor }}
            >
              <div
                className="font-pixel text-xs sm:text-sm font-bold"
                style={{ color: meta.accentHex }}
              >
                {meta.completeBanner}
              </div>
              <div className="font-mono-tabular text-xs text-slate-200 mt-1">
                Decryption Override 100% — Unlocking Agent Telemetry
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom 4 Large Pixel-Art Touch Buttons (<, A, B, >) */}
      <div className="relative z-10 w-full max-w-lg mx-auto px-2 pb-1.5 sm:pb-2 pt-1 grid grid-cols-4 gap-1.5 sm:gap-2">
        {LANE_SYMBOLS.map((symbol, idx) => {
          const isFlashing = flashLane === idx;
          return (
            <button
              key={symbol}
              type="button"
              onClick={() => handleLaneInput(idx)}
              style={{
                borderColor: meta.borderColor,
                backgroundColor: isFlashing ? meta.buttonActiveBg : '#0d141b',
                color: isFlashing ? '#ffffff' : meta.accentHex,
              }}
              className="min-h-[38px] sm:min-h-[52px] border-2 font-pixel text-xs sm:text-base font-bold flex items-center justify-center shadow-[0_3px_0_rgba(0,0,0,0.8)] active:translate-y-[1px] transition-colors cursor-pointer select-none"
            >
              [{symbol}]
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GameOverlay;
