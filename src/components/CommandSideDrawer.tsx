import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import {
  PanelLeftOpen,
  X,
  Settings,
  Volume2,
  VolumeX,
  Radar,
  Moon,
  Activity,
  ShieldAlert,
  BookOpen,
  Cpu,
  ChevronRight,
  Radio,
  Zap,
} from 'lucide-react';
import { useTheme, THEMES, ThemeId } from '../context/ThemeContext';
import { PWAInstallButton } from './PWAInstallButton';

export interface CommandSideDrawerProps {
  sectorBadge: string;
  sectorCode: string;
  activeOperativeName: string;
  soundTitle: string;
  soundDescription: string;
  soundShortTag: string;
  onToggleSound: () => void;
  isMeetingActive: boolean;
  decryptionBoost: number;
  authInfo: {
    isConnected: boolean;
    badge: string;
    title: string;
    subtitle: string;
  };
  isReconOverlayOpen: boolean;
  nightShiftUnreadCount: number;
  onOpenSettings: () => void;
  onToggleReconOverlay: () => void;
  onOpenNightShift: () => void;
  onOpenTelemetry: () => void;
  onOpenThreatMonitor: () => void;
  onOpenFieldManual: () => void;
  onOpenThemesConsole: () => void;
}

export const CommandSideDrawer: React.FC<CommandSideDrawerProps> = ({
  sectorBadge,
  sectorCode,
  activeOperativeName,
  soundTitle,
  soundDescription,
  soundShortTag,
  onToggleSound,
  isMeetingActive,
  decryptionBoost,
  authInfo,
  isReconOverlayOpen,
  nightShiftUnreadCount,
  onOpenSettings,
  onToggleReconOverlay,
  onOpenNightShift,
  onOpenTelemetry,
  onOpenThreatMonitor,
  onOpenFieldManual,
  onOpenThemesConsole,
}) => {
  const { theme, themeId, setThemeId, soundEnabled, playBeep } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const drawerId = useId();
  const drawerTitleId = useId();

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const closeSafetyTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeSafetyTimerRef.current !== null) {
      window.clearTimeout(closeSafetyTimerRef.current);
      closeSafetyTimerRef.current = null;
    }
  }, []);

  const finalizeClosedState = useCallback(() => {
    clearCloseTimer();
    const dialog = dialogRef.current;
    if (dialog && dialog.open) {
      dialog.close();
    }
    setIsOpen(false);
    if (pendingActionRef.current) {
      const fn = pendingActionRef.current;
      pendingActionRef.current = null;
      fn();
    }
  }, [clearCloseTimer]);

  const openDrawer = useCallback(async () => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !scroller || !sheet) return;

    clearCloseTimer();
    playBeep('switch');

    if (!dialog.open) {
      dialog.showModal();
    }
    setIsOpen(true);

    const supportsInitialTarget =
      typeof CSS !== 'undefined' && CSS.supports('scroll-initial-target', 'nearest');

    if (!supportsInitialTarget || scroller.scrollLeft < sheet.offsetWidth * 0.5) {
      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'instant' as ScrollBehavior });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    }

    scroller.scrollTo({ left: 0, behavior: 'auto' });
  }, [clearCloseTimer, playBeep]);

  const closeDrawer = useCallback(
    (afterClose?: () => void) => {
      const dialog = dialogRef.current;
      const scroller = scrollerRef.current;
      if (afterClose) {
        pendingActionRef.current = afterClose;
      }

      if (!dialog || !dialog.open || !scroller) {
        finalizeClosedState();
        return;
      }

      scroller.scrollTo({ left: scroller.offsetWidth, behavior: 'auto' });

      // Safety net if reduced-motion or tab visibility skips smooth scroll frames
      clearCloseTimer();
      closeSafetyTimerRef.current = window.setTimeout(() => {
        finalizeClosedState();
      }, 320);
    },
    [clearCloseTimer, finalizeClosedState]
  );

  // IntersectionObserver tracks physical sheet visibility across swipe, click, and Escape paths
  useEffect(() => {
    const dialog = dialogRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !sheet || typeof IntersectionObserver === 'undefined') return;

    const visibleThreshold = Math.min(0.02, 1 / Math.max(1, window.innerWidth));
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (entry.intersectionRatio < visibleThreshold) {
          if (dialog.open) {
            finalizeClosedState();
          }
        } else if (entry.intersectionRatio >= 0.98) {
          if (dialog.open) {
            setIsOpen(true);
          }
        }
      },
      { root: dialog, threshold: [visibleThreshold, 0.98, 1] }
    );

    observer.observe(sheet);
    return () => observer.disconnect();
  }, [finalizeClosedState]);

  // Progressive enhancement fallback for browsers without CSS scroll-driven animation-timeline
  useEffect(() => {
    const dialog = dialogRef.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!dialog || !scroller || !sheet) return;

    const supportsScrollTimeline =
      typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');
    if (supportsScrollTimeline) return;

    const handleScroll = () => {
      const width = Math.max(1, sheet.offsetWidth);
      const ratio = Math.max(0, Math.min(1, 1 - scroller.scrollLeft / width));
      dialog.style.setProperty('--drawer-backdrop', ratio.toFixed(3));
    };

    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    return () => clearCloseTimer();
  }, [clearCloseTimer]);

  const isGoogleAuth = authInfo.badge.includes('GOOGLE');

  return (
    <>
      {/* Slim Tactical CRT Header Bar Containing the SYS MENU Drawer Button */}
      <header
        className="tactical-scanlines bg-[#0b0e15] border-b px-2.5 sm:px-4 py-1.5 flex items-center justify-between gap-3 shrink-0 w-full z-20 select-none font-mono-tabular"
        style={{
          borderColor: 'var(--theme-border-color)',
          paddingTop: 'max(6px, env(safe-area-inset-top, 6px))',
          paddingLeft: 'max(10px, env(safe-area-inset-left, 10px))',
          paddingRight: 'max(10px, env(safe-area-inset-right, 10px))',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={openDrawer}
            aria-expanded={isOpen}
            aria-controls={drawerId}
            title={`Open ${theme.shortLabel} Command System Drawer`}
            className="tactical-ctrl min-h-[34px] pl-2.5 pr-3 py-1 bg-[#101624] hover:bg-[#172034] border rounded-sm flex items-center gap-2 text-xs font-bold text-[#e6edf7] cursor-pointer relative overflow-hidden shrink-0"
            style={{
              borderColor: 'var(--theme-border-color)',
              boxShadow: '0 0 12px var(--theme-glow-soft)',
            }}
          >
            {/* Glowing Left Phosphor Spine */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{
                backgroundColor: 'rgb(var(--theme-primary-rgb))',
                boxShadow: '0 0 8px var(--theme-glow-color)',
              }}
            />

            <PanelLeftOpen
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: 'rgb(var(--theme-primary-rgb))' }}
              aria-hidden="true"
            />

            <span className="tracking-wider uppercase whitespace-nowrap">SYS MENU</span>

            {/* Live Compact Telemetry Pips */}
            <span className="flex items-center gap-1 pl-1.5 border-l border-[#263044]" aria-hidden="true">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  authInfo.isConnected ? 'bg-[#4ade80] animate-pulse' : 'bg-[#64748b]'
                }`}
              />
              {nightShiftUnreadCount > 0 && (
                <span className="px-1 py-0.2 bg-[#e59838] text-[#121110] text-[9px] font-bold leading-tight">
                  {nightShiftUnreadCount}
                </span>
              )}
            </span>
          </button>

          <span
            className="font-pixel text-xs uppercase tracking-wider truncate hidden xs:inline sm:inline"
            style={{
              color: 'rgb(var(--theme-primary-rgb))',
              textShadow: '0 0 8px var(--theme-glow-color)',
            }}
          >
            SAFEHOUSE // {theme.shortLabel} v1.0
          </span>
        </div>

        {/* Passive Right-Side Sector & Alert Status Readout */}
        <div className="flex items-center gap-2 text-[11px] text-[#94a3b8] shrink-0">
          {isMeetingActive && (
            <span className="px-1.5 py-0.5 bg-[#38bdf8]/15 border border-[#38bdf8] text-[#38bdf8] text-[10px] font-bold animate-pulse hidden md:inline-flex items-center gap-1">
              <Radio className="w-3 h-3" aria-hidden="true" />
              <span>[ROUNDTABLE]</span>
            </span>
          )}
          {decryptionBoost > 0 && (
            <span className="px-1.5 py-0.5 bg-[#4ade80]/15 border border-[#4ade80] text-[#4ade80] text-[10px] font-bold hidden sm:inline-flex items-center gap-1">
              <Zap className="w-3 h-3" aria-hidden="true" />
              <span>[+{decryptionBoost}%]</span>
            </span>
          )}
          <span className="text-[10px] sm:text-[11px] whitespace-nowrap">
            <span className="text-[#64748b] hidden sm:inline">SECTOR: </span>
            <strong className="text-[#e59838]">{sectorBadge}</strong>{' '}
            <span className="text-[#64748b]">({sectorCode})</span>
          </span>
        </div>
      </header>

      {/* Top-Layer Slide-Out Command System Drawer */}
      <dialog
        ref={dialogRef}
        id={drawerId}
        aria-labelledby={drawerTitleId}
        className="command-drawer"
        onClose={() => {
          clearCloseTimer();
          setIsOpen(false);
          if (pendingActionRef.current) {
            const fn = pendingActionRef.current;
            pendingActionRef.current = null;
            fn();
          }
        }}
        onCancel={(e) => {
          if (e.cancelable) {
            e.preventDefault();
            playBeep('tap');
            closeDrawer();
          }
        }}
        onClick={(e) => {
          if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
            playBeep('tap');
            closeDrawer();
          }
        }}
      >
        <div ref={scrollerRef} className="command-drawer-scroller">
          <div
            ref={sheetRef}
            className="command-drawer-sheet tactical-scanlines bg-[#0b0e15] text-[#f3ead8] border-r-2 font-mono-tabular select-none relative"
            style={{
              borderColor: 'var(--theme-border-color)',
              boxShadow: '12px 0 40px rgba(0,0,0,0.95), 2px 0 22px var(--theme-glow-soft)',
              paddingTop: 'max(10px, env(safe-area-inset-top, 10px))',
              paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
              paddingLeft: 'max(12px, env(safe-area-inset-left, 12px))',
              paddingRight: '12px',
            }}
          >
            {/* Top Bezel Header */}
            <div className="pb-3 border-b border-[#1f2637] flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] text-[#94a3b8] uppercase tracking-widest">
                  <span
                    className="w-2 h-2 inline-block"
                    style={{
                      backgroundColor: 'rgb(var(--theme-primary-rgb))',
                      boxShadow: '0 0 8px var(--theme-glow-color)',
                    }}
                    aria-hidden="true"
                  />
                  <span>PIXELOPS SAFEHOUSE OS</span>
                </div>
                <h2
                  id={drawerTitleId}
                  className="font-pixel text-sm sm:text-base font-bold uppercase tracking-wide mt-1 truncate"
                  style={{
                    color: 'rgb(var(--theme-primary-rgb))',
                    textShadow: '0 0 10px var(--theme-glow-color)',
                  }}
                >
                  [{theme.shortLabel} v1.0 // SYS]
                </h2>
              </div>

              <button
                type="button"
                autoFocus
                onClick={() => {
                  playBeep('tap');
                  closeDrawer();
                }}
                aria-label="Close system menu"
                className="tactical-ctrl min-h-[36px] px-2.5 py-1 bg-[#141926] hover:bg-[#1d2538] border border-[#323c54] text-xs font-bold text-[#cbd5e1] hover:text-white flex items-center gap-1 cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ESC</span>
              </button>
            </div>

            {/* Scrollable Telemetry & System Controls Body */}
            <div className="py-3 flex flex-col gap-3.5 overflow-y-auto no-scrollbar">
              {/* Live Sector & Ambient Synth Readout Box */}
              <div className="p-2.5 bg-[#10141f] border border-[#242c40] flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[#94a3b8]">ACTIVE SECTOR</span>
                  <span className="font-bold text-[#e59838]">
                    {sectorBadge} <span className="text-[#94a3b8]">({sectorCode})</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[#94a3b8]">LEAD OPERATIVE</span>
                  <span className="font-bold text-[#f3ead8] truncate max-w-[165px]">
                    {activeOperativeName}
                  </span>
                </div>

                {(isMeetingActive || decryptionBoost > 0) && (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-[#1e2536]">
                    {isMeetingActive && (
                      <span className="px-2 py-0.5 bg-[#38bdf8]/15 border border-[#38bdf8] text-[#38bdf8] text-[10px] font-bold animate-pulse flex items-center gap-1">
                        <Radio className="w-3 h-3" aria-hidden="true" />
                        <span>[ROUNDTABLE: WAR ROOM]</span>
                      </span>
                    )}
                    {decryptionBoost > 0 && (
                      <span className="px-2 py-0.5 bg-[#4ade80]/15 border border-[#4ade80] text-[#4ade80] text-[10px] font-bold flex items-center gap-1">
                        <Zap className="w-3 h-3" aria-hidden="true" />
                        <span>[BOOST +{decryptionBoost}%]</span>
                      </span>
                    )}
                  </div>
                )}

                {/* Ambient Room Synth Loop Control */}
                <button
                  type="button"
                  onClick={onToggleSound}
                  aria-pressed={soundEnabled}
                  title={`Ambient Synth Loop: ${soundTitle} — ${soundDescription}`}
                  className={`tactical-ctrl mt-0.5 min-h-[38px] w-full px-2.5 py-1.5 border text-left text-xs flex items-center justify-between gap-2 cursor-pointer ${
                    soundEnabled
                      ? 'bg-[#0f2219] border-[#4ade80]/80 text-[#4ade80]'
                      : 'bg-[#171615] border-[#383633] text-[#94a3b8] hover:border-[#e59838]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {soundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate font-bold">
                      {soundEnabled ? `SYNTH: ${soundShortTag}` : 'SYNTH AUDIO: MUTED'}
                    </span>
                  </span>
                  <span className="text-[10px] uppercase shrink-0 opacity-85">
                    {soundEnabled ? '[ON]' : '[OFF]'}
                  </span>
                </button>
              </div>

              {/* AI Subscription / Vault Connection Card */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-wider px-0.5">
                  NEURAL UPLINK &amp; CREDENTIAL VAULT
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    closeDrawer(onOpenSettings);
                  }}
                  title={`${authInfo.title}: ${authInfo.subtitle}`}
                  className={`tactical-ctrl min-h-[48px] w-full p-2.5 border text-left flex items-center justify-between gap-2 cursor-pointer ${
                    authInfo.isConnected
                      ? isGoogleAuth
                        ? 'bg-[#0b1f33] hover:bg-[#112c47] border-[#38bdf8] text-[#7dd3fc]'
                        : 'bg-[#0e261c] hover:bg-[#153829] border-[#4ade80] text-[#86efac]'
                      : 'bg-[#161824] hover:bg-[#1f2233] border-[#64748b] text-[#e2e8f0]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          authInfo.isConnected ? 'bg-[#4ade80] animate-pulse' : 'bg-[#94a3b8]'
                        }`}
                        aria-hidden="true"
                      />
                      <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {authInfo.isConnected ? authInfo.badge : 'CONNECT AI PLAN'}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#94a3b8] truncate mt-0.5">
                      {authInfo.subtitle}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-80" aria-hidden="true" />
                </button>
              </div>

              {/* System Operations Navigation */}
              <nav aria-label="System Operations" className="flex flex-col gap-1">
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-wider px-0.5">
                  COMMAND &amp; OVERWATCH MODULES
                </span>
                <ul className="flex flex-col gap-1.5 m-0 p-0 list-none">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onToggleReconOverlay);
                      }}
                      className={`tactical-ctrl min-h-[42px] w-full px-3 py-2 border text-xs flex items-center justify-between gap-2 cursor-pointer ${
                        isReconOverlayOpen
                          ? 'bg-[#0c2e21] border-[#10b981] text-[#34d399] font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                          : 'bg-[#0d1d17] hover:bg-[#122921] border-[#10b981]/50 hover:border-[#10b981] text-[#6ee7b7]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Radar className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Satellite Recon Monitor</span>
                      </span>
                      <span className="text-[10px] font-bold">
                        {isReconOverlayOpen ? '[ACTIVE]' : '[ORBITAL]'}
                      </span>
                    </button>
                  </li>

                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onOpenNightShift);
                      }}
                      className="tactical-ctrl min-h-[42px] w-full px-3 py-2 bg-[#141722] hover:bg-[#1c2130] border border-[#323a52] hover:border-[#e59838] text-[#e59838] text-xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Moon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Night Shift Scheduler</span>
                      </span>
                      {nightShiftUnreadCount > 0 ? (
                        <span className="px-1.5 py-0.5 bg-[#4ade80]/20 border border-[#4ade80] text-[#4ade80] text-[10px] font-bold">
                          {nightShiftUnreadCount} NEW
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#94a3b8]">[CRON]</span>
                      )}
                    </button>
                  </li>

                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onOpenTelemetry);
                      }}
                      className="tactical-ctrl min-h-[42px] w-full px-3 py-2 bg-[#111b18] hover:bg-[#172621] border border-[#264537] hover:border-[#4ade80] text-[#4ade80] text-xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Telemetry &amp; Cost Ledger</span>
                      </span>
                      <span className="text-[10px] opacity-80">[HUD]</span>
                    </button>
                  </li>

                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onOpenThreatMonitor);
                      }}
                      className="tactical-ctrl min-h-[42px] w-full px-3 py-2 bg-[#1a1316] hover:bg-[#261a1f] border border-[#4a2530] hover:border-[#f87171] text-[#fca5a5] text-xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Global Threat Matrix</span>
                      </span>
                      <span className="text-[10px] opacity-80">[OSINT]</span>
                    </button>
                  </li>

                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onOpenFieldManual);
                      }}
                      className="tactical-ctrl min-h-[42px] w-full px-3 py-2 bg-[#161411] hover:bg-[#221e18] border border-[#4a3923] hover:border-[#e59838] text-[#f3ead8] text-xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 shrink-0 text-[#e59838]" aria-hidden="true" />
                        <span>Operative Field Manual</span>
                      </span>
                      <span className="text-[10px] text-[#c89d66]">[DOCS]</span>
                    </button>
                  </li>

                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        closeDrawer(onOpenSettings);
                      }}
                      className="tactical-ctrl min-h-[42px] w-full px-3 py-2 bg-[#131722] hover:bg-[#1b2132] border border-[#2d354b] hover:border-[#94a3b8] text-[#e2e8f0] text-xs flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Settings className="w-4 h-4 shrink-0 text-[#94a3b8]" aria-hidden="true" />
                        <span>Command &amp; Vault Settings</span>
                      </span>
                      <span className="text-[10px] text-[#94a3b8]">[CFG]</span>
                    </button>
                  </li>
                </ul>
              </nav>

              {/* Quick CRT Phosphor Preset Selector */}
              <div className="p-2.5 bg-[#10131d] border border-[#232b3e] flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#94a3b8] uppercase tracking-wider">
                    CRT PHOSPHOR PRESET
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      closeDrawer(onOpenThemesConsole);
                    }}
                    className="tactical-ctrl text-[10px] font-bold cursor-pointer hover:underline"
                    style={{ color: 'rgb(var(--theme-primary-rgb))' }}
                  >
                    [RGB MIXER ▸]
                  </button>
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {(Object.keys(THEMES) as ThemeId[]).map((id) => {
                    const item = THEMES[id];
                    const active = themeId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setThemeId(id);
                          playBeep('switch');
                        }}
                        aria-pressed={active}
                        title={item.name}
                        className={`tactical-ctrl min-h-[34px] px-1 py-1 border text-[10px] font-bold flex flex-col items-center justify-center gap-1 cursor-pointer ${
                          active
                            ? 'bg-[#1a2234] text-white border-white'
                            : 'bg-[#0b0e15] text-[#94a3b8] border-[#262f45] hover:text-white'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{
                            backgroundColor: item.accentHex,
                            boxShadow: active ? `0 0 8px ${item.accentHex}` : undefined,
                          }}
                          aria-hidden="true"
                        />
                        <span>{item.shortLabel.slice(0, 3).toUpperCase()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Install & Hint Footer */}
            <div className="pt-2.5 border-t border-[#1f2637] flex flex-col gap-2">
              <PWAInstallButton variant="tactical" />
              <div className="text-[10px] text-[#64748b] text-center tracking-wide">
                SWIPE LEFT · CLICK OUTSIDE · [ESC] TO STOW
              </div>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
};
