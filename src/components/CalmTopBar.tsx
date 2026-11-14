import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Settings,
  X,
  Volume2,
  VolumeX,
  KeyRound,
  Cloud,
  BookOpen,
  MessageSquare,
  RefreshCw,
  MapPin,
  Shield,
} from 'lucide-react';
import { useTheme, THEMES, type ThemeId } from '../context/ThemeContext';
import { PWAInstallButton } from './PWAInstallButton';
import {
  getPrimaryNaiZone,
  getPrimaryNaiZoneOrDefaultSync,
  setPrimaryNaiZone,
  sweepLocalSensorBusNow,
  type NaiZoneConfig,
} from '../services/LocalSensorBus';
import { getActiveSubscriptionTier, getActiveSession } from '../services/AuthService';

export type WorkspaceMode = 'recon' | 'safehouse' | 'vault';

export interface CalmTopBarProps {
  workspaceMode: WorkspaceMode;
  onChangeWorkspaceMode: (mode: WorkspaceMode) => void;
  activePriorityAlertCount: number;
  hasCriticalIncident: boolean;
  soundEnabled: boolean;
  soundShortTag: string;
  onToggleSound: () => void;
  authBadgeText: string;
  authSubtitleText: string;
  isAiConnected: boolean;
  onOpenSettingsModal: () => void;
  onOpenSyncAccountModal: () => void;
  onOpenFieldManualModal: () => void;
  onOpenFeedbackModal: () => void;
  onOpenThemeConsoleModal: () => void;
}

const RADIUS_PRESETS_KM = [15, 35, 50, 75] as const;

async function resolveWatchLocationInput(
  rawQuery: string
): Promise<{ lat: number; lon: number; label: string } | null> {
  const q = rawQuery.trim();
  if (!q) return null;

  // 1. Direct "lat, lon" coordinate pair
  const coordMatch = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lon = Number(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return {
        lat,
        lon,
        label: `Watch (${lat.toFixed(3)}°, ${lon.toFixed(3)}°)`,
      };
    }
  }

  // 2. Open-Meteo global city/postal geocoder (fast, CORS-open, zero key)
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      q
    )}&count=1&language=en&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const first = Array.isArray(data?.results) ? data.results[0] : null;
      if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
        const labelParts = [first.name, first.admin1, first.country_code].filter(Boolean);
        return {
          lat: first.latitude,
          lon: first.longitude,
          label: labelParts.slice(0, 2).join(', ') || q,
        };
      }
    }
  } catch {}

  return null;
}

export const CalmTopBar: React.FC<CalmTopBarProps> = ({
  workspaceMode,
  onChangeWorkspaceMode,
  activePriorityAlertCount,
  hasCriticalIncident,
  soundEnabled,
  soundShortTag,
  onToggleSound,
  authBadgeText,
  authSubtitleText,
  isAiConnected,
  onOpenSettingsModal,
  onOpenSyncAccountModal,
  onOpenFieldManualModal,
  onOpenFeedbackModal,
  onOpenThemeConsoleModal,
}) => {
  const { themeId, setThemeId, playBeep } = useTheme();

  const [naiZone, setNaiZone] = useState<NaiZoneConfig>(() => getPrimaryNaiZoneOrDefaultSync());
  const [isWatchPopoverOpen, setIsWatchPopoverOpen] = useState<boolean>(false);
  const [locationInput, setLocationInput] = useState<string>('');
  const [isUpdatingZone, setIsUpdatingZone] = useState<boolean>(false);
  const [zoneFeedback, setZoneFeedback] = useState<string | null>(null);
  const [isSysMenuOpen, setIsSysMenuOpen] = useState<boolean>(false);

  const watchPopoverWrapperRef = useRef<HTMLDivElement | null>(null);
  const sysDialogRef = useRef<HTMLDialogElement | null>(null);

  // Keep watch zone pill synchronized with LocalSensorBus changes
  useEffect(() => {
    getPrimaryNaiZone()
      .then((z) => setNaiZone(z))
      .catch(() => {});
    const onNaiChanged = (ev: Event) => {
      const custom = ev as CustomEvent<NaiZoneConfig | undefined>;
      setNaiZone(custom?.detail || getPrimaryNaiZoneOrDefaultSync());
    };
    window.addEventListener('pixelops:nai-updated', onNaiChanged);
    return () => window.removeEventListener('pixelops:nai-updated', onNaiChanged);
  }, []);

  // Light-dismiss Watch Zone quick popover on outside click or Escape
  useEffect(() => {
    if (!isWatchPopoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        watchPopoverWrapperRef.current &&
        !watchPopoverWrapperRef.current.contains(e.target as Node)
      ) {
        setIsWatchPopoverOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsWatchPopoverOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isWatchPopoverOpen]);

  // Synchronize native <dialog> for [⚙] System Menu
  useEffect(() => {
    const dialog = sysDialogRef.current;
    if (!dialog) return;
    if (isSysMenuOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute('open', '');
        }
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch {
        dialog.removeAttribute('open');
      }
    }
  }, [isSysMenuOpen]);

  const handleRadiusSelect = async (radiusKm: number) => {
    playBeep('tap');
    setIsUpdatingZone(true);
    try {
      const updated = await setPrimaryNaiZone({
        label: naiZone.label,
        lat: naiZone.lat,
        lon: naiZone.lon,
        radiusKm,
      });
      setNaiZone(updated);
      void sweepLocalSensorBusNow({ nai: updated }).catch(() => {});
    } finally {
      setIsUpdatingZone(false);
    }
  };

  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationInput.trim() || isUpdatingZone) return;
    setIsUpdatingZone(true);
    setZoneFeedback(null);
    try {
      const resolved = await resolveWatchLocationInput(locationInput);
      if (!resolved) {
        setZoneFeedback('Could not locate — enter "City, Country" or "lat, lon".');
        return;
      }
      const updated = await setPrimaryNaiZone({
        label: resolved.label,
        lat: resolved.lat,
        lon: resolved.lon,
        radiusKm: naiZone.radiusKm,
      });
      setNaiZone(updated);
      setLocationInput('');
      setZoneFeedback(`Updated watch center to ${resolved.label}`);
      void sweepLocalSensorBusNow({ nai: updated }).catch(() => {});
    } finally {
      setIsUpdatingZone(false);
    }
  };

  const handleQuickSweep = async () => {
    if (isUpdatingZone) return;
    setIsUpdatingZone(true);
    try {
      await sweepLocalSensorBusNow({ nai: naiZone });
      setZoneFeedback('Live feeds swept');
    } catch {
      setZoneFeedback('Sweep completed with partial cache');
    } finally {
      setIsUpdatingZone(false);
    }
  };

  const currentUser = getActiveSession()?.user ?? null;
  const activeTier = getActiveSubscriptionTier();
  const tierLabel =
    activeTier === 'station_chief'
      ? 'STATION CHIEF'
      : activeTier === 'pro'
      ? 'PRO OPERATIVE'
      : 'OPERATIVE (FREE)';

  const statusDotClass =
    activePriorityAlertCount === 0
      ? 'bg-emerald-400'
      : hasCriticalIncident
      ? 'bg-red-500 animate-pulse'
      : 'bg-amber-400 animate-pulse';

  const statusBorderClass =
    activePriorityAlertCount === 0
      ? 'border-emerald-500/45 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-950/50'
      : hasCriticalIncident
      ? 'border-red-500/70 bg-red-950/50 text-red-100 hover:bg-red-950/70'
      : 'border-amber-500/65 bg-amber-950/45 text-amber-100 hover:bg-amber-950/65';

  const statusHeadlineText =
    activePriorityAlertCount === 0
      ? 'ALL CLEAR'
      : `${activePriorityAlertCount} ACTIVE ${
          activePriorityAlertCount === 1 ? 'ALERT' : 'ALERTS'
        }`;

  const runSystemMenuAction = (fn: () => void) => {
    setIsSysMenuOpen(false);
    fn();
  };

  return (
    <>
      <header className="calm-top-bar sticky top-0 z-50 w-full h-11 bg-[#070b10]/95 backdrop-blur-md border-b border-slate-800/90 px-2.5 sm:px-4 flex items-center justify-between gap-2 select-none shrink-0">
        {/* LEFT: Live Watch Zone Status Pill + Quick Anchored Popover */}
        <div ref={watchPopoverWrapperRef} className="relative min-w-0">
          <button
            type="button"
            aria-expanded={isWatchPopoverOpen}
            aria-controls="watch-zone-quick-panel"
            onClick={() => {
              playBeep('tap');
              setIsWatchPopoverOpen((o) => !o);
              setZoneFeedback(null);
            }}
            className={`watch-zone-trigger h-8 px-2.5 sm:px-3 rounded-full border text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer max-w-[235px] sm:max-w-none ${statusBorderClass}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotClass}`} aria-hidden="true" />
            <span className="truncate">
              {statusHeadlineText} • {Math.round(naiZone.radiusKm)}km Watch Zone
            </span>
            <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" aria-hidden="true" />
          </button>

          {isWatchPopoverOpen && (
            <div
              id="watch-zone-quick-panel"
              className="watch-zone-dropdown absolute left-0 mt-1.5 z-50 w-80 max-w-[calc(100vw-1.25rem)] rounded-xl bg-[#091017] border border-slate-700 shadow-2xl p-3.5 space-y-3 text-xs text-slate-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-white flex items-center gap-1.5 truncate">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{naiZone.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {naiZone.lat.toFixed(4)}°, {naiZone.lon.toFixed(4)}°
                  </div>
                </div>
                {activePriorityAlertCount > 0 && workspaceMode !== 'recon' && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsWatchPopoverOpen(false);
                      onChangeWorkspaceMode('recon');
                    }}
                    className="px-2 py-1 rounded bg-amber-950 hover:bg-amber-900 border border-amber-400/70 text-[11px] font-semibold text-amber-200 shrink-0 cursor-pointer"
                  >
                    View Alerts
                  </button>
                )}
              </div>

              <form onSubmit={handleLocationSubmit} className="flex items-center gap-1.5">
                <input
                  id="watch-zone-location-input"
                  name="watch_zone_location"
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  placeholder="Change city, postcode, or lat, lon..."
                  className="flex-1 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400"
                />
                <button
                  type="submit"
                  disabled={isUpdatingZone}
                  className="px-2.5 py-1.5 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-200 font-semibold cursor-pointer disabled:opacity-50"
                >
                  Set
                </button>
              </form>

              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400 font-medium block">
                  Watch Zone Radius
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {RADIUS_PRESETS_KM.map((rKm) => {
                    const selected = Math.round(naiZone.radiusKm) === rKm;
                    return (
                      <button
                        key={rKm}
                        type="button"
                        onClick={() => handleRadiusSelect(rKm)}
                        className={`py-1 rounded border text-xs font-semibold cursor-pointer ${
                          selected
                            ? 'bg-emerald-950 border-emerald-400 text-emerald-200'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {rKm}km
                      </button>
                    );
                  })}
                </div>
              </div>

              {zoneFeedback && (
                <p className="text-[11px] text-cyan-300">{zoneFeedback}</p>
              )}

              <div className="pt-1 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isUpdatingZone}
                  onClick={handleQuickSweep}
                  className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingZone ? 'animate-spin' : ''}`} />
                  <span>Sweep Feeds Now</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsWatchPopoverOpen(false);
                    onChangeWorkspaceMode('recon');
                  }}
                  className="text-emerald-300 hover:text-emerald-200 font-semibold cursor-pointer"
                >
                  Open Recon &rarr;
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: 3 Primary Workspaces + [⚙] System Menu */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <nav aria-label="Primary Workspaces" className="flex items-center gap-1">
            <button
              type="button"
              aria-current={workspaceMode === 'recon' ? 'page' : undefined}
              onClick={() => {
                playBeep('switch');
                onChangeWorkspaceMode('recon');
              }}
              className={`h-8 px-2.5 sm:px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                workspaceMode === 'recon'
                  ? 'bg-emerald-950/80 text-emerald-200 border-emerald-400/80'
                  : 'bg-transparent hover:bg-slate-900 text-slate-300 border-transparent hover:border-slate-800'
              }`}
            >
              <span aria-hidden="true">📡</span>
              <span>RECON</span>
            </button>

            <button
              type="button"
              aria-current={workspaceMode === 'safehouse' ? 'page' : undefined}
              onClick={() => {
                playBeep('switch');
                onChangeWorkspaceMode('safehouse');
              }}
              className={`h-8 px-2.5 sm:px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border relative ${
                workspaceMode === 'safehouse'
                  ? 'bg-emerald-950/80 text-emerald-200 border-emerald-400/80'
                  : 'bg-transparent hover:bg-slate-900 text-slate-300 border-transparent hover:border-slate-800'
              }`}
            >
              <span aria-hidden="true">🏢</span>
              <span>SAFEHOUSE</span>
              {activePriorityAlertCount > 0 && workspaceMode !== 'safehouse' && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-400"
                  title="Vance & Nyx desk alert active"
                />
              )}
            </button>

            <button
              type="button"
              aria-current={workspaceMode === 'vault' ? 'page' : undefined}
              onClick={() => {
                playBeep('switch');
                onChangeWorkspaceMode('vault');
              }}
              className={`h-8 px-2.5 sm:px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                workspaceMode === 'vault'
                  ? 'bg-emerald-950/80 text-emerald-200 border-emerald-400/80'
                  : 'bg-transparent hover:bg-slate-900 text-slate-300 border-transparent hover:border-slate-800'
              }`}
            >
              <span aria-hidden="true">📁</span>
              <span>VAULT</span>
            </button>
          </nav>

          <button
            type="button"
            aria-label="System Menu"
            title="System Menu: Account, Keys, Themes, Audio & Manual"
            onClick={() => {
              playBeep('tap');
              setIsSysMenuOpen(true);
            }}
            className="h-8 w-8 rounded-md bg-slate-900/90 hover:bg-slate-800 border border-slate-700/90 text-slate-200 hover:text-white flex items-center justify-center cursor-pointer ml-0.5"
          >
            <Settings className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* [⚙] System Menu Right Slide-Over Sheet */}
      <dialog
        ref={sysDialogRef}
        aria-labelledby="calm-sys-menu-title"
        className="evidence-slide-drawer"
        onCancel={(e) => {
          e.preventDefault();
          setIsSysMenuOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setIsSysMenuOpen(false);
          }
        }}
      >
        {isSysMenuOpen && (
          <div className="evidence-slide-drawer-sheet flex flex-col h-full bg-[#080d13] text-slate-100 border-l border-slate-800 shadow-2xl">
            <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-400" />
                <h2 id="calm-sys-menu-title" className="text-sm font-bold text-white">
                  System &amp; Preferences
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsSysMenuOpen(false)}
                aria-label="Close System Menu"
                className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {/* Account & D1 Tier Card */}
              <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Account &amp; D1 Tier</span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-[10.5px] font-bold text-emerald-200">
                    {tierLabel}
                  </span>
                </div>
                <p className="text-slate-300">
                  {currentUser
                    ? `Signed in as ${currentUser.callsign || currentUser.username}`
                    : 'Local-first browser session (Cloudflare D1 Sync optional)'}
                </p>
                <button
                  type="button"
                  onClick={() => runSystemMenuAction(onOpenSyncAccountModal)}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold text-slate-100 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-sky-400" />
                    <span>Account &amp; Cloud Sync</span>
                  </span>
                  <span className="text-slate-400">&rarr;</span>
                </button>
              </section>

              {/* BYOK Keys & AI Provider */}
              <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    AI Uplink &amp; BYOK Vault
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border ${
                      isAiConnected
                        ? 'bg-emerald-950 border-emerald-500/50 text-emerald-200'
                        : 'bg-slate-900 border-slate-700 text-slate-400'
                    }`}
                  >
                    {isAiConnected ? authBadgeText : 'Not Configured'}
                  </span>
                </div>
                <p className="text-slate-400">{authSubtitleText}</p>
                <button
                  type="button"
                  onClick={() => runSystemMenuAction(onOpenSettingsModal)}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold text-slate-100 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-amber-400" />
                    <span>Manage API Keys (BYOK Vault)</span>
                  </span>
                  <span className="text-slate-400">&rarr;</span>
                </button>
              </section>

              {/* RGB Theme Selector */}
              <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Display Theme
                  </span>
                  <button
                    type="button"
                    onClick={() => runSystemMenuAction(onOpenThemeConsoleModal)}
                    className="text-[11px] text-emerald-300 hover:underline font-semibold cursor-pointer"
                  >
                    Custom RGB Mixer &rarr;
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {(Object.keys(THEMES) as ThemeId[]).map((id) => {
                    const t = THEMES[id];
                    const active = themeId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setThemeId(id);
                          playBeep('switch');
                        }}
                        className={`py-2 px-1 rounded-lg border text-[10px] font-bold flex flex-col items-center gap-1 cursor-pointer ${
                          active
                            ? 'bg-slate-800 border-white text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: t.accentHex }}
                        />
                        <span>{t.shortLabel.slice(0, 4)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Synth Audio & Utilities */}
              <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
                <button
                  type="button"
                  aria-pressed={soundEnabled}
                  onClick={onToggleSound}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold text-slate-100 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-slate-400" />
                    )}
                    <span>Ambient Synth Audio</span>
                  </span>
                  <span className="text-[11px] text-slate-300">
                    {soundEnabled ? `On (${soundShortTag})` : 'Muted'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => runSystemMenuAction(onOpenFieldManualModal)}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold text-slate-100 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-amber-400" />
                    <span>Field Manual &amp; Documentation</span>
                  </span>
                  <span className="text-slate-400">&rarr;</span>
                </button>

                <button
                  type="button"
                  onClick={() => runSystemMenuAction(onOpenFeedbackModal)}
                  className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 font-semibold text-slate-100 flex items-center justify-between cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-cyan-400" />
                    <span>Operator Feedback</span>
                  </span>
                  <span className="text-slate-400">&rarr;</span>
                </button>

                <div className="pt-1">
                  <PWAInstallButton variant="tactical" />
                </div>
              </section>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
};

export default CalmTopBar;
