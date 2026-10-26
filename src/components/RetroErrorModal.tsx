import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../context/ThemeContext';
import { useCrew } from '../context/CrewContext';
import { AgentSpriteFigure } from './SpriteCanvas';
import {
  RetroErrorCode,
  RetroErrorDescriptor,
  createRetroAgentError,
} from '../services/ApiService';

interface RetroErrorModalProps {
  error: RetroErrorDescriptor | null;
  onClose: () => void;
  onOpenGearVault: () => void;
  onRetryDirective?: (failedPrompt: string) => void;
  onSwitchSimulatedError?: (nextError: RetroErrorDescriptor) => void;
}

export const RetroErrorModal: React.FC<RetroErrorModalProps> = ({
  error,
  onClose,
  onOpenGearVault,
  onRetryDirective,
  onSwitchSimulatedError,
}) => {
  const { theme, themeId, activeAgent, playBeep } = useTheme();
  const { getCrewAgent } = useCrew();
  const activeCrew = getCrewAgent(activeAgent.id);
  const operativeName = activeCrew?.customName || activeAgent.name;
  const spriteVariant = activeCrew?.spriteVariant || 'trenchcoat';

  const [alarmStrobeOn, setAlarmStrobeOn] = useState(true);
  const [panicWalkFrame, setPanicWalkFrame] = useState<1 | 2>(1);
  const [panicFacing, setPanicFacing] = useState<'left' | 'right'>('right');
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Flashing red pixel alarm light + panicked sprite frame loop
  useEffect(() => {
    if (!error) return;
    const strobeTimer = setInterval(() => {
      setAlarmStrobeOn((prev) => !prev);
      setPanicWalkFrame((prev) => (prev === 1 ? 2 : 1));
    }, 240);

    const turnTimer = setInterval(() => {
      setPanicFacing((prev) => (prev === 'right' ? 'left' : 'right'));
    }, 520);

    return () => {
      clearInterval(strobeTimer);
      clearInterval(turnTimer);
    };
  }, [error]);

  // Thermal cooldown countdown when HTTP 429 RATE_LIMIT is active
  useEffect(() => {
    if (!error) return;
    if (error.code === 'RATE_LIMIT') {
      const initialSeconds = error.retryAfterSeconds || 15;
      setCooldownRemaining(initialSeconds);
      const timer = setInterval(() => {
        setCooldownRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    } else {
      setCooldownRemaining(0);
    }
  }, [error]);

  const totalCooldown = error?.retryAfterSeconds || 15;
  const cooldownProgressPct =
    error?.code === 'RATE_LIMIT'
      ? Math.round(((totalCooldown - cooldownRemaining) / totalCooldown) * 100)
      : 100;

  const handleTriggerSimCode = (code: RetroErrorCode) => {
    playBeep('error');
    const simulated = createRetroAgentError({
      code,
      themeId,
      failedPrompt: error?.failedPrompt,
    });
    onSwitchSimulatedError?.(simulated.descriptor);
  };

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key="retro-error-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="retro-error-headline"
        >
          {/* Outer Pixel-Art Red CRT Alarm Frame */}
          <motion.div
            initial={{ scale: 0.92, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className={`w-full max-w-lg rounded-none bg-[#140b0d] border-2 ${
              alarmStrobeOn
                ? 'border-[#ef4444] shadow-[0_0_36px_rgba(239,68,68,0.55)]'
                : 'border-[#7f1d1d] shadow-[0_0_16px_rgba(127,29,29,0.35)]'
            } overflow-hidden font-mono-tabular transition-shadow duration-150`}
          >
            {/* Top Flashing Red Hazard Strip */}
            <div
              className={`px-3.5 py-2 border-b-2 flex items-center justify-between gap-2 transition-colors duration-150 ${
                alarmStrobeOn
                  ? 'bg-[#3b0d11] border-[#ef4444]'
                  : 'bg-[#22080a] border-[#7f1d1d]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* Pixel-Art Flashing Red Alarm Siren Light SVG */}
                <svg
                  viewBox="0 0 18 18"
                  className="w-5 h-5 shrink-0 pixelated"
                  shapeRendering="crispEdges"
                  aria-hidden="true"
                >
                  {/* Siren Base Pedestal */}
                  <rect x="3" y="14" width="12" height="3" fill="#475569" />
                  <rect x="4" y="13" width="10" height="1" fill="#94a3b8" />
                  {/* Siren Dome */}
                  <rect
                    x="5"
                    y="5"
                    width="8"
                    height="8"
                    fill={alarmStrobeOn ? '#ef4444' : '#7f1d1d'}
                  />
                  <rect
                    x="6"
                    y="4"
                    width="6"
                    height="1"
                    fill={alarmStrobeOn ? '#f87171' : '#991b1b'}
                  />
                  {/* Inner Filament Core */}
                  <rect
                    x="7"
                    y="7"
                    width="4"
                    height="4"
                    fill={alarmStrobeOn ? '#fef08a' : '#b91c1c'}
                  />
                  {/* Pixel Light Rays (Visible when Strobe ON) */}
                  {alarmStrobeOn && (
                    <>
                      <rect x="8" y="0" width="2" height="3" fill="#f87171" />
                      <rect x="1" y="3" width="3" height="2" fill="#f87171" />
                      <rect x="14" y="3" width="3" height="2" fill="#f87171" />
                      <rect x="0" y="8" width="3" height="2" fill="#ef4444" />
                      <rect x="15" y="8" width="3" height="2" fill="#ef4444" />
                    </>
                  )}
                </svg>

                <div className="flex flex-col min-w-0">
                  <span className="text-xs sm:text-sm font-bold tracking-wider text-[#fca5a5] uppercase truncate">
                    [🚨 RED ALERT · {theme.shortLabel.toUpperCase()} FAULT INTERCEPTED]
                  </span>
                  <span className="text-[10px] text-[#f87171]">
                    {error.retroBadge} · HTTP {error.httpStatus}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onClose();
                }}
                className="px-2 py-0.5 bg-[#1a090b] hover:bg-[#ef4444] text-[#fca5a5] hover:text-[#120708] border border-[#ef4444]/60 text-xs font-bold cursor-pointer shrink-0"
                aria-label="Close error overlay"
              >
                [X]
              </button>
            </div>

            {/* Main Retro Error Body: Panicked Pixel Sprite + Thematic Error Dialogue */}
            <div className="p-4 sm:p-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row items-center sm:items-stretch gap-4 bg-[#0d0607] border border-[#5c191e] p-3.5 relative overflow-hidden">
                {/* Panicked Pixel Sprite Chamber */}
                <div className="w-28 sm:w-28 shrink-0 bg-[#180a0d] border border-[#ef4444]/60 flex flex-col items-center justify-between p-2 relative">
                  {/* Flashing [! PANIC !] Pixel Tag */}
                  <div
                    className={`w-full text-center text-[9px] font-bold py-0.5 border ${
                      alarmStrobeOn
                        ? 'bg-[#ef4444] text-[#140708] border-[#fca5a5]'
                        : 'bg-[#2a0c10] text-[#f87171] border-[#7f1d1d]'
                    }`}
                  >
                    {error.code === 'RATE_LIMIT' ? '[! OVERHEAT !]' : '[! PANIC !]'}
                  </div>

                  {/* Animated Panicked Operative Sprite */}
                  <motion.div
                    animate={{
                      x: alarmStrobeOn ? [-3, 3, -2, 2, 0] : [2, -2, 3, -3, 0],
                      y: alarmStrobeOn ? [-2, 0, -2, 0] : [0, -1, 0],
                    }}
                    transition={{ duration: 0.24, ease: 'linear' }}
                    className="w-12 my-1.5 relative"
                  >
                    {/* Pixel Sweat / Spark Drops */}
                    <svg
                      viewBox="0 0 24 10"
                      className="w-full h-2.5 pixelated mb-0.5"
                      shapeRendering="crispEdges"
                    >
                      {alarmStrobeOn ? (
                        <>
                          <rect x="2" y="2" width="2" height="4" fill="#38bdf8" />
                          <rect x="20" y="1" width="2" height="4" fill="#facc15" />
                        </>
                      ) : (
                        <>
                          <rect x="1" y="5" width="2" height="4" fill="#38bdf8" />
                          <rect x="21" y="4" width="2" height="4" fill="#ef4444" />
                        </>
                      )}
                    </svg>

                    <AgentSpriteFigure
                      spriteVariant={spriteVariant}
                      pose="walking"
                      walkFrame={panicWalkFrame}
                      facing={panicFacing}
                      isMoving={true}
                      themeId={themeId}
                      alt={`${operativeName} in panicked state`}
                    />
                  </motion.div>

                  <span className="text-[9px] text-[#fca5a5] truncate max-w-full font-semibold">
                    {operativeName}
                  </span>
                </div>

                {/* Retro Headline & Theme-Specific RPG Flavor Text */}
                <div className="flex-1 flex flex-col justify-between gap-2 min-w-0">
                  <div>
                    <div className="inline-block px-1.5 py-0.5 bg-[#2d0c10] border border-[#ef4444]/50 text-[10px] text-[#fca5a5] mb-1.5">
                      CODE: {error.retroBadge}
                    </div>
                    <h3
                      id="retro-error-headline"
                      className="text-xs sm:text-sm font-bold text-[#fef2f2] leading-snug tracking-wide"
                    >
                      {error.headline}
                    </h3>
                    <p className="text-xs text-[#fecaca] mt-2 leading-relaxed">
                      <span className="text-[#f87171] font-bold">{operativeName}:</span>{' '}
                      &ldquo;{error.themeFlavorText}&rdquo;
                    </p>
                  </div>

                  {/* Remediation Hint */}
                  <div className="pt-2 border-t border-[#3b1216] text-[11px] text-[#fde047] leading-snug">
                    <span className="font-bold uppercase">Quick Fix: </span>
                    <span>{error.remediationHint}</span>
                  </div>
                </div>
              </div>

              {/* Rate-Limit (HTTP 429) Pixel Thermal Cooldown Gauge */}
              {error.code === 'RATE_LIMIT' && (
                <div className="bg-[#1b0c0e] border border-[#f59e0b]/60 p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#fbbf24] font-bold uppercase">
                      🌡️ CORE THERMAL COOLDOWN GAUGE
                    </span>
                    <span className="text-[#fde68a]">
                      {cooldownRemaining > 0
                        ? `VENTING HEAT... [${cooldownRemaining}s]`
                        : 'CORE STABILIZED · READY'}
                    </span>
                  </div>
                  <div className="grid grid-cols-12 gap-1 pt-0.5">
                    {Array.from({ length: 12 }).map((_, idx) => {
                      const filled = (idx + 1) / 12 <= cooldownProgressPct / 100;
                      return (
                        <div
                          key={idx}
                          className={`h-2.5 border ${
                            filled
                              ? cooldownRemaining === 0
                                ? 'bg-[#4ade80] border-[#22c55e]'
                                : 'bg-[#f59e0b] border-[#d97706]'
                              : 'bg-[#2a0e11] border-[#5c191e]'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Raw Telemetry Trace & Diagnostic Mode Switcher */}
              <div className="bg-[#0b0506] border border-[#381216] px-3 py-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] text-[#94a3b8]">
                  <span>INTERCEPTED TRACE:</span>
                  <span>{new Date(error.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="text-[11px] text-[#f87171] break-words">
                  &gt; {error.technicalDetail}
                </div>

                {onSwitchSimulatedError && (
                  <div className="pt-1.5 mt-1 border-t border-[#290d10] flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-[10px] text-[#9c8265]">
                      Simulate Fault Mode:
                    </span>
                    <div className="flex flex-wrap items-center gap-1">
                      {(
                        [
                          { code: 'INVALID_API_KEY', label: '401 Key' },
                          { code: 'RATE_LIMIT', label: '429 Overheat' },
                          { code: 'NETWORK_DROP', label: '503 Net' },
                          { code: 'MALFORMED_JSON', label: '422 JSON' },
                        ] as Array<{ code: RetroErrorCode; label: string }>
                      ).map((item) => (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() => handleTriggerSimCode(item.code)}
                          className={`px-1.5 py-0.5 text-[10px] border cursor-pointer ${
                            error.code === item.code
                              ? 'bg-[#ef4444] text-[#140708] border-[#fca5a5] font-bold'
                              : 'bg-[#1a0a0c] text-[#fca5a5] border-[#5c191e] hover:border-[#ef4444]'
                          }`}
                        >
                          [{item.label}]
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Primary Quick-Fix Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
                {/* Direct Pixel-Styled Quick-Fix Button to immediately open Gear Vault [⚙️] */}
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onClose();
                    onOpenGearVault();
                  }}
                  className="flex-1 min-h-[40px] px-4 py-2 bg-[#e59838] hover:bg-[#f5a642] text-[#121110] border-2 border-[#fde047] font-bold text-xs sm:text-sm tracking-wide flex items-center justify-center gap-2 shadow-[0_0_16px_rgba(229,152,56,0.4)] cursor-pointer"
                >
                  <span aria-hidden="true">⚙️</span>
                  <span>[⚙️ OPEN GEAR VAULT]</span>
                </button>

                {onRetryDirective && error.failedPrompt && (
                  <button
                    type="button"
                    onClick={() => {
                      const promptToRetry = error.failedPrompt!;
                      playBeep('tap');
                      onClose();
                      onRetryDirective(promptToRetry);
                    }}
                    className="min-h-[40px] px-3.5 py-2 bg-[#1c2430] hover:bg-[#263142] text-[#4ade80] border border-[#4ade80] font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>[🔄 RETRY]</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onClose();
                  }}
                  className="min-h-[40px] px-3.5 py-2 bg-[#241013] hover:bg-[#33161a] text-[#fca5a5] border border-[#7f1d1d] text-xs sm:text-sm cursor-pointer"
                >
                  [DISMISS]
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
