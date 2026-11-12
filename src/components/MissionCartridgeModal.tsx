import React, { useRef, useState } from 'react';
import {
  Package,
  Play,
  Download,
  Upload,
  Copy,
  Check,
  Trash2,
  Sparkles,
  Share2,
} from 'lucide-react';
import { TacticalModalDialog } from './TacticalModalDialog';
import {
  BUILTIN_ARMORY_CARTRIDGES,
  listInstalledCustomCartridges,
  saveInstalledCustomCartridge,
  deleteInstalledCustomCartridge,
  getActiveCartridgeId,
  parseAndValidateCartridge,
  applyMissionCartridge,
  exportCurrentSafehouseCartridge,
  downloadCartridgeFile,
  type MissionCartridgeV1,
} from '../services/MissionCartridgeService';
import type { RoomId } from '../engine/roomData';
import { useCrew } from '../context/CrewContext';
import { useTheme } from '../context/ThemeContext';

export interface MissionCartridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchRoom?: (room: RoomId) => void;
  onMoveAgentToRoom?: (agentId: string, room: RoomId) => void;
  onLaunchStarterDirective?: (directive: string, room: RoomId, agentId: string) => void;
}

export const MissionCartridgeModal: React.FC<MissionCartridgeModalProps> = ({
  isOpen,
  onClose,
  onSwitchRoom,
  onMoveAgentToRoom,
  onLaunchStarterDirective,
}) => {
  const { playBeep } = useTheme();
  const { crewAgents, updateAgentConfig, updateAgentRoom } = useCrew();
  const [activeTab, setActiveTab] = useState<'armory' | 'export' | 'import'>('armory');
  const [customCartridges, setCustomCartridges] = useState<MissionCartridgeV1[]>(() =>
    listInstalledCustomCartridges()
  );
  const [activeId, setActiveId] = useState<string | null>(() => getActiveCartridgeId());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Export form state
  const [exportName, setExportName] = useState('My Custom Safehouse Playbook');
  const [exportTagline, setExportTagline] = useState(
    'One-click spatial room layout, MCP endpoints & deterministic tripwires'
  );
  const [exportDirective, setExportDirective] = useState(
    'Execute full sector reconnaissance and file an updated intelligence brief in Workspace Files.'
  );

  // Import JSON state
  const [importJsonText, setImportJsonText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLoadCartridge = async (cartridge: MissionCartridgeV1, launchNow: boolean) => {
    playBeep('switch');
    const summary = await applyMissionCartridge(cartridge, {
      onUpdateAgentConfig: (agentId, updates) => {
        updateAgentConfig(agentId, updates as any);
        if (updates.currentRoom) {
          updateAgentRoom(agentId, updates.currentRoom);
        }
      },
      onMoveAgentToRoom: (agentId, room) => {
        onMoveAgentToRoom?.(agentId, room);
      },
    });
    setActiveId(cartridge.id);
    onSwitchRoom?.(cartridge.starterRoom);
    setFeedback(
      `Loaded "${cartridge.name}" — configured ${summary.appliedAgents} operative(s) & armed ${summary.appliedTripwires} tripwire(s).`
    );

    if (launchNow && onLaunchStarterDirective && cartridge.starterDirective) {
      onLaunchStarterDirective(
        cartridge.starterDirective,
        cartridge.starterRoom,
        cartridge.starterAgentId
      );
      onClose();
    }
  };

  const handleExportDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('switch');
    const cartridge = await exportCurrentSafehouseCartridge({
      name: exportName,
      tagline: exportTagline,
      starterDirective: exportDirective,
      crewSnapshots: crewAgents.map((c) => ({
        id: c.id,
        customName: c.customName,
        role: c.role,
        currentRoom: c.currentRoom as RoomId,
        spriteVariant: c.spriteVariant,
        systemPrompt: c.systemPrompt,
        assignedTools: c.assignedTools,
      })),
    });
    downloadCartridgeFile(cartridge);
    setFeedback(
      `Exported "${cartridge.name}.pixelops.cartridge.json" (checksum ${cartridge.checksum}, credentials scrubbed).`
    );
  };

  const handleCopyShareJson = async (cartridge: MissionCartridgeV1) => {
    playBeep('tap');
    await navigator.clipboard.writeText(JSON.stringify(cartridge, null, 2));
    setCopiedId(cartridge.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleImportText = () => {
    playBeep('switch');
    const parsed = parseAndValidateCartridge(importJsonText);
    if (!parsed.ok || !parsed.cartridge) {
      setFeedback(`⚠️ Import rejected: ${parsed.error}`);
      return;
    }
    const next = saveInstalledCustomCartridge(parsed.cartridge);
    setCustomCartridges(next);
    setImportJsonText('');
    setActiveTab('armory');
    setFeedback(`Installed community cartridge "${parsed.cartridge.name}" into Armory Deck!`);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    const parsed = parseAndValidateCartridge(raw);
    if (!parsed.ok || !parsed.cartridge) {
      setFeedback(`⚠️ File rejected: ${parsed.error}`);
      return;
    }
    const next = saveInstalledCustomCartridge(parsed.cartridge);
    setCustomCartridges(next);
    setActiveTab('armory');
    setFeedback(`Imported "${parsed.cartridge.name}" from ${file.name}!`);
    e.target.value = '';
  };

  const allCartridges = [...customCartridges, ...BUILTIN_ARMORY_CARTRIDGES];

  return (
    <TacticalModalDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Armory Shareable Mission Cartridges"
      subtitle="1-Click Instant Onboarding · Portable Prompts, Room Layouts, MCP Chains & Tripwires"
      badge={`${allCartridges.length} CARTRIDGES READY`}
      icon={<Package className="w-4 h-4" />}
    >
      {/* Navigation Tabs */}
      <div className="px-4 pt-3 bg-[#0e1422] border-b border-[#1e293b] flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTab('armory')}
          className={`px-3 py-2 text-xs font-bold uppercase border-t border-x cursor-pointer ${
            activeTab === 'armory'
              ? 'bg-[#0b0e15] border-[#4ade80] text-[#4ade80]'
              : 'bg-[#12192b] border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          📦 Armory Cartridge Deck ({allCartridges.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('export')}
          className={`px-3 py-2 text-xs font-bold uppercase border-t border-x cursor-pointer ${
            activeTab === 'export'
              ? 'bg-[#0b0e15] border-[#38bdf8] text-[#7dd3fc]'
              : 'bg-[#12192b] border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          📤 Export &amp; Share Current Safehouse
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`px-3 py-2 text-xs font-bold uppercase border-t border-x cursor-pointer ${
            activeTab === 'import'
              ? 'bg-[#0b0e15] border-[#f59e0b] text-[#fbbf24]'
              : 'bg-[#12192b] border-transparent text-[#94a3b8] hover:text-white'
          }`}
        >
          📥 Import Community Playbook
        </button>
      </div>

      {feedback && (
        <div className="mx-4 mt-3 px-3 py-2 bg-[#10261d] border border-[#4ade80] text-xs text-[#bbf7d0]">
          {feedback}
        </div>
      )}

      {activeTab === 'armory' && (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {allCartridges.map((cart) => {
            const isInstalledCustom = customCartridges.some((c) => c.id === cart.id);
            const isLoaded = activeId === cart.id;
            return (
              <div
                key={cart.id}
                className={`p-3.5 bg-[#0f1524] border flex flex-col justify-between gap-3 ${
                  isLoaded ? 'border-[#4ade80] shadow-[0_0_16px_rgba(74,222,128,0.18)]' : 'border-[#273552]'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.5 bg-[#172554] border border-[#3b82f6] text-[10px] font-bold text-[#93c5fd]">
                          {cart.difficulty.toUpperCase()}
                        </span>
                        {isLoaded && (
                          <span className="px-1.5 py-0.5 bg-[#0e291d] border border-[#4ade80] text-[10px] font-bold text-[#4ade80]">
                            ACTIVE LOADOUT
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-white mt-1.5">{cart.name}</h3>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Copy shareable cartridge JSON"
                        onClick={() => void handleCopyShareJson(cart)}
                        className="p-1.5 bg-[#141d30] hover:bg-[#1d2b47] border border-[#334155] text-[#cbd5e1] cursor-pointer"
                      >
                        {copiedId === cart.id ? (
                          <Check className="w-3.5 h-3.5 text-[#4ade80]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        title="Download .pixelops.cartridge.json"
                        onClick={() => {
                          playBeep('tap');
                          downloadCartridgeFile(cart);
                        }}
                        className="p-1.5 bg-[#141d30] hover:bg-[#1d2b47] border border-[#334155] text-[#cbd5e1] cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {isInstalledCustom && (
                        <button
                          type="button"
                          title="Delete custom cartridge"
                          onClick={() => {
                            playBeep('tap');
                            setCustomCartridges(deleteInstalledCustomCartridge(cart.id));
                          }}
                          className="p-1.5 bg-[#2a1215] border border-[#ef4444]/60 text-[#fca5a5] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-[#cbd5e1] mt-1.5">{cart.description}</p>

                  <div className="flex flex-wrap gap-1 mt-2.5">
                    {cart.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 bg-[#090d16] border border-[#24324b] text-[10px] text-[#94a3b8]"
                      >
                        #{tag}
                      </span>
                    ))}
                    {cart.tripwireWatches && cart.tripwireWatches.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-[#271805] border border-[#d97706]/60 text-[10px] text-[#fcd34d]">
                        +{cart.tripwireWatches.length} Tripwire(s)
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#1e293b] flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLoadCartridge(cart, false)}
                    className="tactical-ctrl flex-1 py-1.5 px-2.5 bg-[#132238] hover:bg-[#1b3150] border border-[#38bdf8] text-xs font-bold text-[#7dd3fc] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>1-Click Load</span>
                  </button>
                  {onLaunchStarterDirective && (
                    <button
                      type="button"
                      onClick={() => void handleLoadCartridge(cart, true)}
                      className="tactical-ctrl flex-1 py-1.5 px-2.5 bg-[#10291e] hover:bg-[#173d2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Load &amp; Execute</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'export' && (
        <form onSubmit={handleExportDownload} className="p-4 max-w-2xl flex flex-col gap-3.5">
          <div className="p-3 bg-[#10192b] border border-[#283959] text-xs text-[#cbd5e1]">
            Exports your live operative system prompts, room assignments, skill bindings, spatial
            leash rules, MCP endpoint URLs, and deterministic tripwire watches into a portable{' '}
            <code>.pixelops.cartridge.json</code> file.{' '}
            <strong className="text-[#4ade80]">
              API keys and bearer tokens are automatically scrubbed.
            </strong>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[#cbd5e1]">
            <span>Cartridge Name</span>
            <input
              type="text"
              required
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              className="px-3 py-2 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#cbd5e1]">
            <span>Short Tagline</span>
            <input
              type="text"
              value={exportTagline}
              onChange={(e) => setExportTagline(e.target.value)}
              className="px-3 py-2 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#cbd5e1]">
            <span>Starter Mission Directive (run when recipient clicks Load &amp; Execute)</span>
            <textarea
              rows={3}
              value={exportDirective}
              onChange={(e) => setExportDirective(e.target.value)}
              className="px-3 py-2 bg-[#090d16] border border-[#2c3a57] text-xs text-white"
            />
          </label>

          <button
            type="submit"
            className="tactical-ctrl py-2.5 px-4 bg-[#10291e] hover:bg-[#173d2b] border border-[#4ade80] text-xs font-bold text-[#4ade80] flex items-center justify-center gap-2 cursor-pointer w-fit"
          >
            <Share2 className="w-4 h-4" />
            <span>Download .pixelops.cartridge.json</span>
          </button>
        </form>
      )}

      {activeTab === 'import' && (
        <div className="p-4 max-w-2xl flex flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="tactical-ctrl py-2 px-3.5 bg-[#14233a] hover:bg-[#1c3252] border border-[#38bdf8] text-xs font-bold text-[#7dd3fc] flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Upload .pixelops.cartridge.json File</span>
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[#cbd5e1]">
            <span>Or Paste Community Cartridge JSON</span>
            <textarea
              rows={8}
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              placeholder='{"schema": "pixelops.cartridge.v1", "name": "...", "crewLoadouts": [...]}'
              className="p-3 bg-[#090d16] border border-[#2c3a57] text-xs text-white font-mono"
            />
          </label>

          <button
            type="button"
            disabled={!importJsonText.trim()}
            onClick={handleImportText}
            className="tactical-ctrl py-2 px-4 bg-[#451a03] hover:bg-[#5c2306] disabled:opacity-40 border border-[#f59e0b] text-xs font-bold text-[#fde68a] w-fit cursor-pointer"
          >
            Validate &amp; Install into Armory
          </button>
        </div>
      )}
    </TacticalModalDialog>
  );
};

export default MissionCartridgeModal;
