import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, CheckCircle2, AlertTriangle, Key } from 'lucide-react';
import {
  CrewAgentState,
  SpriteVariant,
  SPRITE_VARIANT_LIST,
  SPRITE_VARIANTS,
  FunctionalCapabilityId,
  FUNCTIONAL_ROLE_LIST,
  FUNCTIONAL_ROLE_PROFILES,
} from '../context/CrewContext';
import { useTheme } from '../context/ThemeContext';
import { AgentSpriteFigure } from './SpriteCanvas';
import {
  SUPPORTED_VAULT_PROVIDERS,
  hasProviderApiKey,
  getProviderDisplayName,
} from '../services/BYOKVault';
import {
  AgentProvider,
  getAvailableAgentProvidersAndModels,
  AgentAvailableProviderMeta,
} from '../services/agentStore';

interface AgentEditorModalProps {
  agent: CrewAgentState | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: {
    customName: string;
    role: string;
    functionalRole: FunctionalCapabilityId;
    specialty: string;
    systemPrompt: string;
    assignedTools: string[];
    spriteVariant: SpriteVariant;
    provider?: AgentProvider;
    model?: string;
  }) => void;
  onClearMemory: () => void;
}

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
  {
    id: 'osint_maritime_tracker',
    label: 'Maritime AIS Tracking',
    description: 'Track real-time ship transits, chokepoint delays (Suez, Panama, Hormuz), and dark vessels.',
  },
  {
    id: 'osint_hazard_tracker',
    label: 'Global Hazards & USGS',
    description: 'Monitor real-time seismic events, tsunamis, volcanic eruptions, and disaster alerts.',
  },
  {
    id: 'osint_satellite_recon',
    label: 'NASA Satellite Recon',
    description: 'Pull high-resolution multispectral imagery snapshots (NASA GIBS & Copernicus Sentinel).',
  },
  {
    id: 'osint_spectrum_analyzer',
    label: 'Spectrum & GNSS Telemetry',
    description: 'Track GPS jamming/spoofing corridors and NOAA solar flare / geomagnetic storm levels.',
  },
];

export const AgentEditorModal: React.FC<AgentEditorModalProps> = ({
  agent,
  isOpen,
  onClose,
  onSave,
  onClearMemory,
}) => {
  const { themeId, playBeep } = useTheme();

  const [customName, setCustomName] = useState('');
  const [role, setRole] = useState('');
  const [functionalRole, setFunctionalRole] = useState<FunctionalCapabilityId>('general_assistant');
  const [specialty, setSpecialty] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [assignedTools, setAssignedTools] = useState<string[]>([]);
  const [spriteVariant, setSpriteVariant] = useState<SpriteVariant>('trenchcoat');
  const [provider, setProvider] = useState<AgentProvider>('gemini');
  const [model, setModel] = useState<string>('gemini-3.8-flash');
  const [activeTab, setActiveTab] = useState<'config' | 'memory'>('config');

  useEffect(() => {
    if (agent) {
      setCustomName(agent.customName || agent.defaultName);
      setFunctionalRole(agent.functionalRole || 'general_assistant');
      setRole(agent.role || '');
      setSpecialty(agent.specialty || '');
      setSystemPrompt(agent.systemPrompt || '');
      setAssignedTools(agent.assignedTools || []);
      setSpriteVariant(agent.spriteVariant || 'trenchcoat');
      setProvider((agent.provider as AgentProvider) || 'gemini');
      setModel(agent.model || 'gemini-3.8-flash');
      setActiveTab('config');
    }
  }, [agent, isOpen]);

  if (!isOpen || !agent) return null;

  const toggleTool = (toolId: string) => {
    playBeep('tap');
    setAssignedTools((prev) =>
      prev.includes(toolId) ? prev.filter((id) => id !== toolId) : [...prev, toolId]
    );
  };

  const handleApplyRolePreset = (profileId: FunctionalCapabilityId) => {
    playBeep('tap');
    const profile = FUNCTIONAL_ROLE_PROFILES[profileId];
    if (!profile) return;
    setFunctionalRole(profileId);
    setRole(profile.thematicRoleTitle);
    setSpecialty(profile.defaultSpecialty);
    setSystemPrompt(profile.defaultSystemPrompt);
    setAssignedTools(profile.recommendedTools);
  };

  const availableProviders = getAvailableAgentProvidersAndModels();
  const currentProviderMeta =
    availableProviders.find((p) => p.id === provider) || availableProviders[0];

  const handleSelectProvider = (newProvider: AgentProvider) => {
    playBeep('tap');
    setProvider(newProvider);
    const provMeta = availableProviders.find((p) => p.id === newProvider);
    setModel(provMeta?.defaultModel || 'openrouter/free');
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('complete');
    onSave({
      customName: customName.trim() || agent.defaultName,
      role: role.trim() || agent.role,
      functionalRole,
      specialty: specialty.trim() || agent.specialty,
      systemPrompt: systemPrompt.trim(),
      assignedTools,
      spriteVariant,
      provider,
      model,
    });
    onClose();
  };

  const hasVaultKey = currentProviderMeta.isConnected;
  const selectedProviderMeta = currentProviderMeta;
  const selectedSpriteMeta = SPRITE_VARIANTS[spriteVariant] || SPRITE_VARIANTS.trenchcoat;
  const selectedRoleMeta = FUNCTIONAL_ROLE_PROFILES[functionalRole] || FUNCTIONAL_ROLE_PROFILES.general_assistant;

  return (
    <AnimatePresence>
      <motion.div
        key="agent-editor-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-3 sm:p-4 overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 12 }}
          className="w-full max-w-2xl bg-[#121110] border-2 border-[#e59838] shadow-[0_0_30px_rgba(229,152,56,0.3)] overflow-hidden flex flex-col font-mono-tabular"
        >
          {/* Modal Header */}
          <div className="bg-[#241b12] border-b border-[#5e4326] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-10 bg-[#181512] border border-[#e59838] flex items-center justify-center p-0.5">
                <AgentSpriteFigure
                  spriteVariant={spriteVariant}
                  pose="stand"
                  walkFrame={1}
                  facing="right"
                  themeId={themeId}
                  alt={agent.customName}
                />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-[#e59838] tracking-wider uppercase flex items-center gap-2">
                  <span>[AGENT CONFIGURATION: {agent.customName}]</span>
                  <span
                    className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-black/60 border border-current"
                    style={{ color: selectedRoleMeta.accentHex }}
                  >
                    {selectedRoleMeta.iconTag}
                  </span>
                </h3>
                <p className="text-[11px] text-[#b8a690]">
                  Dual-Layer Architecture: Visual Asset & Codename ↔ Functional AI Persona & Tool Leashes
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                playBeep('tap');
                onClose();
              }}
              className="px-2.5 py-1 text-xs bg-[#1f1a14] text-[#c89d66] border border-[#785732] hover:text-white cursor-pointer"
            >
              [ESC]
            </button>
          </div>

          {/* Sub-tabs: Config vs Memory Ledger */}
          <div className="bg-[#181410] border-b border-[#3d2b18] px-4 py-1.5 flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setActiveTab('config');
                playBeep('tap');
              }}
              className={`px-3 py-1 border cursor-pointer transition-colors ${
                activeTab === 'config'
                  ? 'bg-[#e59838] text-[#121110] font-bold border-[#e59838]'
                  : 'bg-[#121110] text-[#c89d66] border-[#4a351d] hover:text-white'
              }`}
            >
              ⚙️ Persona, Prompts & Tools
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('memory');
                playBeep('tap');
              }}
              className={`px-3 py-1 border cursor-pointer transition-colors flex items-center gap-1.5 ${
                activeTab === 'memory'
                  ? 'bg-[#e59838] text-[#121110] font-bold border-[#e59838]'
                  : 'bg-[#121110] text-[#c89d66] border-[#4a351d] hover:text-white'
              }`}
            >
              <span>🧠 Independent Memory Log</span>
              <span className="px-1.5 py-0.2 bg-[#090807] text-[#4ade80] text-[10px] font-bold">
                {agent.memoryLog.length}
              </span>
            </button>
          </div>

          {/* Modal Body */}
          <form onSubmit={handleFormSubmit} className="p-4 sm:p-5 flex flex-col gap-4 max-h-[72vh] overflow-y-auto">
            {activeTab === 'config' ? (
              <>
                {/* 0. Operative AI Provider & Model Gateway Customization */}
                <div className="p-3 bg-[#110e0b] border border-[#785732] rounded-sm">
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                    <label className="text-[11px] text-[#e59838] uppercase font-bold flex items-center gap-1.5">
                      <Cpu size={14} className="text-[#e59838]" />
                      <span>◈ Assigned AI Provider & Model Gateway</span>
                    </label>
                    <span className="text-[10px] text-[#b8a690]">
                      Customize which LLM powers this operative on the fly
                    </span>
                  </div>

                  {/* Provider Selector Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                    {availableProviders.map((pMeta) => {
                      const isSelected = provider === pMeta.id;
                      return (
                        <button
                          key={pMeta.id}
                          type="button"
                          onClick={() => handleSelectProvider(pMeta.id)}
                          className={`p-2 border text-left cursor-pointer transition-all flex flex-col justify-between gap-1 rounded-xs ${
                            isSelected
                              ? 'bg-[#281a0e] border-[#e59838] text-white shadow-[0_0_10px_rgba(229,152,56,0.3)]'
                              : 'bg-[#18130e] border-[#4a351d] text-[#b8a690] hover:border-[#785732]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] font-bold">
                            <span className={isSelected ? 'text-[#e59838]' : 'text-[#f3ead8]'}>
                              {pMeta.name}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                pMeta.isConnected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-amber-400'
                              }`}
                              title={pMeta.isConnected ? 'Connected & Ready' : 'Key / Connection Required'}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-[#8c7a65] font-mono-tabular">
                            <span>{pMeta.badge}</span>
                            <span className={pMeta.isConnected ? 'text-emerald-400 font-semibold' : 'text-amber-400/80'}>
                              {pMeta.isConnected ? 'Active' : 'Unlinked'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Model Selector Dropdown & Key Status */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#3d2b18] items-center">
                    <div>
                      <label className="block text-[10px] text-[#9c8265] uppercase mb-1 font-semibold flex items-center justify-between">
                        <span>Model Architecture</span>
                        {provider === 'openrouter' && (
                          <span className="text-[9px] text-emerald-400 font-bold">12+ Free Models Available</span>
                        )}
                        {provider === 'puter' && (
                          <span className="text-[9px] text-emerald-400 font-bold">Zero-Key Access</span>
                        )}
                      </label>
                      <select
                        value={model}
                        onChange={(e) => {
                          playBeep('tap');
                          setModel(e.target.value);
                        }}
                        className="w-full px-2.5 py-1.5 bg-[#090807] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] text-xs font-mono-tabular outline-none cursor-pointer"
                      >
                        {selectedProviderMeta.availableModels.map((m) => (
                          <option key={m.id} value={m.id} className="bg-[#121110] text-[#f3ead8]">
                            {m.isFree ? `[FREE] ${m.name}` : m.name} {m.id === selectedProviderMeta.defaultModel ? '(Default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col justify-center">
                      <span className="text-[10px] text-[#9c8265] uppercase font-semibold mb-1">
                        Credentials Status
                      </span>
                      {hasVaultKey ? (
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono-tabular bg-emerald-950/30 border border-emerald-800/40 px-2 py-1 rounded-xs">
                          <CheckCircle2 size={13} className="shrink-0" />
                          <span className="truncate">
                            {provider === 'puter'
                              ? 'Puter Zero-Key Active'
                              : provider === 'openrouter'
                              ? 'OpenRouter SSO Linked (300+ models)'
                              : `Key linked (${selectedProviderMeta.storageKey})`}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-mono-tabular bg-amber-950/40 border border-amber-800/60 px-2 py-1 rounded-xs">
                          <AlertTriangle size={13} className="shrink-0" />
                          <span className="truncate">
                            {provider === 'openrouter'
                              ? 'OpenRouter unlinked. Connect in Settings [⚙️].'
                              : `No key in Vault! Configure in Settings [⚙️].`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 1. Functional AI Capability / Role Preset Selector */}
                <div className="p-3 bg-[#0a0d13] border border-[#2b3a4a] rounded-sm">
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-2">
                    <label className="text-[11px] text-[#38bdf8] uppercase font-bold flex items-center gap-1.5">
                      <span>◈ Select Functional AI Role & Capability Profile</span>
                    </label>
                    <span className="text-[10px] text-[#94a3b8]">
                      Clicking a profile automatically updates role title, system prompt & tool leash
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    {FUNCTIONAL_ROLE_LIST.map((prof) => {
                      const isSelected = functionalRole === prof.id;
                      return (
                        <button
                          key={prof.id}
                          type="button"
                          onClick={() => handleApplyRolePreset(prof.id)}
                          className={`p-2 border text-left cursor-pointer transition-colors flex flex-col justify-between gap-1 ${
                            isSelected
                              ? 'bg-[#112338] border-[#38bdf8] text-white shadow-[0_0_8px_rgba(56,189,248,0.25)]'
                              : 'bg-[#0b1017] border-[#1e2a38] text-[#94a3b8] hover:border-[#38bdf8]/50'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[9px] font-bold">
                            <span style={{ color: prof.accentHex }}>{prof.iconTag}</span>
                            <span className="text-[8px] text-[#64748b]">[{prof.categoryBadge.slice(0, 4)}]</span>
                          </div>
                          <div className="text-[10px] font-semibold text-[#f3ead8] leading-tight line-clamp-1">
                            {prof.label.split('/')[0]}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-[#94a3b8] flex items-center gap-1.5 border-t border-[#1e2a38] pt-1.5">
                    <span className="text-[#38bdf8] font-bold">ACTIVE ROLE:</span>
                    <span className="text-[#f3ead8]">{selectedRoleMeta.label}</span>
                    <span className="text-[#38bdf8]">({selectedRoleMeta.displayBridge})</span>
                  </div>
                </div>

                {/* 2. Visual Layer & Display Title */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="agent-editor-codename" className="block text-[11px] text-[#9c8265] uppercase mb-1 font-semibold cursor-pointer">
                      Operative Codename
                    </label>
                    <input
                      id="agent-editor-codename"
                      name="agent_codename"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      maxLength={24}
                      autoComplete="off"
                      className="w-full px-3 py-1.5 bg-[#0a0908] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] text-xs font-bold outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="agent-editor-role" className="block text-[11px] text-[#9c8265] uppercase mb-1 font-semibold cursor-pointer">
                      Displayed Thematic Role
                    </label>
                    <input
                      id="agent-editor-role"
                      name="agent_role"
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      maxLength={65}
                      placeholder="e.g. Code-Ops Specialist [Software Engineering Module]"
                      autoComplete="off"
                      className="w-full px-3 py-1.5 bg-[#0a0908] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] text-xs outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="agent-editor-specialty" className="block text-[11px] text-[#9c8265] uppercase mb-1 font-semibold cursor-pointer">
                    Core Technical Specialty
                  </label>
                  <input
                    id="agent-editor-specialty"
                    name="agent_specialty"
                    type="text"
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    maxLength={80}
                    autoComplete="off"
                    className="w-full px-3 py-1.5 bg-[#0a0908] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] text-xs outline-none"
                  />
                </div>

                {/* 3. Visual Pixel Sprite Design Picker */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] text-[#9c8265] uppercase font-semibold">
                      Visual Pixel Sprite Design ({selectedSpriteMeta.label})
                    </label>
                    <span
                      className="text-[10px] font-bold"
                      style={{ color: selectedSpriteMeta.accentHex }}
                    >
                      [{selectedSpriteMeta.shortTag} · {selectedSpriteMeta.gearOverlayLabel}]
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 max-h-40 overflow-y-auto p-1.5 bg-[#0a0908] border border-[#3d2b18]">
                    {SPRITE_VARIANT_LIST.map((v) => {
                      const isCurrent = spriteVariant === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSpriteVariant(v.id);
                            playBeep('tap');
                          }}
                          className={`p-1.5 border flex flex-col items-center gap-1 cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-[#261d12] border-[#e59838] text-white'
                              : 'bg-[#12100e] border-[#2e2113] text-[#9c8265] hover:border-[#6e5233]'
                          }`}
                          title={`${v.label} — ${v.description}`}
                        >
                          <div className="w-7 h-9 flex items-center justify-center">
                            <div className="w-6">
                              <AgentSpriteFigure
                                spriteVariant={v.id}
                                pose="stand"
                                walkFrame={1}
                                facing="right"
                                themeId={themeId}
                                alt={v.label}
                              />
                            </div>
                          </div>
                          <span
                            className="text-[8px] font-bold uppercase truncate max-w-full"
                            style={{ color: isCurrent ? v.accentHex : '#c89d66' }}
                          >
                            {v.shortTag}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Customizable System Prompt */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] text-[#9c8265] uppercase font-semibold">
                      Custom System Prompt & Behavioral Instructions
                    </label>
                    <span className="text-[10px] text-[#8c7a65]">
                      Injected dynamically into Gemini API payload
                    </span>
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={4}
                    placeholder="Enter custom instructions defining their expertise, persona, and analytical behavior..."
                    className="w-full px-3 py-2 bg-[#0a0908] border border-[#5e4326] focus:border-[#e59838] text-[#f3ead8] text-xs leading-relaxed outline-none resize-y"
                  />
                </div>

                {/* 5. Tool Leashes & Function Permissions */}
                <div>
                  <label className="block text-[11px] text-[#9c8265] uppercase mb-2 font-semibold">
                    Assigned Tool Leashes & Function Permissions ({assignedTools.length}/{AVAILABLE_TOOLS_CATALOG.length})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {AVAILABLE_TOOLS_CATALOG.map((tool) => {
                      const isChecked = assignedTools.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => toggleTool(tool.id)}
                          className={`p-2.5 border text-left cursor-pointer transition-colors flex items-start gap-2.5 ${
                            isChecked
                              ? 'bg-[#1b241c] border-[#4ade80] text-[#f3ead8]'
                              : 'bg-[#0d0c0b] border-[#382917] text-[#8c7a65] hover:text-[#c89d66]'
                          }`}
                        >
                          <div
                            className={`w-4 h-4 mt-0.5 shrink-0 border flex items-center justify-center font-bold text-[10px] ${
                              isChecked
                                ? 'bg-[#4ade80] border-[#4ade80] text-[#0c1017]'
                                : 'bg-[#14110e] border-[#5e4326] text-transparent'
                            }`}
                          >
                            {isChecked ? '✓' : ''}
                          </div>
                          <div className="min-w-0">
                            <div className={`text-xs font-bold ${isChecked ? 'text-[#4ade80]' : 'text-[#d0c5b0]'}`}>
                              {tool.label}
                            </div>
                            <div className="text-[10px] text-[#9c8265] truncate mt-0.5">
                              {tool.description}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-[#e59838] uppercase">
                      Independent Local Memory Ledger ({agent.memoryLog.length})
                    </h4>
                    <p className="text-[11px] text-[#b8a690]">
                      Records past tasks completed by {agent.customName}. Referenced during follow-up directives.
                    </p>
                  </div>
                  {agent.memoryLog.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('error');
                        onClearMemory();
                      }}
                      className="px-2.5 py-1 bg-[#261515] text-[#f43f5e] border border-[#882b3d] hover:bg-[#381a1a] text-xs cursor-pointer"
                    >
                      [Clear Memory Log]
                    </button>
                  )}
                </div>

                {agent.memoryLog.length === 0 ? (
                  <div className="p-8 text-center bg-[#0d0c0b] border border-[#382917] text-xs text-[#8c7a65]">
                    No past tasks recorded in {agent.customName}&apos;s independent memory ledger yet. Dispatch a directive to populate memory!
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
                    {agent.memoryLog.map((mem) => (
                      <div
                        key={mem.id}
                        className="p-3 bg-[#0d0c0b] border border-[#382917] flex flex-col gap-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10px] text-[#9c8265]">
                          <span>TIMESTAMP: {new Date(mem.timestamp).toLocaleTimeString()}</span>
                          <span className="text-[#4ade80]">ID: {mem.id.slice(0, 8)}</span>
                        </div>
                        <div className="text-[#f3ead8] font-bold">
                          &ldquo;{mem.prompt}&rdquo;
                        </div>
                        <div className="text-[#b8a690] text-[11px] bg-[#14110e] p-2 border border-[#2b2015] leading-relaxed">
                          {mem.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Footer Buttons */}
            <div className="pt-3 border-t border-[#3d2b18] flex items-center justify-end gap-2.5 mt-2">
              <button
                type="button"
                onClick={() => {
                  playBeep('tap');
                  onClose();
                }}
                className="px-4 py-1.5 bg-[#1f1a14] text-[#c89d66] border border-[#785732] hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-1.5 bg-[#e59838] text-[#121110] font-bold border border-[#e59838] hover:bg-[#f6a848] text-xs cursor-pointer shadow-[0_0_12px_rgba(229,152,56,0.4)]"
              >
                [SAVE AGENT CONFIG]
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
