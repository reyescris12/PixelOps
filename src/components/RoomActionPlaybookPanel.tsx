/**
 * RoomActionPlaybookPanel.tsx
 * 
 * PixelOps 3-Pillar Room-Scoped Action Deck
 * Unifies:
 * - Pillar 1: Pocket Recon & Watchtower (COMMS TOWER & BASEMENT)
 * - Pillar 2: 1-Click Cross-App Operator (WAR ROOM & SERVER VAULT)
 * - Pillar 3: Operative Progression & Loadout Deck (LOUNGE & ARMORY)
 * 
 * Designed for ZERO obstruction of the room diorama canvas:
 * - Floating variant: Collapsed by default into an unobtrusive micro-pill in the corner;
 *   smoothly expands on user tap and auto-closes on outside click or mission start.
 * - Banner variant: Sits neatly outside/below the room canvas as a dedicated mission tray.
 * - Pill variant: Sleek inline button for status bars and headers.
 */

import React, { useState, useEffect, useRef } from 'react';
import { RoomId } from '../engine/roomData';
import { getAllRooms, getAllRoomIds } from '../engine/roomManager';
import {
  getPlaybooksForRoom,
  INTELLIGENCE_PLAYBOOKS,
  IntelligencePlaybookDef,
  loadUserPlaybookTargets,
  ALL_WORKFLOW_DECK_ITEMS,
  RoomWorkflowItemId,
  getRoomWorkflowDeckItems,
  toggleWorkflowInRoomDeck,
  moveWorkflowToRoomDeck,
  reorderWorkflowInRoomDeck,
  resetRoomWorkflowDecksToDefault,
  subscribeRoomWorkflowDecks,
} from '../engine/intelligencePlaybooks';
import { getRoomBoundSkills, subscribeModuleRegistry } from '../engine/moduleRegistry';
import {
  useCrew,
  CLEARANCE_RANKS,
  SERVICE_RIBBONS,
  ServiceRibbonId,
  ClearanceLevelNumber,
  CrewAgentState,
} from '../context/CrewContext';
import { useTheme } from '../context/ThemeContext';
import {
  getLocalConnectedAccounts,
  subscribeToConnectionChanges,
  ComposioConnectedAccount,
} from '../services/ComposioService';
import {
  Play,
  Target,
  Sparkles,
  Shield,
  Radar,
  Radio,
  Mail,
  Calendar,
  GitBranch,
  FolderArchive,
  Award,
  Download,
  Check,
  Copy,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  Zap,
  SlidersHorizontal,
  ArrowRightLeft,
  RotateCcw,
} from 'lucide-react';

interface RoomActionPlaybookPanelProps {
  currentRoom: RoomId;
  onExecutePlaybook: (playbook: IntelligencePlaybookDef) => void;
  isExecuting?: boolean;
  className?: string;
  variant?: 'floating' | 'banner' | 'pill';
  onOpenVfs?: (targetPath?: string) => void;
  onExportDossier?: () => void;
  onOpenReconMonitor?: () => void;
}

export const RoomActionPlaybookPanel: React.FC<RoomActionPlaybookPanelProps> = ({
  currentRoom,
  onExecutePlaybook,
  isExecuting = false,
  className = '',
  variant = 'floating',
  onOpenVfs,
  onExportDossier,
  onOpenReconMonitor,
}) => {
  const { playBeep, activeAgent } = useTheme();
  const { crewAgents, getCrewAgent } = useCrew();
  const activeCrewAgent = getCrewAgent(activeAgent?.id || '') || crewAgents[0];

  const [connectedAccounts, setConnectedAccounts] = useState<ComposioConnectedAccount[]>(() =>
    getLocalConnectedAccounts()
  );
  const [copiedDossier, setCopiedDossier] = useState(false);
  const [isFloatingOpen, setIsFloatingOpen] = useState(false);
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pixelops_workflows_banner_collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const floatingRef = useRef<HTMLDivElement>(null);

  const toggleBannerCollapse = () => {
    playBeep('tap');
    setIsBannerCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pixelops_workflows_banner_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Auto-collapse floating panel on room change so it never obstructs newly viewed sectors
  useEffect(() => {
    setIsFloatingOpen(false);
    setIsCustomizingDeck(false);
  }, [currentRoom]);

  // Click-outside and Escape key listener when floating HUD is open
  useEffect(() => {
    if (!isFloatingOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (floatingRef.current && !floatingRef.current.contains(e.target as Node)) {
        setIsFloatingOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFloatingOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFloatingOpen]);

  // Sync connected accounts live
  useEffect(() => {
    const unsubscribe = subscribeToConnectionChanges((accounts) => {
      setConnectedAccounts(accounts);
    });
    return () => unsubscribe();
  }, []);

  const playbooks = getPlaybooksForRoom(currentRoom);
  const storedTargets = loadUserPlaybookTargets();
  const [, setRegistryTick] = useState(0);
  const [isCustomizingDeck, setIsCustomizingDeck] = useState(false);

  useEffect(() => {
    const unsub1 = subscribeModuleRegistry(() => setRegistryTick((t) => t + 1));
    const unsub2 = subscribeRoomWorkflowDecks(() => setRegistryTick((t) => t + 1));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const roomDeckItems = getRoomWorkflowDeckItems(currentRoom);
  const allRooms = getAllRooms();
  const allRoomIds = getAllRoomIds();

  const roomBoundSkills = getRoomBoundSkills(currentRoom);
  const hasSatelliteModuleInRoom =
    currentRoom === 'library' ||
    roomBoundSkills.some(
      (s) => s.id === 'osint_satellite_plugin' || s.providedTools.includes('osint_satellite_recon')
    );

  // Helper to test if a Composio app is active
  const isAppConnected = (appName: string): boolean => {
    const slug = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return connectedAccounts.some((acc) => {
      const accSlug = (acc.appName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        accSlug === slug &&
        (acc.status?.toUpperCase() === 'ACTIVE' ||
          acc.status?.toUpperCase() === 'CONNECTED' ||
          acc.status?.toUpperCase() === 'INITIATED')
      );
    });
  };

  // Helper to generate Operative Dossier Card Markdown
  const handleExportDossierCard = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    playBeep('tap');

    const dateStr = new Date().toISOString().split('T')[0];
    const dossierMarkdown = [
      `# 🪪 PIXELOPS SQUAD OPERATIVE DOSSIER`,
      `**Transmission Date:** ${dateStr}`,
      `**Classification:** TOP SECRET // PIXELOPS NETWORK`,
      `**Safehouse Sector:** ${currentRoom.toUpperCase()}`,
      ``,
      `---`,
      ``,
      `## 🎖️ COMMAND SQUAD RECON MATRIX`,
      ``,
      ...crewAgents.map((ag: CrewAgentState) => {
        const lvl = (ag.clearanceLevel || 1) as ClearanceLevelNumber;
        const rank = CLEARANCE_RANKS[lvl];
        const ribbonsList = (ag.serviceRibbons || [])
          .map((ribbonId: string) => {
            const def = SERVICE_RIBBONS[ribbonId as ServiceRibbonId];
            return def ? `${def.icon} ${def.title}` : ribbonId;
          })
          .join(', ');

        const displayName = ag.customName || ag.defaultName;
        return [
          `### ${displayName} (${ag.role})`,
          `- **Clearance Rank:** ${rank.title}`,
          `- **Rank Tier:** ${rank.badge}`,
          `- **XP Accumulation:** ${ag.xp || 0} XP`,
          `- **Missions Completed:** ${ag.missionsCompleted || 0}`,
          `- **Active Service Ribbons:** ${ribbonsList || 'None in active service record'}`,
          `- **Unlocked Theme:** ${rank.unlockedThemePreset}`,
          `- **Unlocked Sprites:** ${rank.unlockedVariants.join(', ')}`,
          ``,
        ].join('\n');
      }),
      `---`,
      `*Exported from PixelOps Command Center · Autonomous Intelligence & Tactical Recon*`,
    ].join('\n');

    // Copy to clipboard
    navigator.clipboard.writeText(dossierMarkdown);
    setCopiedDossier(true);
    setTimeout(() => setCopiedDossier(false), 2500);

    // Also download file
    try {
      const blob = new Blob([dossierMarkdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pixelops_operative_dossier_${dateStr}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // Clipboard fallback already succeeded
    }

    if (onExportDossier) {
      onExportDossier();
    }
  };

  // ==========================================
  // PILL VARIANT (Minimal Header / Status Bar)
  // ==========================================
  if (variant === 'pill') {
    // Lounge or Armory: Show Clearance Rank Badge
    if (currentRoom === 'briefing_lounge' || currentRoom === 'armory') {
      const activeLvl = (activeCrewAgent?.clearanceLevel || 1) as ClearanceLevelNumber;
      const rank = CLEARANCE_RANKS[activeLvl];
      return (
        <button
          type="button"
          onClick={handleExportDossierCard}
          className={`px-2 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap bg-[#1a2333] hover:bg-[#25354e] text-[#fcd34d] border-[#f59e0b]/60 ${className}`}
          title="Click to export Operative Dossier Card"
        >
          <Award className="w-3 h-3 text-[#fbbf24]" />
          <span>{rank.badge}</span>
          <span className="hidden sm:inline font-mono text-[9px] text-[#cbd5e1]">
            [{activeCrewAgent?.xp || 0} XP]
          </span>
        </button>
      );
    }

    // Comms Tower or Basement: Recon Pill
    if (currentRoom === 'comms_tower' || currentRoom === 'archive_basement') {
      const primary = playbooks[0];
      if (!primary) return null;
      return (
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onExecutePlaybook(primary);
          }}
          disabled={isExecuting}
          className={`px-2 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap bg-[#11241a] hover:bg-[#193d2a] text-[#4ade80] border-[#16a34a] ${className}`}
          title={`Deploy ${primary.title} with ${primary.assignedOperativeName}`}
        >
          <Radar className="w-3 h-3" />
          <span>[📡 WIRE-TAP]</span>
        </button>
      );
    }

    // War Room or Server Vault: Tactical Pill
    if (currentRoom === 'war_room' || currentRoom === 'server_vault') {
      const primary = playbooks[0];
      if (!primary) return null;
      const gmailOk = isAppConnected('gmail');
      return (
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onExecutePlaybook(primary);
          }}
          disabled={isExecuting}
          className={`px-2 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap bg-[#291e10] hover:bg-[#3d2b15] text-[#fbbf24] border-[#f59e0b] ${className}`}
          title={`Deploy ${primary.title} with ${primary.assignedOperativeName}`}
        >
          <Zap className="w-3 h-3 text-[#f59e0b]" />
          <span>[⚡ TRIAGE GMAIL]</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              gmailOk ? 'bg-[#4ade80]' : 'bg-[#f59e0b]'
            }`}
          />
        </button>
      );
    }

    if (hasSatelliteModuleInRoom && onOpenReconMonitor) {
      return (
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onOpenReconMonitor();
          }}
          className={`px-2 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap bg-[#0b291e] hover:bg-[#113d2d] text-[#34d399] border-[#10b981] ${className}`}
          title="Open Tactical Satellite Recon Monitor (SAT_RECON)"
        >
          <Radar className="w-3 h-3" />
          <span>[🛰️ RECON MONITOR]</span>
        </button>
      );
    }

    return null;
  }

  // ==========================================
  // BANNER VARIANT (Docked Out-of-the-Way Below Room Canvas)
  // ==========================================
  if (variant === 'banner') {
    if (
      playbooks.length === 0 &&
      currentRoom !== 'briefing_lounge' &&
      currentRoom !== 'armory' &&
      !hasSatelliteModuleInRoom
    ) {
      return null;
    }

    if (isBannerCollapsed) {
      return (
        <div className={`bg-[#0a0d14]/90 border border-[#38bdf8]/30 px-3 py-1.5 flex items-center justify-between font-mono-tabular text-xs ${className}`}>
          <div className="flex items-center gap-2">
            <span className="text-[#38bdf8] font-bold text-[11px] uppercase tracking-wider">
              [⚡ SECTOR WORKFLOWS DECK]
            </span>
            <span className="text-[10px] text-[#94a3b8]">
              {hasSatelliteModuleInRoom ? 'Satellite Recon Module Active' : `${playbooks.length} Available`} in {currentRoom.toUpperCase().replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasSatelliteModuleInRoom && onOpenReconMonitor && (
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onOpenReconMonitor();
                }}
                className="px-2 py-0.5 bg-[#0c261c] hover:bg-[#133b2b] text-[#34d399] border border-[#10b981]/60 text-[10px] font-bold cursor-pointer transition-colors"
              >
                [🛰️ RECON MONITOR]
              </button>
            )}
            <button
              type="button"
              onClick={toggleBannerCollapse}
              className="px-2 py-0.5 bg-[#172333] hover:bg-[#203248] text-[#38bdf8] border border-[#38bdf8]/40 text-[10px] font-bold cursor-pointer transition-colors"
            >
              [+ EXPAND WORKFLOWS]
            </button>
          </div>
        </div>
      );
    }

    // --- LIBRARY / SATELLITE IMAGERY MODULE SECTOR ---
    if (currentRoom === 'library') {
      return (
        <div className={`bg-[#06120e]/92 border border-[#10b981]/50 p-2 sm:p-2.5 backdrop-blur-sm font-mono-tabular text-xs ${className}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#133829] pb-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <Radar className="w-3.5 h-3.5 text-[#34d399]" />
              <span className="font-bold text-[#34d399] text-[11px] uppercase tracking-wider">
                🛰️ SATELLITE IMAGERY &amp; DEEP RESEARCH MODULE (SAT_RECON)
              </span>
              <span className="text-[9px] px-1 bg-[#0b291e] text-[#34d399] border border-[#10b981]/40 font-bold">
                LIBRARY SECTOR
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onOpenReconMonitor && (
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onOpenReconMonitor();
                  }}
                  className="px-2.5 py-0.5 bg-[#10b981] hover:bg-[#059669] text-[#04120c] border border-[#34d399] text-[10px] font-bold cursor-pointer transition-colors flex items-center gap-1 shadow-[0_0_10px_rgba(16,185,129,0.35)]"
                >
                  <Radar className="w-3 h-3" />
                  <span>[🛰️ OPEN RECON MONITOR]</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleBannerCollapse}
                className="px-2 py-0.5 bg-[#091c15] hover:bg-[#113024] text-[#94a3b8] hover:text-[#34d399] border border-[#15382a] text-[10px] font-bold cursor-pointer transition-colors"
                title="Collapse workflows tray"
              >
                [− COLLAPSE]
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {onOpenReconMonitor && (
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onOpenReconMonitor();
                }}
                className="text-left p-2 bg-[#0a1f17] hover:bg-[#113326] border border-[#10b981]/60 hover:border-[#34d399] transition-all cursor-pointer flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[11px] text-[#34d399] flex items-center gap-1.5 truncate">
                    <span>🛰️</span>
                    <span className="truncate">Live Satellite Recon Monitor</span>
                  </div>
                  <div className="text-[9px] text-[#a7f3d0] truncate mt-0.5">
                    Feed: <span className="text-[#fbbf24]">[NASA GIBS &amp; Esri World Imagery]</span>
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
              </button>
            )}
            {playbooks.map((pb) => {
              const target = storedTargets[pb.id]?.targetName || 'Default Target';
              return (
                <button
                  key={pb.id}
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onExecutePlaybook(pb);
                  }}
                  disabled={isExecuting}
                  className="text-left p-2 bg-[#0d1922] hover:bg-[#152636] border border-[#1e3345] hover:border-[#34d399] transition-all cursor-pointer flex items-center justify-between gap-2 group disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[11px] text-[#f3ead8] flex items-center gap-1.5 truncate group-hover:text-[#34d399]">
                      <span>{pb.icon}</span>
                      <span className="truncate">{pb.shortTitle}</span>
                    </div>
                    <div className="text-[9px] text-[#94a3b8] truncate mt-0.5">
                      Target: <span className="text-[#fbbf24]">[{target}]</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#64748b] group-hover:text-[#34d399] shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    // --- PILLAR 1: Comms Tower & Basement ---
    if (currentRoom === 'comms_tower' || currentRoom === 'archive_basement') {
      return (
        <div className={`bg-[#080d14]/92 border border-[#38bdf8]/40 p-2 sm:p-2.5 backdrop-blur-sm font-mono-tabular text-xs ${className}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2b3d] pb-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <Radar className="w-3.5 h-3.5 text-[#38bdf8]" />
              <span className="font-bold text-[#38bdf8] text-[11px] uppercase tracking-wider">
                WATCHTOWER RECON WORKFLOWS
              </span>
              <span className="text-[9px] px-1 bg-[#102236] text-[#38bdf8] border border-[#38bdf8]/40 font-bold">
                {currentRoom === 'archive_basement' ? 'BASEMENT' : 'COMMS TOWER'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#94a3b8] hidden md:inline">
                Zero-Prompt OSINT & Surveillance Automation
              </span>
              {hasSatelliteModuleInRoom && onOpenReconMonitor && (
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onOpenReconMonitor();
                  }}
                  className="px-2 py-0.5 bg-[#0c261c] hover:bg-[#133b2b] text-[#34d399] border border-[#10b981]/60 text-[10px] font-bold cursor-pointer transition-colors flex items-center gap-1"
                >
                  <Radar className="w-3 h-3" />
                  <span>[🛰️ RECON MONITOR]</span>
                </button>
              )}
              {currentRoom === 'archive_basement' && onOpenVfs && (
                <button
                  type="button"
                  onClick={() => onOpenVfs('intel/')}
                  className="px-2 py-0.5 bg-[#142333] hover:bg-[#1b324a] text-[#38bdf8] border border-[#38bdf8]/50 text-[10px] font-bold cursor-pointer transition-colors flex items-center gap-1"
                >
                  <FolderArchive className="w-3 h-3" />
                  <span>[📂 VFS FILES]</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleBannerCollapse}
                className="px-2 py-0.5 bg-[#101924] hover:bg-[#192738] text-[#94a3b8] hover:text-[#38bdf8] border border-[#1e2f45] text-[10px] font-bold cursor-pointer transition-colors"
                title="Collapse workflows tray"
              >
                [− COLLAPSE]
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {playbooks.map((pb) => {
              const target = storedTargets[pb.id]?.targetName || 'Default Target';
              return (
                <button
                  key={pb.id}
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onExecutePlaybook(pb);
                  }}
                  disabled={isExecuting}
                  className="text-left p-2 bg-[#0e1622] hover:bg-[#152336] border border-[#1e2f45] hover:border-[#38bdf8] transition-all cursor-pointer flex items-center justify-between gap-2 group disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[11px] text-[#f3ead8] flex items-center gap-1.5 truncate group-hover:text-[#38bdf8]">
                      <span>{pb.icon}</span>
                      <span className="truncate">{pb.shortTitle}</span>
                    </div>
                    <div className="text-[9px] text-[#94a3b8] truncate mt-0.5">
                      Target: <span className="text-[#fbbf24]">[{target}]</span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-[#64748b] group-hover:text-[#38bdf8] shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // --- PILLAR 2: War Room & Server Vault ---
    if (currentRoom === 'war_room' || currentRoom === 'server_vault') {
      const gmailOk = isAppConnected('gmail');
      const calOk = isAppConnected('googlecalendar') || isAppConnected('calendar');
      const ghOk = isAppConnected('github');

      return (
        <div className={`bg-[#0b0c10]/92 border border-[#e59838]/40 p-2 sm:p-2.5 backdrop-blur-sm font-mono-tabular text-xs ${className}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2d2214] pb-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-[#e59838]" />
              <span className="font-bold text-[#e59838] text-[11px] uppercase tracking-wider">
                TACTICAL OPERATOR WORKFLOWS
              </span>
              <span className="text-[9px] px-1 bg-[#261d10] text-[#e59838] border border-[#e59838]/40 font-bold">
                {currentRoom === 'war_room' ? 'WAR ROOM' : 'SERVER VAULT'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#94a3b8] hidden md:inline">
                1-Click Connected App Automations via Composio
              </span>
              {hasSatelliteModuleInRoom && onOpenReconMonitor && (
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onOpenReconMonitor();
                  }}
                  className="px-2 py-0.5 bg-[#0c261c] hover:bg-[#133b2b] text-[#34d399] border border-[#10b981]/60 text-[10px] font-bold cursor-pointer transition-colors flex items-center gap-1"
                >
                  <Radar className="w-3 h-3" />
                  <span>[🛰️ RECON MONITOR]</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleBannerCollapse}
                className="px-2 py-0.5 bg-[#17140f] hover:bg-[#241e15] text-[#94a3b8] hover:text-[#e59838] border border-[#3d2e1b] text-[10px] font-bold cursor-pointer transition-colors"
                title="Collapse workflows tray"
              >
                [− COLLAPSE]
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {playbooks.map((pb) => {
              const target = storedTargets[pb.id]?.targetName || 'Default Target';
              let isConnected = false;
              let appBadge = 'APP';
              if (pb.id === 'triage_gmail') {
                isConnected = gmailOk;
                appBadge = 'GMAIL';
              } else if (pb.id === 'calendar_brief' || pb.id === 'quick_schedule_briefing') {
                isConnected = calOk;
                appBadge = 'GCAL';
              } else if (pb.id === 'sync_github') {
                isConnected = ghOk;
                appBadge = 'GITHUB';
              }

              return (
                <button
                  key={pb.id}
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    onExecutePlaybook(pb);
                  }}
                  disabled={isExecuting}
                  className="text-left p-2 bg-[#14120e] hover:bg-[#211c14] border border-[#2e2315] hover:border-[#e59838] transition-all cursor-pointer flex items-center justify-between gap-2 group disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-[11px] text-[#f3ead8] flex items-center gap-1.5 truncate group-hover:text-[#e59838]">
                      <span>{pb.icon}</span>
                      <span className="truncate">{pb.shortTitle}</span>
                    </div>
                    <div className="text-[9px] text-[#94a3b8] truncate mt-0.5">
                      Target: <span className="text-[#fbbf24]">[{target}]</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[8px] font-bold px-1 py-0.2 border flex items-center gap-1 ${
                        isConnected
                          ? 'bg-[#102919] text-[#4ade80] border-[#22c55e]/40'
                          : 'bg-[#2b1f11] text-[#fbbf24] border-[#f59e0b]/40'
                      }`}
                    >
                      <span
                        className={`w-1 h-1 rounded-full ${
                          isConnected ? 'bg-[#4ade80]' : 'bg-[#fbbf24]'
                        }`}
                      />
                      <span>{appBadge}</span>
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#64748b] group-hover:text-[#e59838]" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    // --- PILLAR 3: Lounge & Armory ---
    if (currentRoom === 'briefing_lounge' || currentRoom === 'armory') {
      const agent = activeCrewAgent;
      const clearanceLvl = (agent?.clearanceLevel || 1) as ClearanceLevelNumber;
      const clearance = CLEARANCE_RANKS[clearanceLvl];
      const xp = agent?.xp || 0;
      const minXp = clearance.minXp;
      const maxXp = clearance.maxXp;
      const nextTargetXp = maxXp === Infinity ? 500 : maxXp;
      const progressPct =
        maxXp === Infinity
          ? 100
          : Math.min(100, Math.max(0, Math.round(((xp - minXp) / (maxXp - minXp)) * 100)));
      const activeRibbons = (agent?.serviceRibbons || []) as ServiceRibbonId[];
      const agentDisplayName = agent?.customName || agent?.defaultName || 'Operative';

      return (
        <div className={`bg-[#0c0d12]/92 border border-[#a855f7]/40 p-2 sm:p-2.5 backdrop-blur-sm font-mono-tabular text-xs ${className}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2b1b3d] pb-1.5 mb-1.5">
            <div className="flex items-center gap-2">
              <Award className="w-3.5 h-3.5 text-[#c084fc]" />
              <span className="font-bold text-[#c084fc] text-[11px] uppercase tracking-wider">
                OPERATIVE PROGRESSION & LOADOUT
              </span>
              <span className="text-[9px] px-1 bg-[#251336] text-[#c084fc] border border-[#a855f7]/40 font-bold">
                {currentRoom === 'armory' ? 'ARMORY' : 'LOUNGE'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleExportDossierCard}
              className="py-1 px-2.5 bg-[#a855f7] hover:bg-[#9333ea] text-[#0d0914] text-[10px] font-bold border border-[#a855f7] cursor-pointer transition-colors flex items-center gap-1.5 shadow-[0_0_8px_rgba(168,85,247,0.3)]"
            >
              {copiedDossier ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedDossier ? 'COPIED!' : '[🪪 EXPORT DOSSIER CARD]'}</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 bg-[#12111a] border border-[#231a33]">
            <div className="flex items-center gap-3">
              <span className="text-xl">🪪</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[11px] text-[#f3ead8]">{agentDisplayName}</span>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.2 border"
                    style={{
                      color: clearance.terminalRGB,
                      borderColor: `${clearance.terminalRGB}66`,
                      backgroundColor: `${clearance.terminalRGB}15`,
                    }}
                  >
                    {clearance.badge}
                  </span>
                </div>
                <div className="text-[10px] font-semibold" style={{ color: clearance.terminalRGB }}>
                  {clearance.title}
                </div>
              </div>
            </div>

            {/* XP Progress Bar */}
            <div className="flex-1 max-w-xs">
              <div className="flex items-center justify-between text-[9px] text-[#94a3b8] mb-0.5">
                <span>CLEARANCE XP</span>
                <span className="font-bold text-[#f3ead8]">
                  {xp} / {nextTargetXp} XP ({progressPct}%)
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#1f192b] overflow-hidden border border-[#3d2956]">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${progressPct}%`, backgroundColor: clearance.terminalRGB }}
                />
              </div>
            </div>

            {/* Ribbons */}
            <div className="flex items-center gap-1">
              {Object.entries(SERVICE_RIBBONS).map(([key, def]) => {
                const isEarned = activeRibbons.includes(key as ServiceRibbonId);
                return (
                  <span
                    key={key}
                    className={`px-1.5 py-0.5 border text-[9px] flex items-center gap-0.5 ${
                      isEarned
                        ? 'bg-[#122319] text-[#4ade80] border-[#22c55e]/50 font-bold'
                        : 'bg-[#10141c] text-[#475569] border-[#1e293b] opacity-40'
                    }`}
                    title={isEarned ? `${def.title}: ${def.description}` : `Locked: ${def.description}`}
                  >
                    <span>{def.icon}</span>
                    <span className="hidden md:inline">{def.title}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    if (hasSatelliteModuleInRoom && onOpenReconMonitor) {
      return (
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onOpenReconMonitor();
          }}
          className={`px-2 py-0.5 font-bold text-[10px] sm:text-[11px] border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 whitespace-nowrap bg-[#0b291e] hover:bg-[#113d2d] text-[#34d399] border-[#10b981] ${className}`}
          title="Open Tactical Satellite Recon Monitor (SAT_RECON)"
        >
          <Radar className="w-3 h-3" />
          <span>[🛰️ RECON MONITOR]</span>
        </button>
      );
    }

    return null;
  }

  // ==========================================
  // FLOATING HUD VARIANT (Unified Customizable Sector Workflow Deck)
  // ==========================================

  const gmailConnected = isAppConnected('gmail');
  const calendarConnected = isAppConnected('googlecalendar') || isAppConnected('calendar');
  const githubConnected = isAppConnected('github');

  const agent = activeCrewAgent;
  const clearanceLvl = (agent?.clearanceLevel || 1) as ClearanceLevelNumber;
  const clearance = CLEARANCE_RANKS[clearanceLvl];
  const xp = agent?.xp || 0;
  const minXp = clearance.minXp;
  const maxXp = clearance.maxXp;
  const nextTargetXp = maxXp === Infinity ? 500 : maxXp;
  const progressPct =
    maxXp === Infinity
      ? 100
      : Math.min(100, Math.max(0, Math.round(((xp - minXp) / (maxXp - minXp)) * 100)));
  const activeRibbons = (agent?.serviceRibbons || []) as ServiceRibbonId[];
  const agentDisplayName = agent?.customName || agent?.defaultName || 'Operative';

  const currentRoomBadge =
    allRooms[currentRoom]?.shortBadge || currentRoom.toUpperCase().replace(/_/g, ' ');

  const isAmberRoom = currentRoom === 'war_room' || currentRoom === 'server_vault';
  const isPurpleRoom = currentRoom === 'briefing_lounge' || currentRoom === 'armory';
  const isEmeraldRoom =
    currentRoom === 'library' || roomDeckItems.includes('live_satellite_recon');

  const accentHex = isAmberRoom
    ? '#e59838'
    : isPurpleRoom
    ? '#c084fc'
    : isEmeraldRoom
    ? '#34d399'
    : '#38bdf8';

  const borderHex = isAmberRoom
    ? '#e59838'
    : isPurpleRoom
    ? '#a855f7'
    : isEmeraldRoom
    ? '#10b981'
    : '#38bdf8';

  const renderDeckItem = (itemId: RoomWorkflowItemId) => {
    const def = ALL_WORKFLOW_DECK_ITEMS.find((i) => i.id === itemId);
    if (!def) return null;

    if (itemId === 'live_satellite_recon') {
      if (!onOpenReconMonitor) return null;
      return (
        <button
          key={itemId}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsFloatingOpen(false);
            playBeep('tap');
            onOpenReconMonitor();
          }}
          className="w-full text-left p-1.5 bg-[#0a1f17] hover:bg-[#113326] border border-[#10b981]/60 hover:border-[#34d399] transition-all cursor-pointer flex items-center justify-between gap-1.5 group"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#34d399] flex items-center gap-1.5 truncate">
              <span>🛰️</span>
              <span className="truncate">Live Satellite Recon Monitor</span>
            </div>
            <div className="text-[9px] text-[#a7f3d0] truncate mt-0.5">
              NASA GIBS &amp; Esri Orbital Overlay
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-[#34d399] shrink-0" />
        </button>
      );
    }

    if (itemId === 'open_vfs_files') {
      if (!onOpenVfs) return null;
      return (
        <button
          key={itemId}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsFloatingOpen(false);
            playBeep('tap');
            onOpenVfs('intel/');
          }}
          className="w-full text-left p-1.5 bg-[#101c2a] hover:bg-[#17283b] border border-[#38bdf8]/50 hover:border-[#38bdf8] transition-all cursor-pointer flex items-center justify-between gap-1.5 group"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#38bdf8] flex items-center gap-1.5 truncate">
              <span>📂</span>
              <span className="truncate">Open VFS Vault Files</span>
            </div>
            <div className="text-[9px] text-[#94a3b8] truncate mt-0.5">
              Browse /intel/ dossiers &amp; classified feeds
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
        </button>
      );
    }

    if (itemId === 'operative_dossier') {
      return (
        <div
          key={itemId}
          className="p-1.5 bg-[#141221] border border-[#3d2956] flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold text-[#f3ead8] flex items-center gap-1.5 truncate">
              <span>🪪</span>
              <span className="truncate">{agentDisplayName}</span>
              <span className="text-[9px] text-[#94a3b8]">({agent?.role})</span>
            </div>
            <span
              className="text-[9px] font-bold px-1.5 py-0.2 border shrink-0"
              style={{
                color: clearance.terminalRGB,
                borderColor: `${clearance.terminalRGB}66`,
                backgroundColor: `${clearance.terminalRGB}15`,
              }}
            >
              {clearance.badge} · {xp} XP
            </span>
          </div>

          <div className="w-full h-1.5 bg-[#1f192b] overflow-hidden border border-[#3d2956]">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                backgroundColor: clearance.terminalRGB,
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-1">
            {Object.entries(SERVICE_RIBBONS).map(([key, rDef]) => {
              const isEarned = activeRibbons.includes(key as ServiceRibbonId);
              return (
                <div
                  key={key}
                  className={`p-1 border text-[8px] flex items-center gap-1 truncate ${
                    isEarned
                      ? 'bg-[#122319] text-[#4ade80] border-[#22c55e]/50 font-bold'
                      : 'bg-[#10141c] text-[#475569] border-[#1e293b] opacity-60'
                  }`}
                  title={isEarned ? `${rDef.title}: ${rDef.description}` : `Locked: ${rDef.description}`}
                >
                  <span>{rDef.icon}</span>
                  <span className="truncate">{rDef.title}</span>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleExportDossierCard}
            className="w-full py-1 px-2 bg-[#a855f7] text-[#0d0914] font-bold text-[10px] border border-[#a855f7] hover:bg-[#9333ea] cursor-pointer transition-all flex items-center justify-center gap-1"
          >
            {copiedDossier ? (
              <>
                <Check className="w-3 h-3 text-[#0d0914]" />
                <span>DOSSIER COPIED &amp; SAVED!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>[🪪 EXPORT OPERATIVE DOSSIER]</span>
              </>
            )}
          </button>
        </div>
      );
    }

    if (def.playbookId) {
      const pb = INTELLIGENCE_PLAYBOOKS[def.playbookId];
      if (!pb) return null;
      const target = storedTargets[pb.id]?.targetName || 'Default Target';

      let appBadge: string | null = null;
      let isConnected = false;
      if (pb.id === 'triage_gmail') {
        appBadge = 'GMAIL';
        isConnected = gmailConnected;
      } else if (pb.id === 'calendar_brief' || pb.id === 'quick_schedule_briefing') {
        appBadge = 'GCAL';
        isConnected = calendarConnected;
      } else if (pb.id === 'sync_github') {
        appBadge = 'GITHUB';
        isConnected = githubConnected;
      }

      return (
        <button
          key={itemId}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsFloatingOpen(false);
            playBeep('tap');
            onExecutePlaybook(pb);
          }}
          disabled={isExecuting}
          className="w-full text-left p-1.5 bg-[#121924] hover:bg-[#192536] border border-[#23354d] hover:border-[#38bdf8] transition-all cursor-pointer flex items-center justify-between gap-1.5 group disabled:opacity-50"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#f3ead8] flex items-center gap-1.5 truncate group-hover:text-[#38bdf8]">
              <span>{pb.icon}</span>
              <span className="truncate">{pb.shortTitle}</span>
            </div>
            <div className="text-[9px] text-[#94a3b8] truncate mt-0.5 flex items-center gap-1">
              <span>{pb.assignedOperativeName}</span>
              <span>·</span>
              <span className="text-[#fbbf24] truncate">[{target}]</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {appBadge && (
              <span
                className={`text-[8px] font-bold px-1 py-0.2 border flex items-center gap-1 ${
                  isConnected
                    ? 'bg-[#102919] text-[#4ade80] border-[#22c55e]/40'
                    : 'bg-[#2b1f11] text-[#fbbf24] border-[#f59e0b]/40'
                }`}
              >
                <span
                  className={`w-1 h-1 rounded-full ${
                    isConnected ? 'bg-[#4ade80]' : 'bg-[#fbbf24]'
                  }`}
                />
                <span>{appBadge}</span>
              </span>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-[#64748b] group-hover:text-[#38bdf8] shrink-0" />
          </div>
        </button>
      );
    }

    return null;
  };

  return (
    <div
      ref={floatingRef}
      className={`absolute top-2 right-2 sm:right-3 z-30 pointer-events-auto font-mono-tabular ${className}`}
    >
      {!isFloatingOpen ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            playBeep('tap');
            setIsFloatingOpen(true);
          }}
          style={{
            color: accentHex,
            borderColor: `${borderHex}aa`,
          }}
          className="px-2 py-1 bg-[#0b1017]/90 hover:bg-[#131d2b] border text-[10px] font-bold backdrop-blur-sm cursor-pointer flex items-center gap-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.65)] active:scale-95 transition-all"
          title={`Open Sector Workflow Deck for ${currentRoomBadge} (${roomDeckItems.length} workflows)`}
        >
          <Radar className="w-3 h-3" style={{ color: accentHex }} />
          <span>[⚡ SECTOR WORKFLOW DECK ({roomDeckItems.length}) ▾]</span>
        </button>
      ) : (
        <div
          style={{ borderColor: borderHex }}
          className="bg-[#0b1017]/96 border shadow-[0_0_24px_rgba(0,0,0,0.75)] p-2 sm:p-2.5 backdrop-blur-md flex flex-col gap-1.5 w-[290px] sm:w-[340px] max-h-[48dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Deck Header */}
          <div className="flex items-center justify-between gap-2 border-b border-[#1e2d3d] pb-1">
            <span
              style={{ color: accentHex }}
              className="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1 truncate"
            >
              <Radar className="w-3 h-3 shrink-0" />
              <span className="truncate">{currentRoomBadge} WORKFLOW DECK</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playBeep('tap');
                  setIsCustomizingDeck((prev) => !prev);
                }}
                className={`px-1.5 py-0.5 text-[9px] font-bold border cursor-pointer flex items-center gap-1 transition-colors ${
                  isCustomizingDeck
                    ? 'bg-[#e59838]/20 text-[#fde047] border-[#e59838]'
                    : 'bg-[#131e2e] text-[#94a3b8] hover:text-[#f3ead8] border-[#263850]'
                }`}
                title="Customize which workflows appear in this room's deck or move them to another room"
              >
                <SlidersHorizontal className="w-2.5 h-2.5" />
                <span>{isCustomizingDeck ? 'DONE' : 'EDIT DECK'}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFloatingOpen(false);
                  setIsCustomizingDeck(false);
                  playBeep('tap');
                }}
                className="p-0.5 text-[#94a3b8] hover:text-[#f3ead8] hover:bg-[#1a293d] cursor-pointer transition-colors"
                title="Minimize deck"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {!isCustomizingDeck ? (
            <>
              {roomDeckItems.length === 0 ? (
                <div className="p-2.5 text-center bg-[#0f1622] border border-[#1e293b] text-[10px] text-[#94a3b8]">
                  No workflows assigned to {currentRoomBadge}. Click{' '}
                  <button
                    type="button"
                    onClick={() => setIsCustomizingDeck(true)}
                    className="text-[#38bdf8] underline font-bold cursor-pointer"
                  >
                    EDIT DECK
                  </button>{' '}
                  to add workflows here.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5 pt-0.5">
                  {roomDeckItems.map((itemId) => renderDeckItem(itemId))}
                </div>
              )}
            </>
          ) : (
            /* Interactive Deck Customizer: Toggle, Reorder, or Move Workflows to Another Room */
            <div className="flex flex-col gap-1.5 pt-0.5">
              <div className="flex items-center justify-between text-[9px] text-[#94a3b8] bg-[#0f1724] px-2 py-1 border border-[#1e293b]">
                <span>Check to show in {currentRoomBadge}, or move to another room:</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playBeep('tap');
                    resetRoomWorkflowDecksToDefault();
                  }}
                  className="text-[#e59838] hover:text-[#fde047] font-bold flex items-center gap-0.5 cursor-pointer shrink-0 ml-1"
                  title="Reset all room workflow decks to defaults"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>RESET</span>
                </button>
              </div>

              <div className="flex flex-col gap-1 max-h-[34dvh] overflow-y-auto pr-0.5">
                {ALL_WORKFLOW_DECK_ITEMS.map((item) => {
                  const isAssignedHere = roomDeckItems.includes(item.id);
                  const orderIdx = roomDeckItems.indexOf(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`p-1.5 border text-[10px] flex flex-col gap-1 transition-colors ${
                        isAssignedHere
                          ? 'bg-[#10221c] border-[#10b981]/60 text-[#f3ead8]'
                          : 'bg-[#0e131d] border-[#1e293b] text-[#94a3b8]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            playBeep('tap');
                            toggleWorkflowInRoomDeck(currentRoom, item.id);
                          }}
                          className="flex items-center gap-1.5 text-left min-w-0 flex-1 cursor-pointer"
                        >
                          <span
                            className={`w-3.5 h-3.5 flex items-center justify-center border text-[9px] font-bold shrink-0 ${
                              isAssignedHere
                                ? 'bg-[#10b981] border-[#34d399] text-[#04120c]'
                                : 'bg-[#090d14] border-[#334155] text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <span className="shrink-0">{item.icon}</span>
                          <span className="font-bold truncate">{item.shortTitle}</span>
                        </button>

                        {isAssignedHere && roomDeckItems.length > 1 && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              disabled={orderIdx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                playBeep('tap');
                                reorderWorkflowInRoomDeck(currentRoom, item.id, 'up');
                              }}
                              className="p-0.5 bg-[#162436] hover:bg-[#1f334d] text-[#cbd5e1] disabled:opacity-30 cursor-pointer"
                              title="Move Up"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={orderIdx === roomDeckItems.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                playBeep('tap');
                                reorderWorkflowInRoomDeck(currentRoom, item.id, 'down');
                              }}
                              className="p-0.5 bg-[#162436] hover:bg-[#1f334d] text-[#cbd5e1] disabled:opacity-30 cursor-pointer"
                              title="Move Down"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Move to another room selector */}
                      <div className="flex items-center justify-between gap-1.5 pl-5 text-[9px]">
                        <span className="text-[#64748b] truncate">{item.description}</span>
                        <select
                          value=""
                          onChange={(e) => {
                            const targetRoom = e.target.value;
                            if (!targetRoom) return;
                            playBeep('tap');
                            moveWorkflowToRoomDeck(currentRoom, targetRoom, item.id);
                          }}
                          className="bg-[#090d14] border border-[#263850] text-[#38bdf8] px-1 py-0.5 text-[9px] rounded outline-none cursor-pointer shrink-0"
                          title="Move this workflow to another room's deck"
                        >
                          <option value="">Move to room...</option>
                          {allRoomIds
                            .filter((rId) => rId !== currentRoom)
                            .map((rId) => (
                              <option key={rId} value={rId}>
                                &rarr; {allRooms[rId]?.shortBadge || rId.toUpperCase()}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
