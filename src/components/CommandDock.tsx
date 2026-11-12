import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  LayoutGrid,
  ChevronUp,
  ChevronDown,
  Home,
  Users,
  Swords,
  Palette,
  Terminal,
  FolderOpen,
  Cloud,
  Radio,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export type DockNavTab = 'hq' | 'crew' | 'plugins' | 'themes';

export interface CommandDockProps {
  activeTab: DockNavTab;
  onSelectTab: (tab: DockNavTab) => void;
  queuedTasksCount: number;
  isExecuting: boolean;
  crewCount: number;
  connectedPluginsCount: number;
  isTerminalConsoleOpen: boolean;
  onToggleTerminalConsole: () => void;
  isWorkspaceFilesOpen: boolean;
  onToggleWorkspaceFiles: () => void;
  isSyncModalOpen: boolean;
  onToggleSyncModal: () => void;
  isFeedbackOpen: boolean;
  onToggleFeedback: () => void;
}

const TAB_LABELS: Record<DockNavTab, string> = {
  hq: 'HQ',
  crew: 'CREW',
  plugins: 'PLUGINS',
  themes: 'THEMES',
};

export const CommandDock: React.FC<CommandDockProps> = ({
  activeTab,
  onSelectTab,
  queuedTasksCount,
  isExecuting,
  crewCount,
  connectedPluginsCount,
  isTerminalConsoleOpen,
  onToggleTerminalConsole,
  isWorkspaceFilesOpen,
  onToggleWorkspaceFiles,
  isSyncModalOpen,
  onToggleSyncModal,
  isFeedbackOpen,
  onToggleFeedback,
}) => {
  const { playBeep } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const [isExpanded, setIsExpanded] = useState(false);

  const dockNavId = useId();
  const dockRootRef = useRef<HTMLDivElement | null>(null);
  const launcherBtnRef = useRef<HTMLButtonElement | null>(null);

  const collapseDock = useCallback(
    (restoreFocus = false) => {
      setIsExpanded(false);
      if (restoreFocus) {
        requestAnimationFrame(() => {
          launcherBtnRef.current?.focus();
        });
      }
    },
    []
  );

  // Light-dismiss when clicking outside the expanded dock
  useEffect(() => {
    if (!isExpanded) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (dockRootRef.current && !dockRootRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Defer to any open native modal dialog first
        if (document.querySelector('dialog[open]')) return;
        e.stopPropagation();
        playBeep('tap');
        collapseDock(true);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, collapseDock, playBeep]);

  const anyUtilityOpen =
    isTerminalConsoleOpen || isWorkspaceFilesOpen || isSyncModalOpen || isFeedbackOpen;

  return (
    <footer
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center justify-end px-2 pb-2 sm:pb-2.5 select-none"
      style={{
        paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
        paddingLeft: 'max(8px, env(safe-area-inset-left, 8px))',
        paddingRight: 'max(8px, env(safe-area-inset-right, 8px))',
      }}
    >
      <div ref={dockRootRef} className="pointer-events-auto max-w-full flex flex-col items-center">
        <AnimatePresence mode="wait" initial={false}>
          {!isExpanded ? (
            /* Collapsed State: Singular Tactical Launcher Button */
            <motion.button
              key="dock-launcher"
              ref={launcherBtnRef}
              type="button"
              onClick={() => {
                playBeep('switch');
                setIsExpanded(true);
              }}
              aria-expanded={false}
              aria-controls={dockNavId}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.94 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.95 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{
                borderColor: 'var(--theme-border-color)',
                boxShadow:
                  '0 0 20px var(--theme-glow-soft), 0 8px 26px rgba(0, 0, 0, 0.92)',
                transformOrigin: 'bottom center',
              }}
              className="tactical-ctrl tactical-scanlines min-h-[40px] px-4 py-1.5 bg-[#0b0f17]/95 hover:bg-[#131b2a] backdrop-blur-md border-2 rounded-sm font-mono-tabular text-xs sm:text-sm font-bold text-[#f3ead8] flex items-center gap-2.5 cursor-pointer relative overflow-hidden"
            >
              {/* Top Phosphor Grip Hairline */}
              <span
                aria-hidden="true"
                className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[2px]"
                style={{
                  backgroundColor: 'rgb(var(--theme-primary-rgb))',
                  boxShadow: '0 0 8px var(--theme-glow-color)',
                }}
              />

              <span
                aria-hidden="true"
                className={`w-2 h-2 rounded-full shrink-0 ${isExecuting ? 'animate-ping' : ''}`}
                style={{
                  backgroundColor: 'rgb(var(--theme-primary-rgb))',
                  boxShadow: '0 0 6px var(--theme-glow-color)',
                }}
              />

              <LayoutGrid
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: 'rgb(var(--theme-primary-rgb))' }}
                aria-hidden="true"
              />

              <span className="tracking-wider uppercase whitespace-nowrap">
                COMMAND DOCK ·{' '}
                <span style={{ color: 'rgb(var(--theme-primary-rgb))' }}>
                  {TAB_LABELS[activeTab]}
                </span>
              </span>

              {queuedTasksCount > 0 && (
                <span className="px-1.5 py-0.2 bg-[#38bdf8]/20 border border-[#38bdf8]/70 text-[#38bdf8] text-[10px] font-bold">
                  {queuedTasksCount}
                </span>
              )}

              {anyUtilityOpen && (
                <span
                  aria-hidden="true"
                  className="w-1.5 h-1.5 rounded-full bg-[#e59838]"
                />
              )}

              <ChevronUp
                className="w-3.5 h-3.5 text-[#94a3b8] shrink-0"
                aria-hidden="true"
              />
            </motion.button>
          ) : (
            /* Expanded State: Full Tactical Taskbar / Dock */
            <motion.div
              key="dock-taskbar"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.93 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.94 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              style={{
                borderColor: 'var(--theme-border-color)',
                boxShadow:
                  '0 0 28px var(--theme-glow-soft), 0 14px 40px rgba(0, 0, 0, 0.95)',
                transformOrigin: 'bottom center',
              }}
              className="tactical-scanlines max-w-[calc(100dvw-16px)] sm:max-w-[calc(100dvw-32px)] bg-[#0b0f17]/96 backdrop-blur-md border-2 rounded-sm relative overflow-hidden"
            >
              {/* Top Glowing Bevel Accent */}
              <div
                aria-hidden="true"
                className="h-[2px] w-full opacity-75"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgb(var(--theme-primary-rgb)) 50%, transparent 100%)',
                }}
              />

              <nav
                id={dockNavId}
                aria-label="Command Dock"
                onWheel={(e) => {
                  if (e.deltaY !== 0 && !e.deltaX) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
                className="flex flex-nowrap items-center gap-1 p-1.5 overflow-x-auto no-scrollbar touch-pan-x overscroll-x-contain"
                style={{ scrollSnapType: 'x proximity' }}
              >
                {/* Primary Console Sector Tabs */}
                <ul className="flex flex-nowrap items-center gap-1 m-0 p-0 list-none shrink-0">
                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-current={activeTab === 'hq' ? 'page' : undefined}
                      onClick={() => {
                        onSelectTab('hq');
                        playBeep('tap');
                      }}
                      className={`tactical-ctrl relative min-h-[42px] px-3 sm:px-4 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        activeTab === 'hq'
                          ? 'bg-[#172032] text-white font-bold'
                          : 'bg-[#101521]/85 hover:bg-[#171e2e] text-[#cbd5e1] hover:text-white border-[#252d42]'
                      }`}
                      style={
                        activeTab === 'hq'
                          ? { borderColor: 'var(--theme-border-color)' }
                          : undefined
                      }
                    >
                      {activeTab === 'hq' && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px]"
                          style={{
                            backgroundColor: 'rgb(var(--theme-primary-rgb))',
                            boxShadow: '0 0 8px var(--theme-glow-color)',
                          }}
                        />
                      )}
                      <Home
                        className="w-3.5 h-3.5 shrink-0"
                        style={
                          activeTab === 'hq'
                            ? { color: 'rgb(var(--theme-primary-rgb))' }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span>{activeTab === 'hq' ? '[HQ]' : 'HQ'}</span>
                      {queuedTasksCount > 0 && (
                        <span className="px-1 py-0.2 bg-[#38bdf8]/20 border border-[#38bdf8]/60 text-[#38bdf8] text-[10px] font-bold">
                          {queuedTasksCount}
                        </span>
                      )}
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-current={activeTab === 'crew' ? 'page' : undefined}
                      onClick={() => {
                        onSelectTab('crew');
                        playBeep('tap');
                      }}
                      className={`tactical-ctrl relative min-h-[42px] px-3 sm:px-4 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        activeTab === 'crew'
                          ? 'bg-[#172032] text-white font-bold'
                          : 'bg-[#101521]/85 hover:bg-[#171e2e] text-[#cbd5e1] hover:text-white border-[#252d42]'
                      }`}
                      style={
                        activeTab === 'crew'
                          ? { borderColor: 'var(--theme-border-color)' }
                          : undefined
                      }
                    >
                      {activeTab === 'crew' && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px]"
                          style={{
                            backgroundColor: 'rgb(var(--theme-primary-rgb))',
                            boxShadow: '0 0 8px var(--theme-glow-color)',
                          }}
                        />
                      )}
                      <Users
                        className="w-3.5 h-3.5 shrink-0"
                        style={
                          activeTab === 'crew'
                            ? { color: 'rgb(var(--theme-primary-rgb))' }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span>{activeTab === 'crew' ? '[Crew]' : 'Crew'}</span>
                      <span className="text-[10px] text-[#94a3b8]">:{crewCount}</span>
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-current={activeTab === 'plugins' ? 'page' : undefined}
                      onClick={() => {
                        onSelectTab('plugins');
                        playBeep('tap');
                      }}
                      className={`tactical-ctrl relative min-h-[42px] px-3 sm:px-4 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        activeTab === 'plugins'
                          ? 'bg-[#261b0e] text-[#fde68a] border-[#e59838] font-bold shadow-[0_0_12px_rgba(229,152,56,0.28)]'
                          : 'bg-[#101521]/85 hover:bg-[#171e2e] text-[#cbd5e1] hover:text-white border-[#252d42]'
                      }`}
                    >
                      {activeTab === 'plugins' && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px] bg-[#e59838]"
                        />
                      )}
                      <Swords
                        className={`w-3.5 h-3.5 shrink-0 ${
                          activeTab === 'plugins' ? 'text-[#e59838]' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>{activeTab === 'plugins' ? '[Plugins & Toolkits]' : 'Plugins & Toolkits'}</span>
                      {connectedPluginsCount > 0 && (
                        <span className="text-[10px] text-[#4ade80] font-bold">
                          :{connectedPluginsCount}
                        </span>
                      )}
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-current={activeTab === 'themes' ? 'page' : undefined}
                      onClick={() => {
                        onSelectTab('themes');
                        playBeep('tap');
                      }}
                      className={`tactical-ctrl relative min-h-[42px] px-3 sm:px-4 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        activeTab === 'themes'
                          ? 'bg-[#172032] text-white font-bold'
                          : 'bg-[#101521]/85 hover:bg-[#171e2e] text-[#cbd5e1] hover:text-white border-[#252d42]'
                      }`}
                      style={
                        activeTab === 'themes'
                          ? { borderColor: 'var(--theme-border-color)' }
                          : undefined
                      }
                    >
                      {activeTab === 'themes' && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-[2px]"
                          style={{
                            backgroundColor: 'rgb(var(--theme-primary-rgb))',
                            boxShadow: '0 0 8px var(--theme-glow-color)',
                          }}
                        />
                      )}
                      <Palette
                        className="w-3.5 h-3.5 shrink-0"
                        style={
                          activeTab === 'themes'
                            ? { color: 'rgb(var(--theme-primary-rgb))' }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                      <span>{activeTab === 'themes' ? '[Themes]' : 'Themes'}</span>
                    </button>
                  </li>
                </ul>

                <span
                  aria-hidden="true"
                  className="w-px h-7 bg-[#293247] mx-0.5 shrink-0"
                />

                {/* Console Utility Launchers */}
                <ul className="flex flex-nowrap items-center gap-1 m-0 p-0 list-none shrink-0">
                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-pressed={isTerminalConsoleOpen}
                      onClick={() => {
                        playBeep('tap');
                        onToggleTerminalConsole();
                        collapseDock();
                      }}
                      title="Toggle Tactical CLI Terminal Console (~)"
                      className={`tactical-ctrl min-h-[42px] px-2.5 sm:px-3.5 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        isTerminalConsoleOpen
                          ? 'bg-[#123120] border-[#4ade80] text-[#4ade80] font-bold'
                          : 'bg-[#0e1a14]/90 hover:bg-[#14281e] border-[#234231] text-[#4ade80]'
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="hidden sm:inline">CLI (~)</span>
                      <span className="sm:hidden">CLI</span>
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-pressed={isWorkspaceFilesOpen}
                      onClick={() => {
                        playBeep('tap');
                        onToggleWorkspaceFiles();
                        collapseDock();
                      }}
                      title="Open Workspace File Explorer (IndexedDB Markdown Reports & Logs)"
                      className={`tactical-ctrl min-h-[42px] px-2.5 sm:px-3.5 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        isWorkspaceFilesOpen
                          ? 'bg-[#122b38] border-[#38bdf8] text-[#38bdf8] font-bold'
                          : 'bg-[#0e1822]/90 hover:bg-[#142433] border-[#213a4e] text-[#38bdf8]'
                      }`}
                    >
                      <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Files</span>
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-pressed={isSyncModalOpen}
                      onClick={() => {
                        playBeep('tap');
                        onToggleSyncModal();
                        collapseDock();
                      }}
                      title="Open SatCom Multi-Device Cloud Sync"
                      className={`tactical-ctrl min-h-[42px] px-2.5 sm:px-3.5 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        isSyncModalOpen
                          ? 'bg-[#122f26] border-[#34d399] text-[#34d399] font-bold'
                          : 'bg-[#0e1b18]/90 hover:bg-[#132822] border-[#214237] text-[#34d399]'
                      }`}
                    >
                      <Cloud className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Sync</span>
                    </button>
                  </li>

                  <li className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                    <button
                      type="button"
                      aria-pressed={isFeedbackOpen}
                      onClick={() => {
                        playBeep('tap');
                        onToggleFeedback();
                        collapseDock();
                      }}
                      title="Open Feedback Terminal (Relay to support@pixelops.app)"
                      className={`tactical-ctrl min-h-[42px] px-2.5 sm:px-3.5 py-1.5 font-mono-tabular text-xs sm:text-sm flex items-center gap-1.5 border cursor-pointer whitespace-nowrap ${
                        isFeedbackOpen
                          ? 'bg-[#0f2918] border-[#4ade80] text-[#4ade80] font-bold'
                          : 'bg-[#0c1811]/90 hover:bg-[#12261a] border-[#1f3d2a] text-[#4ade80]'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>Feedback</span>
                    </button>
                  </li>
                </ul>

                <span
                  aria-hidden="true"
                  className="w-px h-7 bg-[#293247] mx-0.5 shrink-0"
                />

                {/* Collapse Back Into Singular Button */}
                <button
                  type="button"
                  aria-expanded={true}
                  aria-controls={dockNavId}
                  onClick={() => {
                    playBeep('switch');
                    collapseDock(true);
                  }}
                  title="Collapse Command Dock into launcher button (Esc)"
                  className="tactical-ctrl min-h-[42px] px-3 py-1.5 bg-[#161b28] hover:bg-[#20273a] border border-[#36405a] font-mono-tabular text-xs font-bold text-[#cbd5e1] hover:text-white flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <ChevronDown
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: 'rgb(var(--theme-primary-rgb))' }}
                    aria-hidden="true"
                  />
                  <span>HIDE</span>
                </button>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </footer>
  );
};
