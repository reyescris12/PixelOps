import React, { useState, useEffect } from 'react';
import {
  X,
  Volume2,
  VolumeX,
  RefreshCw,
  ShieldCheck,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Cpu,
  FileText,
  BookOpen,
  Key,
  Eye,
  EyeOff,
  Zap,
  Sparkles,
  Globe,
  Crosshair,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { CommandPreferences } from '../services/ApiService';
import {
  getOsintKey,
  setOsintKey,
  OSINT_KEYS_STORAGE,
} from '../services/OsintToolsService';
import {
  VaultStartupReport,
  ServiceProviderName,
  refreshOAuthProviderToken,
} from '../services/SecureVaultService';
import {
  ambientAudioService,
  ROOM_SOUNDSCAPE_PROFILES,
} from '../services/AmbientAudioService';
import { ROOM_ORDER, ROOM_METADATA, RoomId } from './SpriteCanvas';
import { GuardrailsModal } from './GuardrailsModal';
import { ThemeSettings } from './ThemeSettings';
import {
  LLMProviderConfig,
  LLMProviderType,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  testLLMProviderConnection,
} from '../services/LLMProviderService';
import {
  getBYOKVaultSnapshot,
  saveBYOKVaultEntry,
  testBYOKConnection,
  setActiveVaultProvider,
  SUPPORTED_VAULT_PROVIDERS,
} from '../services/BYOKVault';
import {
  signInWithPuter,
  signOutPuter,
  isPuterSignedIn,
  getPuterUser,
  isPuterActive,
  setPuterActive,
  callPuterModel,
} from '../services/PuterAuth';
import {
  startOpenRouterOAuth,
  getOpenRouterKey,
  setOpenRouterKey,
  isOpenRouterConnected,
  isOpenRouterActive,
  setOpenRouterActive,
  getOpenRouterSelectedModel,
  setOpenRouterSelectedModel,
  disconnectOpenRouter,
  testOpenRouterConnection,
  OPENROUTER_SUPPORTED_MODELS,
  OPENROUTER_FREE_MODELS,
  OPENROUTER_FLAGSHIP_MODELS,
} from '../services/OpenRouterAuth';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: CommandPreferences;
  onUpdatePreferences: (prefs: CommandPreferences) => void;
  serverReady: boolean;
  vaultReport: VaultStartupReport | null;
  onRevalidateVault: () => Promise<void>;
  currentRoom?: RoomId;
  onSelectRoom?: (room: RoomId) => void;
  onOpenWorkspaceFiles?: () => void;
  onOpenSyncModal?: () => void;
  onOpenPluginAuth?: (plugin: { id: string; name: string }) => void;
  onOpenFieldManual?: () => void;
  onOpenFeedback?: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  calendar: 'Google Calendar OAuth',
  slack: 'Slack Dispatch OAuth',
  github: 'GitHub Repo OAuth',
  vault: 'Dossier Vault Key',
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onUpdatePreferences,
  serverReady,
  vaultReport,
  onRevalidateVault,
  currentRoom = 'war_room',
  onSelectRoom,
  onOpenWorkspaceFiles,
  onOpenSyncModal,
  onOpenPluginAuth,
  onOpenFieldManual,
  onOpenFeedback,
}) => {
  const { theme, soundEnabled, setSoundEnabled, playBeep } = useTheme();
  const [pingStatus, setPingStatus] = useState<{
    loading: boolean;
    message: string | null;
    ok?: boolean;
  }>({ loading: false, message: null });
  const [rotatingProvider, setRotatingProvider] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [ambientState, setAmbientState] = useState(() =>
    ambientAudioService.getState()
  );

  // Model-Agnostic LLM Provider State (Pure BYOK)
  const [llmConfig, setLlmConfig] = useState<LLMProviderConfig>(() => {
    const loaded = loadLLMProviderConfig();
    return { ...loaded, authMode: 'apikey' as const };
  });
  const [isGuardrailsOpen, setIsGuardrailsOpen] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    message?: string;
  }>({ loading: false });

  // Multi-Provider BYOK Vault State
  const [vaultEntries, setVaultEntries] = useState(() => getBYOKVaultSnapshot());
  const [vaultTestStatus, setVaultTestStatus] = useState<
    Record<string, { loading?: boolean; ok?: boolean; message?: string }>
  >({});
  const [revealedVaultKeys, setRevealedVaultKeys] = useState<Record<string, boolean>>({});

  // SSO States: Puter.js & OpenRouter PKCE
  const [puterSignedIn, setPuterSignedIn] = useState(false);
  const [puterUsername, setPuterUsername] = useState(() => {
    try {
      return localStorage.getItem('pixelops_puter_username') || '';
    } catch {
      return '';
    }
  });
  const [isSigningInPuter, setIsSigningInPuter] = useState(false);

  const [openRouterKey, setOpenRouterKeyState] = useState(() => getOpenRouterKey());
  const [openRouterModel, setOpenRouterModelState] = useState(() => getOpenRouterSelectedModel());
  const [isConnectingOpenRouter, setIsConnectingOpenRouter] = useState(false);
  const [customOpenRouterKeyInput, setCustomOpenRouterKeyInput] = useState('');
  const [showManualOpenRouterInput, setShowManualOpenRouterInput] = useState(false);

  const [aiSsoMode, setAiSsoMode] = useState<string | null>(() => {
    try {
      return localStorage.getItem('pixelops_ai_sso_mode');
    } catch {
      return null;
    }
  });

  // OSINT & Adversarial Toolkit BYOK Keys
  const [osintKeys, setOsintKeys] = useState(() => ({
    shodan: getOsintKey('SHODAN'),
    abuseipdb: getOsintKey('ABUSEIPDB'),
    virustotal: getOsintKey('VIRUSTOTAL'),
    otx: getOsintKey('OTX'),
    ipinfo: getOsintKey('IPINFO'),
    github: getOsintKey('GITHUB'),
  }));
  const [showOsintSection, setShowOsintSection] = useState(false);
  const [ssoTestStatus, setSsoTestStatus] = useState<
    Record<string, { loading?: boolean; ok?: boolean; message?: string } | undefined>
  >({});

  useEffect(() => {
    const checkSso = async () => {
      try {
        const signedIn = await isPuterSignedIn();
        setPuterSignedIn(signedIn);
        if (signedIn) {
          const user = await getPuterUser();
          if (user?.username) setPuterUsername(user.username);
        }
      } catch {}
      setOpenRouterKeyState(getOpenRouterKey());
      setOpenRouterModelState(getOpenRouterSelectedModel());
      setAiSsoMode(localStorage.getItem('pixelops_ai_sso_mode'));
    };

    checkSso();

    const handler = () => {
      checkSso();
    };
    window.addEventListener('pixelops:ai-sso-changed', handler);
    return () => window.removeEventListener('pixelops:ai-sso-changed', handler);
  }, [isOpen]);

  const handleUpdateVaultKey = (
    provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
    key: string
  ) => {
    const cleanKey = key.trim();
    setVaultEntries((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], apiKey: cleanKey },
    }));
    saveBYOKVaultEntry(provider, cleanKey, vaultEntries[provider]?.selectedModel);
    setLlmConfig((prev) => {
      const isCurrent = provider === prev.providerId;
      const updated = {
        ...prev,
        authMode: 'apikey' as const,
        apiKey: isCurrent ? cleanKey : prev.apiKey || (provider === 'gemini' ? cleanKey : prev.apiKey),
      };
      saveLLMProviderConfig(updated);
      return updated;
    });
  };

  const handleSelectVaultModel = (
    provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
    model: string
  ) => {
    playBeep('tap');
    setVaultEntries((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], selectedModel: model },
    }));
    saveBYOKVaultEntry(provider, vaultEntries[provider]?.apiKey || '', model);
    if (provider === llmConfig.providerId) {
      setLlmConfig((prev) => ({ ...prev, modelName: model }));
    }
  };

  const handleTestVaultProvider = async (
    provider: 'gemini' | 'anthropic' | 'openai' | 'groq'
  ) => {
    setVaultTestStatus((prev) => ({ ...prev, [provider]: { loading: true } }));
    playBeep('tap');
    try {
      const res = await testBYOKConnection(
        provider,
        vaultEntries[provider]?.apiKey,
        vaultEntries[provider]?.selectedModel
      );
      setVaultTestStatus((prev) => ({
        ...prev,
        [provider]: { loading: false, ok: res.ok, message: res.message },
      }));
      playBeep(res.ok ? 'complete' : 'error');
    } catch (err: any) {
      setVaultTestStatus((prev) => ({
        ...prev,
        [provider]: { loading: false, ok: false, message: err?.message || 'Connection test failed' },
      }));
      playBeep('error');
    }
  };

  const handleActivateVaultProvider = (
    provider: 'gemini' | 'anthropic' | 'openai' | 'groq'
  ) => {
    playBeep('tap');
    try {
      localStorage.removeItem('pixelops_ai_sso_mode');
    } catch {}
    setAiSsoMode(null);
    setActiveVaultProvider(provider, vaultEntries[provider]?.selectedModel);
    const updated = loadLLMProviderConfig();
    setLlmConfig(updated);
    setLlmTestStatus({
      loading: false,
      ok: true,
      message: `Active engine switched to ${provider.toUpperCase()} (${vaultEntries[provider]?.selectedModel}).`,
    });
  };

  const handlePuterSignIn = async () => {
    setIsSigningInPuter(true);
    setSsoTestStatus((prev) => ({ ...prev, puter: { loading: true, message: 'Opening Puter 1-Click Zero-Key SSO...' } }));
    playBeep('tap');
    try {
      const res = await signInWithPuter();
      if (res.ok) {
        setPuterSignedIn(true);
        if (res.user?.username) setPuterUsername(res.user.username);
        setAiSsoMode('puter');
        setSsoTestStatus((prev) => ({
          ...prev,
          puter: { loading: false, ok: true, message: `Connected as @${res.user?.username || 'PuterUser'}! Zero-key AI ready.` },
        }));
        playBeep('complete');
      } else {
        setSsoTestStatus((prev) => ({
          ...prev,
          puter: { loading: false, ok: false, message: res.error || 'Sign in cancelled.' },
        }));
        playBeep('error');
      }
    } catch (err: any) {
      setSsoTestStatus((prev) => ({
        ...prev,
        puter: { loading: false, ok: false, message: err?.message || 'Puter sign in failed.' },
      }));
      playBeep('error');
    } finally {
      setIsSigningInPuter(false);
    }
  };

  const handlePuterSignOut = async () => {
    playBeep('tap');
    await signOutPuter();
    setPuterSignedIn(false);
    setPuterUsername('');
    setAiSsoMode(localStorage.getItem('pixelops_ai_sso_mode'));
    setSsoTestStatus((prev) => ({ ...prev, puter: undefined }));
  };

  const handleSetPuterActive = () => {
    playBeep('tap');
    setPuterActive(true);
    setAiSsoMode('puter');
    setSsoTestStatus((prev) => ({
      ...prev,
      puter: { ok: true, message: 'Puter.js zero-key AI is now the active engine!' },
    }));
  };

  const handleTestPuter = async () => {
    setSsoTestStatus((prev) => ({ ...prev, puter: { loading: true } }));
    playBeep('tap');
    try {
      const reply = await callPuterModel(
        'google/gemini-2.5-flash',
        'Respond with a 6-word tactical readiness confirmation.',
        [{ role: 'user', content: 'Ping' }]
      );
      setSsoTestStatus((prev) => ({
        ...prev,
        puter: { loading: false, ok: true, message: reply || 'Puter.js zero-key link verified.' },
      }));
      playBeep('complete');
    } catch (err: any) {
      setSsoTestStatus((prev) => ({
        ...prev,
        puter: { loading: false, ok: false, message: err?.message || 'Puter connection test failed' },
      }));
      playBeep('error');
    }
  };

  const handleOpenRouterConnect = async () => {
    setIsConnectingOpenRouter(true);
    playBeep('tap');
    try {
      await startOpenRouterOAuth();
    } catch (err: any) {
      setIsConnectingOpenRouter(false);
      setSsoTestStatus((prev) => ({
        ...prev,
        openrouter: { loading: false, ok: false, message: err?.message || 'OpenRouter OAuth initiation failed' },
      }));
      playBeep('error');
    }
  };

  const handleOpenRouterDisconnect = async () => {
    playBeep('tap');
    await disconnectOpenRouter();
    setOpenRouterKeyState('');
    setAiSsoMode(localStorage.getItem('pixelops_ai_sso_mode'));
    setSsoTestStatus((prev) => ({ ...prev, openrouter: undefined }));
  };

  const handleSetOpenRouterActive = () => {
    playBeep('tap');
    setOpenRouterActive(true);
    setAiSsoMode('openrouter');
    setSsoTestStatus((prev) => ({
      ...prev,
      openrouter: { ok: true, message: `OpenRouter active engine (${openRouterModel})!` },
    }));
  };

  const handleOpenRouterSelectModel = (modelId: string) => {
    playBeep('tap');
    setOpenRouterSelectedModel(modelId);
    setOpenRouterModelState(modelId);
  };

  const handleSaveManualOpenRouterKey = () => {
    if (!customOpenRouterKeyInput.trim()) return;
    playBeep('tap');
    setOpenRouterKey(customOpenRouterKeyInput.trim());
    setOpenRouterKeyState(customOpenRouterKeyInput.trim());
    setCustomOpenRouterKeyInput('');
    setShowManualOpenRouterInput(false);
    setAiSsoMode('openrouter');
    setSsoTestStatus((prev) => ({
      ...prev,
      openrouter: { ok: true, message: 'OpenRouter API key saved!' },
    }));
    playBeep('complete');
  };

  const handleTestOpenRouter = async () => {
    setSsoTestStatus((prev) => ({ ...prev, openrouter: { loading: true } }));
    playBeep('tap');
    try {
      const res = await testOpenRouterConnection(openRouterModel, openRouterKey);
      setSsoTestStatus((prev) => ({
        ...prev,
        openrouter: { loading: false, ok: res.ok, message: res.message || res.error },
      }));
      playBeep(res.ok ? 'complete' : 'error');
    } catch (err: any) {
      setSsoTestStatus((prev) => ({
        ...prev,
        openrouter: { loading: false, ok: false, message: err?.message || 'Connection test failed' },
      }));
      playBeep('error');
    }
  };

  const handleTestLlm = async () => {
    setLlmTestStatus({ loading: true, message: undefined });
    playBeep('tap');
    try {
      const res = await testLLMProviderConnection(llmConfig, theme.id, 'apikey');
      if (res.ok) {
        setLlmTestStatus({
          loading: false,
          ok: true,
          message: `${res.message} [Model: ${res.model}]`,
        });
        playBeep('complete');
      } else {
        setLlmTestStatus({
          loading: false,
          ok: false,
          message: res.error || 'Connection test failed.',
        });
        playBeep('error');
      }
    } catch (err: any) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: err?.message || 'Connection failed.',
      });
      playBeep('error');
    }
  };

  useEffect(() => {
    return ambientAudioService.subscribe(() => {
      setAmbientState(ambientAudioService.getState());
    });
  }, []);

  if (!isOpen) return null;

  const activeProfile =
    ROOM_SOUNDSCAPE_PROFILES[currentRoom] || ROOM_SOUNDSCAPE_PROFILES.war_room;

  const handleRotateProviderToken = async (provider: ServiceProviderName) => {
    setRotatingProvider(provider);
    playBeep('tap');
    try {
      await refreshOAuthProviderToken(provider);
      await onRevalidateVault();
      playBeep('complete');
    } finally {
      setRotatingProvider(null);
    }
  };

  const handleRunVaultAudit = async () => {
    setRevalidating(true);
    playBeep('tap');
    try {
      await onRevalidateVault();
      playBeep('complete');
    } finally {
      setRevalidating(false);
    }
  };

  const handleSaveAll = () => {
    // Persist all entries in the vault state to ensure zero lost keys
    for (const [pId, entry] of Object.entries(vaultEntries) as [
      'gemini' | 'anthropic' | 'openai' | 'groq',
      any
    ][]) {
      if (entry?.apiKey) {
        saveBYOKVaultEntry(pId, entry.apiKey, entry.selectedModel);
      }
    }
    saveLLMProviderConfig(llmConfig);

    // Persist OSINT keys
    setOsintKey('SHODAN', osintKeys.shodan);
    setOsintKey('ABUSEIPDB', osintKeys.abuseipdb);
    setOsintKey('VIRUSTOTAL', osintKeys.virustotal);
    setOsintKey('OTX', osintKeys.otx);
    setOsintKey('IPINFO', osintKeys.ipinfo);
    setOsintKey('GITHUB', osintKeys.github);

    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/90 backdrop-blur-md p-2 sm:p-4 overflow-y-auto"
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 12px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))',
        paddingLeft: 'max(12px, env(safe-area-inset-left, 12px))',
        paddingRight: 'max(12px, env(safe-area-inset-right, 12px))',
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[#11141c] border p-4 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90dvh] overflow-y-auto my-auto"
        style={{
          borderColor: 'var(--theme-border-color)',
          boxShadow: '0 0 28px var(--theme-glow-soft)',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Lock
                className="w-4 h-4"
                style={{ color: 'rgb(var(--theme-primary-rgb))' }}
              />
              <span>Command Center Settings & LLM Vault</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              RGB / HSL Theme Filter Engine, Model-Agnostic LLM & Encrypted Keychain
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 0. User-Customizable RGB / HSL Theme Color Picker & CSS Filter Injection Panel */}
        <ThemeSettings />

        {/* 1. Model-Agnostic LLM Provider & AI Subscription Engine Section */}
        <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Cpu className={`w-4 h-4 text-cyan-400`} />
              <span className="font-semibold text-slate-200">Active LLM Intelligence Engine</span>
            </div>
            <span className="font-mono-tabular text-[11px] text-cyan-300">
              {aiSsoMode === 'puter'
                ? 'PUTER.JS · ZERO-KEY AI'
                : aiSsoMode === 'openrouter'
                ? `OPENROUTER · ${openRouterModel}`
                : `${llmConfig.providerId.toUpperCase()} · ${llmConfig.modelName}`}
            </span>
          </div>

          {/* DUAL 1-CLICK MULTI-MODEL AI SSO SECTION */}
          <div className="rounded-xl border border-indigo-900/60 bg-[#0b0c16] p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] font-bold font-mono-tabular text-slate-100 uppercase tracking-wide">
                  DUAL 1-CLICK MULTI-MODEL AI SSO
                </span>
              </div>
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 border border-indigo-500/50 text-indigo-300 font-mono-tabular">
                ZERO CONFIG
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              One-click SSO authorization across Puter.js and OpenRouter. Access 300+ models without handling raw keys.
            </p>

            <div className="grid grid-cols-1 gap-2.5 pt-1">
              {/* 1. Puter.js 1-Click Zero-Key AI SSO */}
              <div
                className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${
                  aiSsoMode === 'puter'
                    ? 'bg-[#061510] border-emerald-500/70 shadow-[0_0_12px_rgba(16,185,129,0.18)]'
                    : 'bg-[#08120d] border-emerald-950/80 hover:border-emerald-800/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                      <span>Puter.js Zero-Key AI</span>
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 font-mono-tabular">
                      ZERO KEYS · 1-CLICK
                    </span>
                  </div>
                  {puterSignedIn && (
                    <span className="text-[10px] text-emerald-400 font-mono-tabular flex items-center gap-1 font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{puterUsername ? `@${puterUsername}` : 'CONNECTED'}</span>
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400">
                  Instant browser-native multi-model execution (Gemini 2.5 Flash, DeepSeek R1, Claude).
                </p>

                <div className="flex flex-col gap-1.5 pt-1">
                  {!puterSignedIn ? (
                    <button
                      type="button"
                      onClick={handlePuterSignIn}
                      disabled={isSigningInPuter}
                      className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isSigningInPuter ? 'Connecting Puter...' : '[🟢 1-Click Zero-Key AI (Sign In with Puter)]'}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {aiSsoMode === 'puter' ? (
                        <span className="flex-1 py-1 px-2 rounded bg-emerald-950 border border-emerald-500/60 text-[10px] font-mono-tabular font-bold text-emerald-300 text-center flex items-center justify-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>ACTIVE ENGINE</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSetPuterActive}
                          className="flex-1 py-1 px-2 rounded bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-700/60 text-[10px] font-mono-tabular text-emerald-200 cursor-pointer"
                        >
                          Set As Active
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleTestPuter}
                        disabled={ssoTestStatus.puter?.loading}
                        className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono-tabular cursor-pointer disabled:opacity-50"
                      >
                        {ssoTestStatus.puter?.loading ? 'Testing...' : 'Test Link'}
                      </button>
                      <button
                        type="button"
                        onClick={handlePuterSignOut}
                        className="py-1 px-2 rounded bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-red-200 text-[10px] font-mono-tabular cursor-pointer"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}

                  {ssoTestStatus.puter?.message && (
                    <div
                      className={`text-[10px] font-mono-tabular truncate ${
                        ssoTestStatus.puter.ok ? 'text-emerald-400' : 'text-red-400'
                      }`}
                      title={ssoTestStatus.puter.message}
                    >
                      {ssoTestStatus.puter.ok ? '● ' : '⚠️ '}
                      {ssoTestStatus.puter.message}
                    </div>
                  )}
                </div>
              </div>

              {/* 2. OpenRouter 1-Click Power SSO */}
              <div
                className={`rounded-xl border p-3 flex flex-col gap-2 transition-all ${
                  aiSsoMode === 'openrouter'
                    ? 'bg-[#100e20] border-indigo-500/70 shadow-[0_0_12px_rgba(99,102,241,0.18)]'
                    : 'bg-[#0d0d1b] border-indigo-950/80 hover:border-indigo-800/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                      <span>OpenRouter Power SSO</span>
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 border border-indigo-500/50 text-indigo-300 font-mono-tabular">
                      300+ MODELS · PKCE
                    </span>
                  </div>
                  {openRouterKey && (
                    <span className="text-[10px] text-indigo-400 font-mono-tabular font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                      <span>CONNECTED</span>
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400">
                  Access free tiers (Gemini 2.5 Flash, DeepSeek R1, Llama 3.3) and flagship models (Claude 3.5 Sonnet, GPT-4o).
                </p>

                <div className="flex flex-col gap-1.5 pt-1">
                  {!openRouterKey ? (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={handleOpenRouterConnect}
                        disabled={isConnectingOpenRouter}
                        className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-300" />
                        <span>{isConnectingOpenRouter ? 'Opening OpenRouter...' : '[⚡ 1-Click Power SSO (Connect OpenRouter - 300+ Models)]'}</span>
                      </button>

                      <div className="flex items-center justify-between text-[10px]">
                        <button
                          type="button"
                          onClick={() => setShowManualOpenRouterInput(!showManualOpenRouterInput)}
                          className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                        >
                          {showManualOpenRouterInput ? 'Hide manual key entry' : 'or enter existing OpenRouter API key manually'}
                        </button>
                      </div>

                      {showManualOpenRouterInput && (
                        <div className="flex items-center gap-1 pt-1">
                          <input
                            type="password"
                            value={customOpenRouterKeyInput}
                            onChange={(e) => setCustomOpenRouterKeyInput(e.target.value)}
                            placeholder="sk-or-v1-..."
                            className="flex-1 bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={handleSaveManualOpenRouterKey}
                            className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-xs cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {/* Model Selector Pills */}
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-slate-400 font-mono-tabular uppercase font-semibold">
                            OpenRouter Models
                          </label>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono-tabular">
                            <span className="text-emerald-400 font-bold">12+ Free Models</span>
                            <span className="text-slate-600">·</span>
                            <span className="text-indigo-400 truncate max-w-[200px]" title={openRouterModel}>
                              Active: {openRouterModel}
                            </span>
                          </div>
                        </div>

                        {/* Free Tier Models */}
                        <div className="flex flex-col gap-1 p-2 rounded bg-emerald-950/20 border border-emerald-900/40">
                          <div className="text-[9px] text-emerald-400 font-mono-tabular font-bold uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span>Zero-Cost Free Models (No Credits Required)</span>
                            </span>
                            <a
                              href="https://openrouter.ai/models?variant=free"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] text-emerald-400/80 hover:text-emerald-300 underline font-mono flex items-center gap-0.5 normal-case"
                            >
                              openrouter.ai/models?variant=free ↗
                            </a>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {OPENROUTER_FREE_MODELS.map((m) => {
                              const isSelected = openRouterModel === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => handleOpenRouterSelectModel(m.id)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular border cursor-pointer transition-colors flex items-center gap-1 ${
                                    isSelected
                                      ? 'bg-emerald-900 border-emerald-400 text-emerald-100 font-bold shadow-[0_0_8px_rgba(16,185,129,0.35)]'
                                      : 'bg-[#151329] border-emerald-900/40 text-emerald-300/80 hover:border-emerald-500/60 hover:text-emerald-200'
                                  }`}
                                  title={m.context}
                                >
                                  <span className="text-[8px] px-1 rounded bg-emerald-950 text-emerald-400 font-semibold border border-emerald-800/40">
                                    FREE
                                  </span>
                                  <span>{m.name.replace(' (Free)', '')}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Flagship Models */}
                        <div className="flex flex-col gap-1 p-2 rounded bg-indigo-950/20 border border-indigo-900/40">
                          <div className="text-[9px] text-indigo-400 font-mono-tabular font-bold uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                              <span>Flagship Frontier Models (Credits Required)</span>
                            </span>
                            <span className="text-[9px] text-indigo-400/70">Paid Tier</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {OPENROUTER_FLAGSHIP_MODELS.map((m) => {
                              const isSelected = openRouterModel === m.id;
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => handleOpenRouterSelectModel(m.id)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono-tabular border cursor-pointer transition-colors flex items-center gap-1 ${
                                    isSelected
                                      ? 'bg-indigo-900/80 border-indigo-400 text-indigo-100 font-bold shadow-[0_0_8px_rgba(99,102,241,0.35)]'
                                      : 'bg-[#151329] border-indigo-900/40 text-indigo-300/70 hover:border-indigo-500/60 hover:text-indigo-200'
                                  }`}
                                  title={m.context}
                                >
                                  <span className="text-[8px] px-1 rounded bg-indigo-950 text-indigo-400 font-semibold border border-indigo-800/40">
                                    PAID
                                  </span>
                                  <span>{m.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1">
                        {aiSsoMode === 'openrouter' ? (
                          <span className="flex-1 py-1 px-2 rounded bg-indigo-950 border border-indigo-500/60 text-[10px] font-mono-tabular font-bold text-indigo-300 text-center flex items-center justify-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                            <span>ACTIVE ENGINE</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSetOpenRouterActive}
                            className="flex-1 py-1 px-2 rounded bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/60 text-[10px] font-mono-tabular text-indigo-200 cursor-pointer"
                          >
                            Set As Active
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleTestOpenRouter}
                          disabled={ssoTestStatus.openrouter?.loading}
                          className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-mono-tabular cursor-pointer disabled:opacity-50"
                        >
                          {ssoTestStatus.openrouter?.loading ? 'Testing...' : 'Test Link'}
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenRouterDisconnect}
                          className="py-1 px-2 rounded bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-red-200 text-[10px] font-mono-tabular cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  )}

                  {ssoTestStatus.openrouter?.message && (
                    <div
                      className={`text-[10px] font-mono-tabular truncate ${
                        ssoTestStatus.openrouter.ok ? 'text-indigo-400' : 'text-red-400'
                      }`}
                      title={ssoTestStatus.openrouter.message}
                    >
                      {ssoTestStatus.openrouter.ok ? '● ' : '⚠️ '}
                      {ssoTestStatus.openrouter.message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* MULTI-PROVIDER BYOK KEY VAULT VIEW */}
            <div className="flex flex-col gap-3 pt-1">
              <div className="p-2.5 bg-[#0a0f18] border border-cyan-900/50 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono-tabular uppercase text-cyan-400 font-bold flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-cyan-400" />
                    <span>MULTI-PROVIDER BYOK KEY VAULT</span>
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Store and verify credentials for Gemini, Claude, OpenAI, and Groq. Saved to encrypted IndexedDB & LocalStorage.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 font-mono-tabular">ACTIVE ENGINE</span>
                  <div className="text-xs font-bold font-mono-tabular text-emerald-400">
                    {aiSsoMode === 'puter'
                      ? 'PUTER.JS'
                      : aiSsoMode === 'openrouter'
                      ? 'OPENROUTER'
                      : llmConfig.providerId.toUpperCase()}
                  </div>
                </div>
              </div>

              {/* Individual Provider Vault Cards */}
              {(['gemini', 'anthropic', 'openai', 'groq'] as const).map((pId) => {
                const entry = vaultEntries[pId] || {
                  apiKey: '',
                  selectedModel: SUPPORTED_VAULT_PROVIDERS[pId].defaultModel,
                };
                const meta = SUPPORTED_VAULT_PROVIDERS[pId];
                const isActive = llmConfig.providerId === pId;
                const testStatus = vaultTestStatus[pId];
                const isRevealed = Boolean(revealedVaultKeys[pId]);

                return (
                  <div
                    key={pId}
                    className={`rounded-xl border p-3 flex flex-col gap-2.5 transition-all ${
                      isActive
                        ? 'bg-[#0f172a]/70 border-cyan-500/70 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                        : 'bg-[#0e121c] border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    {/* Header: Provider Name, Badge & Active Toggle */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-100">{meta.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono-tabular">
                          {meta.badge}
                        </span>
                      </div>

                      {isActive ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/60 text-[10px] text-emerald-300 font-mono-tabular font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>ACTIVE ENGINE</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivateVaultProvider(pId)}
                          className="px-2 py-0.5 rounded bg-[#162132] hover:bg-[#1e2f47] border border-cyan-800/60 text-[10px] text-cyan-300 font-mono-tabular cursor-pointer transition-colors"
                        >
                          Set As Active
                        </button>
                      )}
                    </div>

                    {/* Model Selector Pills */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-mono-tabular uppercase">
                        Select Model
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {meta.availableModels.map((m) => {
                          const isMSelected = entry.selectedModel === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => handleSelectVaultModel(pId, m)}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono-tabular border cursor-pointer transition-colors ${
                                isMSelected
                                  ? 'bg-cyan-900/60 border-cyan-400 text-cyan-200 font-bold'
                                  : 'bg-[#121622] border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {m}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* API Key Input Row */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-400 font-mono-tabular uppercase">
                        {meta.name} API Key
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type={isRevealed ? 'text' : 'password'}
                          value={entry.apiKey}
                          onChange={(e) => handleUpdateVaultKey(pId, e.target.value)}
                          placeholder={meta.placeholderKey}
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-2.5 py-1.5 pr-8 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedVaultKeys((prev) => ({
                              ...prev,
                              [pId]: !prev[pId],
                            }))
                          }
                          className="absolute right-2 text-slate-400 hover:text-slate-200 cursor-pointer"
                          title={isRevealed ? 'Hide API Key' : 'Reveal API Key'}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Test Connection Button & Status */}
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={() => handleTestVaultProvider(pId)}
                        disabled={testStatus?.loading || !entry.apiKey.trim()}
                        className="min-h-[30px] px-2.5 py-1 rounded bg-[#131d2e] hover:bg-[#1a2942] border border-cyan-800/60 text-[11px] text-cyan-200 font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${testStatus?.loading ? 'animate-spin' : ''}`} />
                        <span>{testStatus?.loading ? 'Testing...' : `Test ${meta.name} Link`}</span>
                      </button>

                      {testStatus?.message && (
                        <span
                          className={`text-[11px] font-mono-tabular truncate max-w-[260px] ${
                            testStatus.ok ? 'text-emerald-400' : 'text-red-400'
                          }`}
                          title={testStatus.message}
                        >
                          {testStatus.ok ? '● Link Verified' : `⚠️ ${testStatus.message}`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Local Ollama Endpoint (Optional Air-Gapped) */}
              <div className="rounded-xl border border-slate-800 bg-[#0d0f17] p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200">Local Ollama Endpoint (Air-Gapped)</div>
                  {llmConfig.providerId === 'ollama' ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/60 text-[10px] text-emerald-300 font-mono-tabular font-bold">
                      ACTIVE
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        playBeep('tap');
                        const updated = {
                          ...llmConfig,
                          providerId: 'ollama' as const,
                          modelName: 'llama3.3',
                        };
                        saveLLMProviderConfig(updated);
                        setLlmConfig(updated);
                      }}
                      className="px-2 py-0.5 rounded bg-[#162132] hover:bg-[#1e2f47] border border-cyan-800/60 text-[10px] text-cyan-300 font-mono-tabular cursor-pointer"
                    >
                      Set As Active
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={llmConfig.endpoint}
                  onChange={(e) => {
                    const updated = { ...llmConfig, endpoint: e.target.value };
                    setLlmConfig(updated);
                    saveLLMProviderConfig(updated);
                  }}
                  placeholder="http://localhost:11434"
                  className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={
                aiSsoMode === 'puter'
                  ? handleTestPuter
                  : aiSsoMode === 'openrouter'
                  ? handleTestOpenRouter
                  : handleTestLlm
              }
              disabled={
                llmTestStatus.loading ||
                Boolean(ssoTestStatus.puter?.loading) ||
                Boolean(ssoTestStatus.openrouter?.loading)
              }
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/60 text-xs font-medium text-cyan-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  llmTestStatus.loading ||
                  ssoTestStatus.puter?.loading ||
                  ssoTestStatus.openrouter?.loading
                    ? 'animate-spin'
                    : ''
                }`}
              />
              <span>
                {llmTestStatus.loading ||
                ssoTestStatus.puter?.loading ||
                ssoTestStatus.openrouter?.loading
                  ? 'Testing Link...'
                  : `Test ${
                      aiSsoMode === 'puter'
                        ? 'PUTER.JS'
                        : aiSsoMode === 'openrouter'
                        ? 'OPENROUTER'
                        : llmConfig.providerId.toUpperCase()
                    } Active Link`}
              </span>
            </button>
          </div>

          {(llmTestStatus.message ||
            (aiSsoMode === 'puter' && ssoTestStatus.puter?.message) ||
            (aiSsoMode === 'openrouter' && ssoTestStatus.openrouter?.message)) && (
            <p
              className={`text-xs font-mono-tabular ${
                (aiSsoMode === 'puter'
                  ? ssoTestStatus.puter?.ok
                  : aiSsoMode === 'openrouter'
                  ? ssoTestStatus.openrouter?.ok
                  : llmTestStatus.ok)
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }`}
            >
              {aiSsoMode === 'puter'
                ? ssoTestStatus.puter?.message
                : aiSsoMode === 'openrouter'
                ? ssoTestStatus.openrouter?.message
                : llmTestStatus.message}
            </p>
          )}
        </div>

        {/* Specialized OSINT & Adversarial Tool Credentials (BYOK) */}
        <div className="rounded-xl border border-slate-800 bg-[#0d0f17] p-3 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setShowOsintSection(!showOsintSection);
            }}
            className="flex items-center justify-between text-left cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-slate-100 group-hover:text-emerald-300 transition-colors">
                  OSINT & Adversarial Threat Keys (BYOK)
                </span>
                <p className="text-[10px] text-slate-400">
                  Optional keys for Shodan, AbuseIPDB, VirusTotal, AlienVault OTX, IPinfo & GitHub leak search.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono-tabular text-emerald-400 bg-emerald-950/60 border border-emerald-700/50 px-2 py-0.5 rounded">
              {showOsintSection ? '▼ HIDE' : '► CONFIGURE'}
            </span>
          </button>

          {showOsintSection && (
            <div className="pt-2 flex flex-col gap-3 border-t border-slate-800 text-xs">
              <p className="text-[11px] text-slate-400">
                All OSINT modules have built-in zero-friction public endpoints (e.g. crt.sh, BGPView, Shodan InternetDB). Adding personal API keys below unlocks higher rate limits and full telemetry payloads.
              </p>

              {/* Shodan */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  Shodan API Key
                </label>
                <input
                  type="password"
                  value={osintKeys.shodan}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, shodan: e.target.value }))}
                  placeholder="Shodan developer key..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* AbuseIPDB */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  AbuseIPDB API Key
                </label>
                <input
                  type="password"
                  value={osintKeys.abuseipdb}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, abuseipdb: e.target.value }))}
                  placeholder="AbuseIPDB API v2 key..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* VirusTotal */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  VirusTotal API Key
                </label>
                <input
                  type="password"
                  value={osintKeys.virustotal}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, virustotal: e.target.value }))}
                  placeholder="VirusTotal v3 API key..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* AlienVault OTX */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  AlienVault OTX API Key
                </label>
                <input
                  type="password"
                  value={osintKeys.otx}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, otx: e.target.value }))}
                  placeholder="OTX threat pulse key..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* IPinfo */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  IPinfo Token
                </label>
                <input
                  type="password"
                  value={osintKeys.ipinfo}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, ipinfo: e.target.value }))}
                  placeholder="IPinfo geolocation token..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* GitHub Token */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-mono-tabular uppercase font-semibold text-slate-300">
                  GitHub Personal Access Token (Code Search)
                </label>
                <input
                  type="password"
                  value={osintKeys.github}
                  onChange={(e) => setOsintKeys((prev) => ({ ...prev, github: e.target.value }))}
                  placeholder="ghp_..."
                  className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Workspace File Explorer & Reports Button */}
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onClose();
            onOpenWorkspaceFiles?.();
          }}
          className="w-full min-h-[40px] px-3 py-2.5 rounded-xl bg-sky-950/60 hover:bg-sky-900/60 border border-sky-600/60 text-xs font-semibold text-sky-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <FileText className="w-4 h-4 text-sky-400" />
          <span>📁 Browse Workspace Reports & Logs (IndexedDB)</span>
        </button>

        {/* SatCom Multi-Device Cloud Sync Button */}
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            onClose();
            onOpenSyncModal?.();
          }}
          className="w-full min-h-[40px] px-3 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-600/60 text-xs font-semibold text-emerald-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <Radio className="w-4 h-4 text-emerald-400" />
          <span>☁️ SatCom Multi-Device Cloud Sync & Accounts</span>
        </button>
        {/* Classified Safehouse Field Manual Button */}
        {onOpenFieldManual && (
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              onClose();
              onOpenFieldManual();
            }}
            className="w-full min-h-[40px] px-3 py-2.5 rounded-xl bg-amber-950/50 hover:bg-amber-900/50 border border-amber-600/60 text-xs font-semibold text-amber-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <BookOpen className="w-4 h-4 text-amber-400" />
            <span>📖 Open Classified Safehouse Field Manual</span>
          </button>
        )}

        {/* Guardrails & Leashes Button */}
        <button
          type="button"
          onClick={() => {
            playBeep('tap');
            setIsGuardrailsOpen(true);
          }}
          className="w-full min-h-[40px] px-3 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-600/60 text-xs font-semibold text-emerald-200 flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>🛡️ Open Guardrails & Leashes Control Panel</span>
        </button>

        {/* Room-Specific Retro Synth Ambient Soundscape Engine */}
        <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Room-Specific Retro Synth Soundscape</span>
            </span>
            <span
              className="font-mono-tabular text-[11px] font-semibold"
              style={{ color: activeProfile.accentColor }}
            >
              {ambientState.isEnabled && soundEnabled
                ? `[LIVE · ${activeProfile.shortTag}]`
                : '[MUTED]'}
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-[#12151f] border border-slate-800/90 flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs font-mono-tabular">
              <span className="text-slate-200 font-semibold">
                {ROOM_METADATA[currentRoom]?.shortBadge || String(currentRoom).toUpperCase()}: {activeProfile.title}
              </span>
              <span className="text-[10px] text-emerald-400">
                {activeProfile.waveformLabel}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              {activeProfile.description}
            </p>
          </div>

          {/* Ambient Synth Loop Volume Slider */}
          <div className="flex items-center justify-between gap-3 text-xs pt-1">
            <label htmlFor="ambient-vol-slider" className="text-slate-300 shrink-0">
              Ambient Synth Gain ({Math.round(ambientState.volume * 100)}%)
            </label>
            <input
              id="ambient-vol-slider"
              type="range"
              min="0.05"
              max="1.0"
              step="0.05"
              value={ambientState.volume}
              onChange={(e) =>
                ambientAudioService.setVolume(parseFloat(e.target.value))
              }
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Quick Audition Buttons for All 7 Sector Loops */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {ROOM_ORDER.map((rId) => {
              const prof = ROOM_SOUNDSCAPE_PROFILES[rId];
              const isCurr = currentRoom === rId;
              return (
                <button
                  key={rId}
                  type="button"
                  onClick={() => {
                    if (!soundEnabled) setSoundEnabled(true);
                    if (!ambientState.isEnabled) {
                      ambientAudioService.setAmbientEnabled(true, true);
                    }
                    onSelectRoom?.(rId);
                    ambientAudioService.setRoom(rId, true);
                  }}
                  className={`px-2 py-1 rounded text-[10px] font-mono-tabular border transition-colors cursor-pointer ${
                    isCurr
                      ? 'bg-slate-800 text-white border-amber-400 font-bold'
                      : 'bg-[#12151f] text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                  title={prof.description}
                >
                  🔊 {ROOM_METADATA[rId]?.shortBadge || String(rId).toUpperCase()} ({prof.shortTag})
                </button>
              );
            })}
          </div>
        </div>

        {/* Encrypted OAuth Service Provider Tokens */}
        <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Service Provider OAuth Tokens (AES-256-GCM)</span>
            </span>
            <span className="font-mono-tabular text-[11px] text-slate-400">
              {vaultReport?.masterKeyReady ? 'Master Key Active' : 'Initializing'}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {vaultReport &&
              Object.values(vaultReport.providerValidations).map((item) => (
                <div
                  key={item.provider}
                  className="p-2.5 rounded-lg bg-[#12151f] border border-slate-800/90 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      {item.valid ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-200">
                        {PROVIDER_LABELS[item.provider] || item.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {onOpenPluginAuth && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenPluginAuth({
                              id: item.provider,
                              name: PROVIDER_LABELS[item.provider] || item.provider,
                            })
                          }
                          className="px-2 py-0.5 rounded bg-[#1e1710] hover:bg-[#2b1f14] text-[11px] font-mono-tabular text-amber-300 border border-amber-800/80 cursor-pointer"
                          title="Configure BYOK Key / OAuth Secret locally"
                        >
                          BYOK Key 🔑
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRotateProviderToken(item.provider)}
                        disabled={rotatingProvider === item.provider}
                        className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-mono-tabular text-emerald-300 border border-slate-700 cursor-pointer"
                      >
                        {rotatingProvider === item.provider ? 'Rotating...' : 'Rotate OAuth'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-mono-tabular text-[10px] text-slate-400">
                    <div className="truncate">
                      <span className="text-slate-500">Access: </span>
                      <span className="text-slate-300">{item.maskedAccessToken}</span>
                    </div>
                    <div className="truncate">
                      <span className="text-slate-500">Refresh: </span>
                      <span className="text-slate-300">{item.maskedRefreshToken}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Reasoning Temperature */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="temp-slider" className="font-medium text-slate-300">
              Agent Reasoning Temperature
            </label>
            <span className="font-mono-tabular text-slate-400">
              {preferences.temperature.toFixed(1)}
            </span>
          </div>
          <input
            id="temp-slider"
            type="range"
            min="0.1"
            max="1.2"
            step="0.1"
            value={preferences.temperature}
            onChange={(e) =>
              onUpdatePreferences({
                ...preferences,
                temperature: parseFloat(e.target.value),
              })
            }
            className="w-full accent-emerald-500 cursor-pointer"
          />
        </div>

        {/* Audio Synth Toggle */}
        <div>
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              ambientAudioService.setAmbientEnabled(next, next);
            }}
            className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            {soundEnabled && ambientState.isEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" />
            )}
            <span>
              8-Bit & Room Synth:{' '}
              {soundEnabled && ambientState.isEnabled ? 'On' : 'Muted'}
            </span>
          </button>
        </div>

        {onOpenFeedback && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFeedback();
            }}
            className="w-full min-h-[40px] px-3 py-2 rounded-xl bg-[#061806] hover:bg-[#0a240a] border border-[#00ff66]/50 text-xs font-mono font-semibold text-[#00ff66] flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-[0_0_15px_rgba(0,255,102,0.15)]"
          >
            <span>📡</span>
            <span>Open Feedback Terminal (support@pixelops.app)</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleSaveAll}
          className={`w-full min-h-[42px] rounded-xl text-xs font-semibold text-slate-950 ${theme.accentBgClass} hover:opacity-95 transition-opacity cursor-pointer`}
        >
          Save Configuration
        </button>
      </div>

      <GuardrailsModal isOpen={isGuardrailsOpen} onClose={() => setIsGuardrailsOpen(false)} />
    </div>
  );
};
