import React, { useState } from 'react';
import { X, UserPlus, Shield, Terminal, MapPin, Wrench, Cpu } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  SPRITE_VARIANT_LIST,
  SPRITE_VARIANTS,
  SpriteVariant,
  SpriteVariantCategory,
  FunctionalCapabilityId,
  FUNCTIONAL_ROLE_LIST,
  FUNCTIONAL_ROLE_PROFILES,
} from '../context/CrewContext';
import { RoomId, ROOM_ORDER, ROOM_METADATA, AgentSpriteFigure } from './SpriteCanvas';
import { SUPPORTED_VAULT_PROVIDERS } from '../services/BYOKVault';
import { AgentProvider } from '../services/agentStore';

const SPRITE_CATEGORIES: Array<'All' | SpriteVariantCategory> = [
  'All',
  'Field & Infiltration',
  'Tech-Ops & Cyber',
  'Intel & Recon',
  'Tactical & Heavy',
];

const AVAILABLE_TOOLS_CATALOG: Array<{ id: string; label: string; description: string }> = [
  {
    id: 'live_web_search',
    label: 'Live Web Search',
    description: 'Query live web search indexes via Jina Reader, financial oracles, and GitHub.',
  },
  {
    id: 'weather_lookup',
    label: 'Weather Telemetry',
    description: 'Fetch live Open-Meteo atmospheric conditions and temperatures for any location.',
  },
  {
    id: 'calendar_schedule_event',
    label: 'Calendar Scheduling',
    description: 'Book tactical briefings, operational windows, and meetings on Google Calendar.',
  },
  {
    id: 'slack_post_dispatch',
    label: 'Slack Dispatch',
    description: 'Broadcast priority dispatches and alerts to channels on Slack.',
  },
  {
    id: 'github_create_issue',
    label: 'GitHub Engineering',
    description: 'Inspect live repositories and open audit/patch issues on GitHub.',
  },
  {
    id: 'vault_query_intel',
    label: 'Encrypted Dossier Vault',
    description: 'Query classified local archives and mission lore telemetry records.',
  },
];

interface AgentFactoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecruit: (payload: {
    customName: string;
    role: string;
    functionalRole?: FunctionalCapabilityId;
    specialty: string;
    systemPrompt: string;
    spriteVariant: SpriteVariant;
    currentRoom: RoomId;
    assignedTools?: string[];
    provider?: AgentProvider;
    model?: string;
  }) => void;
}

export const AgentFactoryModal: React.FC<AgentFactoryModalProps> = ({
  isOpen,
  onClose,
  onRecruit,
}) => {
  const { themeId, playBeep } = useTheme();
  const [customName, setCustomName] = useState('Agent CipherX');
  const [functionalRole, setFunctionalRole] = useState<FunctionalCapabilityId>('coder');
  const [role, setRole] = useState(FUNCTIONAL_ROLE_PROFILES.coder.thematicRoleTitle);
  const [specialty, setSpecialty] = useState(FUNCTIONAL_ROLE_PROFILES.coder.defaultSpecialty);
  const [systemPrompt, setSystemPrompt] = useState(FUNCTIONAL_ROLE_PROFILES.coder.defaultSystemPrompt);
  const [assignedTools, setAssignedTools] = useState<string[]>(FUNCTIONAL_ROLE_PROFILES.coder.recommendedTools);
  const [spriteVariant, setSpriteVariant] = useState<SpriteVariant>('exo_hacker');
  const [selectedCategory, setSelectedCategory] = useState<'All' | SpriteVariantCategory>('All');
  const [currentRoom, setCurrentRoom] = useState<RoomId>('comms_tower');
  const [provider, setProvider] = useState<AgentProvider>('gemini');
  const [model, setModel] = useState<string>('gemini-3.8-flash');

  if (!isOpen) return null;

  const filteredVariants =
    selectedCategory === 'All'
      ? SPRITE_VARIANT_LIST
      : SPRITE_VARIANT_LIST.filter((v) => v.category === selectedCategory);

  const selectedMeta = SPRITE_VARIANTS[spriteVariant] || SPRITE_VARIANTS.trenchcoat;
  const selectedRoleMeta = FUNCTIONAL_ROLE_PROFILES[functionalRole] || FUNCTIONAL_ROLE_PROFILES.coder;
  const selectedProviderMeta = SUPPORTED_VAULT_PROVIDERS[provider] || SUPPORTED_VAULT_PROVIDERS.gemini;

  const handleSelectRolePreset = (pId: FunctionalCapabilityId) => {
    playBeep('tap');
    const p = FUNCTIONAL_ROLE_PROFILES[pId];
    if (!p) return;
    setFunctionalRole(pId);
    setRole(p.thematicRoleTitle);
    setSpecialty(p.defaultSpecialty);
    setSystemPrompt(p.defaultSystemPrompt);
    setAssignedTools(p.recommendedTools);
  };

  const handleSelectProvider = (pId: AgentProvider) => {
    playBeep('tap');
    setProvider(pId);
    const meta = SUPPORTED_VAULT_PROVIDERS[pId];
    setModel(meta?.defaultModel || 'gemini-3.8-flash');
  };

  const toggleTool = (toolId: string) => {
    playBeep('tap');
    setAssignedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !role.trim()) return;

    playBeep('complete');
    onRecruit({
      customName: customName.trim(),
      role: role.trim(),
      functionalRole,
      specialty: specialty.trim() || selectedRoleMeta.defaultSpecialty,
      systemPrompt: systemPrompt.trim() || selectedRoleMeta.defaultSystemPrompt,
      spriteVariant,
      currentRoom,
      assignedTools,
      provider,
      model,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto font-mono">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0d1117] border border-amber-500/40 p-5 sm:p-6 shadow-[0_0_30px_rgba(229,152,56,0.15)] flex flex-col gap-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-amber-500/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-950/80 border border-amber-500/50 text-amber-400">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-amber-300 tracking-wider">
                AGENT RECRUITMENT FACTORY
              </h2>
              <p className="text-xs text-amber-500/80">
                Dual-Layer Setup: Pair functional AI personas with custom 16-bit covert agent attire
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-amber-400 hover:text-amber-200 hover:bg-amber-950/50 cursor-pointer transition-colors"
            aria-label="Close recruitment modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-xs">
          {/* 1. Functional AI Role Preset Selector */}
          <div className="p-3 bg-[#0a0d13] border border-cyan-500/40 rounded-xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                <span>◈ Step 1: Select Functional AI Persona Profile</span>
              </span>
              <span className="text-[10px] text-cyan-400/80">Dictates core system instructions & capabilities</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {FUNCTIONAL_ROLE_LIST.map((prof) => {
                const isSelected = functionalRole === prof.id;
                return (
                  <button
                    key={prof.id}
                    type="button"
                    onClick={() => handleSelectRolePreset(prof.id)}
                    className={`p-2 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between gap-1 ${
                      isSelected
                        ? 'bg-cyan-950/70 border-cyan-400 text-white shadow-[0_0_10px_rgba(56,189,248,0.3)]'
                        : 'bg-[#0b1017] border-cyan-500/20 text-slate-400 hover:border-cyan-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[9px] font-bold">
                      <span style={{ color: prof.accentHex }}>{prof.iconTag}</span>
                    </div>
                    <div className="text-[10px] font-semibold text-slate-200 leading-tight">
                      {prof.label.split('/')[0]}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-slate-300 mt-0.5 flex flex-wrap items-center gap-1.5 border-t border-cyan-500/20 pt-1.5">
              <span className="text-cyan-400 font-bold">PROFILE:</span>
              <span className="text-amber-200">{selectedRoleMeta.label}</span>
              <span className="text-cyan-400">({selectedRoleMeta.displayBridge})</span>
            </div>
          </div>

          {/* 2. Custom Name & Thematic Role */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="agent-factory-name" className="font-bold text-amber-200 flex items-center gap-1.5">
              <span>Operative Codename</span>
            </label>
            <input
              id="agent-factory-name"
              type="text"
              required
              maxLength={28}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#090d12] border border-amber-500/30 text-amber-100 font-mono focus:border-amber-400 outline-none"
              placeholder="e.g. Agent CipherX"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="agent-factory-role" className="font-bold text-amber-200">
                Displayed Thematic Role
              </label>
              <input
                id="agent-factory-role"
                type="text"
                required
                maxLength={65}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#090d12] border border-amber-500/30 text-amber-100 font-mono focus:border-amber-400 outline-none"
                placeholder="e.g. Code-Ops Specialist [Software Engineering Module]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="agent-factory-specialty" className="font-bold text-amber-200">
                Core Specialty
              </label>
              <input
                id="agent-factory-specialty"
                type="text"
                required
                maxLength={80}
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#090d12] border border-amber-500/30 text-amber-100 font-mono focus:border-amber-400 outline-none"
                placeholder="e.g. Full-Stack Architecture & Debugging"
              />
            </div>
          </div>

          {/* AI Model & Provider Engine */}
          <div className="p-3 rounded-xl bg-[#090d12] border border-amber-500/30 flex flex-col gap-2">
            <span className="font-bold text-amber-200 flex items-center gap-1.5 text-xs">
              <Cpu className="w-3.5 h-3.5 text-amber-400" />
              <span>◈ AI Model & Provider Gateway</span>
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.keys(SUPPORTED_VAULT_PROVIDERS) as AgentProvider[]).map((pId) => {
                const meta = SUPPORTED_VAULT_PROVIDERS[pId];
                const isSelected = provider === pId;
                return (
                  <button
                    key={pId}
                    type="button"
                    onClick={() => handleSelectProvider(pId)}
                    className={`p-2 rounded-lg border text-left cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-400 text-amber-100 font-bold'
                        : 'bg-[#111722] border-amber-500/20 text-amber-300/70 hover:border-amber-400/50'
                    }`}
                  >
                    <div className="text-[11px]">{meta.name.split(' ')[0]}</div>
                    <div className="text-[9px] text-amber-400/80">{meta.badge}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-amber-500/20">
              <span className="text-[10px] text-amber-300/80 uppercase font-semibold">Model:</span>
              <select
                value={model}
                onChange={(e) => {
                  playBeep('tap');
                  setModel(e.target.value);
                }}
                className="flex-1 px-2 py-1 rounded bg-[#111722] border border-amber-500/30 text-amber-100 text-xs font-mono outline-none cursor-pointer"
              >
                {selectedProviderMeta.availableModels.map((m) => (
                  <option key={m} value={m} className="bg-[#111722] text-amber-100">
                    {m} {m === selectedProviderMeta.defaultModel ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Sprite Variant Selection (Visual Layer) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-amber-200 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>◈ Step 2: Choose 16-Bit Pixel Sprite Attire ({SPRITE_VARIANT_LIST.length} Variants)</span>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {SPRITE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      setSelectedCategory(cat);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer transition-colors ${
                      selectedCategory === cat
                        ? 'bg-amber-500 text-black border-amber-400 font-bold'
                        : 'bg-[#090d12] text-amber-300/80 border-amber-500/30 hover:border-amber-400'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Active Selected Sprite Preview Strip */}
            <div className="p-2.5 rounded-xl bg-[#111722] border border-amber-500/30 flex items-center gap-3">
              <div className="w-12 h-14 shrink-0 rounded-lg bg-[#090d12] border border-amber-500/40 flex items-center justify-center p-1">
                <div className="w-8">
                  <AgentSpriteFigure
                    spriteVariant={spriteVariant}
                    pose="stand"
                    walkFrame={1}
                    facing="right"
                    themeId={themeId}
                    alt={selectedMeta.label}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-amber-200 text-xs">{selectedMeta.label}</span>
                  <span
                    className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-black/60 border border-current/40"
                    style={{ color: selectedMeta.accentHex }}
                  >
                    {selectedMeta.shortTag} · {selectedMeta.category}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5">{selectedMeta.description}</p>
                <p className="text-[10px] mt-0.5" style={{ color: selectedMeta.accentHex }}>
                  Gear Loadout: {selectedMeta.gearOverlayLabel}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
              {filteredVariants.map((meta) => {
                const isSelected = spriteVariant === meta.id;
                return (
                  <button
                    key={meta.id}
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      setSpriteVariant(meta.id);
                    }}
                    className={`p-2 rounded-xl border flex flex-col items-center text-center gap-1 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-950/60 border-amber-400 shadow-[0_0_10px_rgba(229,152,56,0.3)]'
                        : 'bg-[#090d12] border-amber-500/20 hover:border-amber-500/50'
                    }`}
                  >
                    <div className="w-9 h-11 flex items-center justify-center">
                      <div className="w-7">
                        <AgentSpriteFigure
                          spriteVariant={meta.id}
                          pose="stand"
                          walkFrame={1}
                          facing="right"
                          themeId={themeId}
                          alt={meta.label}
                        />
                      </div>
                    </div>
                    <span className="font-bold text-amber-200 text-[10px] leading-tight line-clamp-1">
                      {meta.label}
                    </span>
                    <span
                      className="text-[9px] font-semibold truncate max-w-full"
                      style={{ color: meta.accentHex }}
                    >
                      [{meta.shortTag}]
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Initial Room Station Assignment */}
          <div className="flex flex-col gap-2">
            <span className="font-bold text-amber-200 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span>Initial Room Station Assignment</span>
            </span>
            <select
              value={currentRoom}
              onChange={(e) => {
                playBeep('tap');
                setCurrentRoom(e.target.value as RoomId);
              }}
              className="px-3 py-2 rounded-xl bg-[#090d12] border border-amber-500/30 text-amber-100 font-mono focus:border-amber-400 outline-none cursor-pointer"
            >
              {ROOM_ORDER.map((roomId) => (
                <option key={roomId} value={roomId}>
                  {ROOM_METADATA[roomId]?.shortBadge || roomId} — {ROOM_METADATA[roomId]?.sectorCode || roomId}
                </option>
              ))}
            </select>
          </div>

          {/* 5. Tool Permissions & Function Calling Leashes */}
          <div className="flex flex-col gap-2">
            <span className="font-bold text-amber-200 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-amber-400" />
              <span>Tool Leashes & Permissions ({assignedTools.length}/{AVAILABLE_TOOLS_CATALOG.length})</span>
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AVAILABLE_TOOLS_CATALOG.map((tool) => {
                const isChecked = assignedTools.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    className={`p-2 rounded-xl border text-left cursor-pointer transition-colors flex items-start gap-2 ${
                      isChecked
                        ? 'bg-emerald-950/40 border-emerald-500/80 text-emerald-200'
                        : 'bg-[#090d12] border-amber-500/20 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 mt-0.5 shrink-0 rounded border flex items-center justify-center font-bold text-[9px] ${
                        isChecked
                          ? 'bg-emerald-500 border-emerald-400 text-black'
                          : 'bg-black/60 border-slate-600 text-transparent'
                      }`}
                    >
                      ✓
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-200">{tool.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">{tool.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 6. System Instructions / System Prompt */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="agent-factory-prompt" className="font-bold text-amber-200 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>Custom System Prompt & Behavioral Directives</span>
            </label>
            <textarea
              id="agent-factory-prompt"
              rows={3}
              required
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#090d12] border border-amber-500/30 text-amber-100 font-mono text-[11px] focus:border-amber-400 outline-none resize-none leading-relaxed"
              placeholder="Enter behavioral instructions for this AI operative..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-amber-500/30">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-bold cursor-pointer transition-colors"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-amber-500 text-black hover:bg-amber-400 text-xs font-bold transition-colors cursor-pointer shadow-[0_0_15px_rgba(229,152,56,0.4)]"
            >
              RECRUIT OPERATIVE
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
