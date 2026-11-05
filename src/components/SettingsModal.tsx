import React, { useState, useEffect } from 'react';
import {
  X,
  Volume2,
  VolumeX,
  RefreshCw,
  ShieldCheck,
  BatteryCharging,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Cpu,
  Server,
  FileText,
  BookOpen,
  Sparkles,
  Check,
  ExternalLink,
  UserCheck,
  LogOut,
  Key,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { CommandPreferences } from '../services/ApiService';
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
  AuthMode,
  ConnectedSubscriptionAccount,
  DEFAULT_PROVIDER_CONFIGS,
  SUBSCRIPTION_PLANS,
  loadLLMProviderConfig,
  saveLLMProviderConfig,
  testLLMProviderConnection,
  initiateGoogleSignIn,
  connectUserSubscriptionAccount,
  disconnectSubscriptionAccount,
  setLLMAuthMode,
  getLLMAuthInfo,
} from '../services/LLMProviderService';
import { GoogleAuthButton } from './GoogleAuthButton';
import {
  getBYOKVaultSnapshot,
  saveBYOKVaultEntry,
  testBYOKConnection,
  setActiveVaultProvider,
  SUPPORTED_VAULT_PROVIDERS,
} from '../services/BYOKVault';

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

  // Model-Agnostic LLM Provider State
  const [llmConfig, setLlmConfig] = useState<LLMProviderConfig>(loadLLMProviderConfig);
  const [isGuardrailsOpen, setIsGuardrailsOpen] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    message?: string;
  }>({ loading: false });

  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [isConnectingSubscription, setIsConnectingSubscription] = useState(false);
  const [userGoogleEmail, setUserGoogleEmail] = useState('');
  const [userGoogleKey, setUserGoogleKey] = useState('');
  const [userOpenAIEmail, setUserOpenAIEmail] = useState('');
  const [userOpenAIKey, setUserOpenAIKey] = useState('');
  const [userAnthropicEmail, setUserAnthropicEmail] = useState('');
  const [userAnthropicKey, setUserAnthropicKey] = useState('');
  const [googleClientIdInput, setGoogleClientIdInput] = useState(
    () => llmConfig.googleClientId || ''
  );
  const [showClientIdInput, setShowClientIdInput] = useState(false);

  // Multi-Provider BYOK Vault State
  const [vaultEntries, setVaultEntries] = useState(() => getBYOKVaultSnapshot());
  const [vaultTestStatus, setVaultTestStatus] = useState<
    Record<string, { loading?: boolean; ok?: boolean; message?: string }>
  >({});
  const [revealedVaultKeys, setRevealedVaultKeys] = useState<Record<string, boolean>>({});
  const [authenticatedGoogleEmail, setAuthenticatedGoogleEmail] = useState(() => {
    return (
      (typeof localStorage !== 'undefined' && localStorage.getItem('pixelops_user_email')) || ''
    );
  });
  const [authenticatedGoogleName, setAuthenticatedGoogleName] = useState(() => {
    return (
      (typeof localStorage !== 'undefined' && localStorage.getItem('pixelops_user_name')) || ''
    );
  });

  const handleUpdateVaultKey = (
    provider: 'gemini' | 'anthropic' | 'openai' | 'groq',
    key: string
  ) => {
    setVaultEntries((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], apiKey: key },
    }));
    saveBYOKVaultEntry(provider, key, vaultEntries[provider]?.selectedModel);
    if (provider === llmConfig.providerId) {
      setLlmConfig((prev) => ({ ...prev, apiKey: key }));
    }
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
    setActiveVaultProvider(provider, vaultEntries[provider]?.selectedModel);
    const updated = loadLLMProviderConfig();
    setLlmConfig(updated);
    setLlmTestStatus({
      loading: false,
      ok: true,
      message: `Active engine switched to ${provider.toUpperCase()} (${vaultEntries[provider]?.selectedModel}).`,
    });
  };

  const handleSwitchAuthMode = (mode: AuthMode) => {
    playBeep('tap');
    const updated = setLLMAuthMode(mode);
    setLlmConfig(updated);
    setLlmTestStatus({ loading: false, message: undefined });
  };

  const handleConnectGoogleSubscription = async () => {
    if (!userGoogleEmail.trim() || !userGoogleEmail.includes('@')) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your actual Google account email (e.g. user@gmail.com).',
      });
      playBeep('error');
      return;
    }
    if (!userGoogleKey.trim()) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your Google AI Studio API key or OAuth Bearer token.',
      });
      playBeep('error');
      return;
    }

    setIsConnectingSubscription(true);
    setLlmTestStatus({ loading: true, message: 'Validating credentials with Google Gemini upstream...' });
    playBeep('tap');
    try {
      const account = await connectUserSubscriptionAccount({
        providerId: 'gemini',
        email: userGoogleEmail.trim(),
        credentialKey: userGoogleKey.trim(),
      });
      const updated = loadLLMProviderConfig();
      setLlmConfig(updated);
      setUserGoogleKey('');
      setLlmTestStatus({
        loading: false,
        ok: true,
        message: `Successfully connected ${account.email} to Google AI Pro Plan! Tactical link verified.`,
      });
      playBeep('complete');
    } catch (err: any) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: err?.message || 'Google account connection failed. Check your key/token.',
      });
      playBeep('error');
    } finally {
      setIsConnectingSubscription(false);
    }
  };

  const handleConnectOpenAISubscription = async () => {
    if (!userOpenAIEmail.trim() || !userOpenAIEmail.includes('@')) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your OpenAI account email.',
      });
      playBeep('error');
      return;
    }
    if (!userOpenAIKey.trim()) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your OpenAI API key or session token.',
      });
      playBeep('error');
      return;
    }

    setIsConnectingSubscription(true);
    setLlmTestStatus({ loading: true, message: 'Connecting ChatGPT Plus / Pro credentials...' });
    playBeep('tap');
    try {
      const account = await connectUserSubscriptionAccount({
        providerId: 'openai',
        email: userOpenAIEmail.trim(),
        credentialKey: userOpenAIKey.trim(),
      });
      const updated = loadLLMProviderConfig();
      setLlmConfig(updated);
      setUserOpenAIKey('');
      setLlmTestStatus({
        loading: false,
        ok: true,
        message: `Connected ${account.email} to ChatGPT Plus & Pro subscription!`,
      });
      playBeep('complete');
    } catch (err: any) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: err?.message || 'Connection failed.',
      });
      playBeep('error');
    } finally {
      setIsConnectingSubscription(false);
    }
  };

  const handleConnectAnthropicSubscription = async () => {
    if (!userAnthropicEmail.trim() || !userAnthropicEmail.includes('@')) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your Anthropic account email.',
      });
      playBeep('error');
      return;
    }
    if (!userAnthropicKey.trim()) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: 'Please enter your Anthropic Claude key or session token.',
      });
      playBeep('error');
      return;
    }

    setIsConnectingSubscription(true);
    setLlmTestStatus({ loading: true, message: 'Connecting Claude Pro credentials...' });
    playBeep('tap');
    try {
      const account = await connectUserSubscriptionAccount({
        providerId: 'anthropic',
        email: userAnthropicEmail.trim(),
        credentialKey: userAnthropicKey.trim(),
      });
      const updated = loadLLMProviderConfig();
      setLlmConfig(updated);
      setUserAnthropicKey('');
      setLlmTestStatus({
        loading: false,
        ok: true,
        message: `Connected ${account.email} to Claude Pro & Team subscription!`,
      });
      playBeep('complete');
    } catch (err: any) {
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: err?.message || 'Connection failed.',
      });
      playBeep('error');
    } finally {
      setIsConnectingSubscription(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSigningInGoogle(true);
    setLlmTestStatus({ loading: true, message: 'Launching Google Account Sign-In (GIS / OAuth)...' });
    playBeep('tap');
    try {
      const targetClientId = googleClientIdInput.trim() || llmConfig.googleClientId;
      const account = await initiateGoogleSignIn({
        clientId: targetClientId,
        userEmail: userGoogleEmail.trim() || undefined,
      });
      const updated = loadLLMProviderConfig();
      setLlmConfig(updated);
      setLlmTestStatus({
        loading: false,
        ok: true,
        message: `Signed in as ${account.email}. Connected to ${account.planName}!`,
      });
      playBeep('complete');
    } catch (err: any) {
      if (
        err?.message?.includes('Client ID is required') ||
        err?.message?.includes('Client ID required')
      ) {
        setShowClientIdInput(true);
      }
      setLlmTestStatus({
        loading: false,
        ok: false,
        message: err?.message || 'Google sign-in could not be completed.',
      });
      playBeep('error');
    } finally {
      setIsSigningInGoogle(false);
    }
  };

  const handleDisconnectSubscription = (pId: LLMProviderType) => {
    playBeep('tap');
    const updated = disconnectSubscriptionAccount(pId);
    setLlmConfig(updated);
    setLlmTestStatus({
      loading: false,
      message: `Disconnected ${pId.toUpperCase()} subscription. Switched to developer standby.`,
    });
  };

  const handleSaveGoogleClientId = () => {
    playBeep('tap');
    const nextConfig = {
      ...llmConfig,
      googleClientId: googleClientIdInput.trim(),
    };
    saveLLMProviderConfig(nextConfig);
    setLlmConfig(nextConfig);
    setShowClientIdInput(false);
    setLlmTestStatus({
      loading: false,
      ok: true,
      message: 'Google OAuth Client ID saved.',
    });
  };

  const handleTestLlm = async (modeOverride?: AuthMode) => {
    setLlmTestStatus({ loading: true, message: undefined });
    playBeep('tap');
    try {
      const mode = modeOverride || llmConfig.authMode;
      saveLLMProviderConfig({ ...llmConfig, authMode: mode });
      const res = await testLLMProviderConnection(llmConfig, theme.id, mode);
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

  const handleRechargeTokens = () => {
    playBeep('complete');
    onUpdatePreferences({
      ...preferences,
      usedTokens: 0,
    });
  };

  const handleSaveAll = () => {
    saveLLMProviderConfig(llmConfig);
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
              {llmConfig.providerId.toUpperCase()} · {llmConfig.modelName}
            </span>
          </div>

          {/* Authentication Mode Switcher: Subscription Plans vs Developer BYOK */}
          <div className="grid grid-cols-2 gap-2 bg-[#141724] p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => handleSwitchAuthMode('subscription')}
              className={`py-2 px-2.5 rounded-lg text-xs font-mono-tabular flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                llmConfig.authMode === 'subscription'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/60 font-bold shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>SUBSCRIPTION PLANS</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchAuthMode('apikey')}
              className={`py-2 px-2.5 rounded-lg text-xs font-mono-tabular flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                llmConfig.authMode === 'apikey'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/60 font-bold shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>API KEY (BYOK)</span>
            </button>
          </div>

          {/* Provider Selection Tabs */}
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(DEFAULT_PROVIDER_CONFIGS) as LLMProviderType[]).map((pId) => {
              const meta = DEFAULT_PROVIDER_CONFIGS[pId];
              const plan = SUBSCRIPTION_PLANS[pId];
              const isSelected = llmConfig.providerId === pId;
              const isConnected = llmConfig.connectedAccounts?.[pId]?.status === 'connected';

              return (
                <button
                  key={pId}
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    setLlmConfig({
                      ...llmConfig,
                      providerId: pId,
                      endpoint: meta.defaultEndpoint,
                      modelName: meta.defaultModel,
                    });
                  }}
                  className={`p-2.5 rounded-xl border text-left text-xs transition-colors cursor-pointer flex flex-col gap-1 relative overflow-hidden ${
                    isSelected
                      ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200 font-semibold'
                      : 'bg-[#12151f] border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tabular text-[11px] font-bold">{meta.label}</span>
                    {llmConfig.authMode === 'subscription' && isConnected && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Connected" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 truncate">
                    {llmConfig.authMode === 'subscription' ? plan.badge : meta.defaultModel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* SUBSCRIPTION PLAN AUTH VIEW */}
          {llmConfig.authMode === 'subscription' ? (
            <div className="flex flex-col gap-3 pt-1">
              {/* GOOGLE GEMINI SUBSCRIPTION (GOOGLE AI PRO) */}
              {llmConfig.providerId === 'gemini' && (
                <div className="rounded-xl border border-cyan-900/60 bg-[#0c121d] p-3 flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center p-1">
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                          <span>Google AI Pro Plan</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 border border-cyan-500/50 text-cyan-300 font-mono-tabular">
                            GEMINI ADVANCED
                          </span>
                        </h4>
                        <p className="text-[11px] text-slate-400">
                          Google One AI Premium & Gemini Advanced Subscription
                        </p>
                      </div>
                    </div>
                  </div>

                  {authenticatedGoogleEmail && (
                    <div className="p-2 bg-[#091524] border border-cyan-500/40 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-emerald-400" />
                        <div>
                          <div className="text-[10px] text-cyan-400 font-mono-tabular uppercase font-bold">
                            Verified Google Identity (GIS)
                          </div>
                          <div className="text-xs text-slate-100 font-medium">
                            {authenticatedGoogleName || 'Google User'} ({authenticatedGoogleEmail})
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {llmConfig.connectedAccounts?.gemini?.status === 'connected' ? (
                    <div className="p-3 bg-[#111e2e] border border-cyan-500/40 rounded-lg flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-cyan-600/30 border border-cyan-400/50 flex items-center justify-center font-bold text-cyan-200 text-xs">
                            {llmConfig.connectedAccounts.gemini.email?.charAt(0).toUpperCase() || 'G'}
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                              <span>{llmConfig.connectedAccounts.gemini.displayName || 'Google Account'}</span>
                              <span className="text-[10px] text-emerald-400 font-mono-tabular font-bold">● CONNECTED</span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono-tabular">
                              {llmConfig.connectedAccounts.gemini.email}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDisconnectSubscription('gemini')}
                          className="px-2 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-[11px] text-red-200 cursor-pointer transition-colors"
                          title="Disconnect Google Account"
                        >
                          Disconnect
                        </button>
                      </div>
                      <p className="text-[11px] text-cyan-300/80 leading-relaxed">
                        Authorized for Gemini 3.8 Flash / 3.5 Flash Lite inference with 1M token context, multimodal vision, and Google Search Grounding.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">Your Google Account Email</label>
                        <input
                          type="email"
                          value={userGoogleEmail}
                          onChange={(e) => setUserGoogleEmail(e.target.value)}
                          placeholder="e.g. yourname@gmail.com (Enter your own Google email)"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">Google AI Pro Key or Bearer Token</label>
                        <input
                          type="password"
                          value={userGoogleKey}
                          onChange={(e) => setUserGoogleKey(e.target.value)}
                          placeholder="AIzaSy... (API Key from AI Studio) or OAuth token"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleConnectGoogleSubscription}
                        disabled={isConnectingSubscription || !userGoogleEmail.trim() || !userGoogleKey.trim()}
                        className="w-full min-h-[38px] px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isConnectingSubscription ? 'Verifying Google Account...' : 'Connect Google AI Pro Account'}</span>
                      </button>

                      <div className="flex items-center gap-2 my-0.5">
                        <div className="h-px bg-slate-800 flex-1" />
                        <span className="text-[10px] text-slate-500 font-mono-tabular uppercase">or sign in with google</span>
                        <div className="h-px bg-slate-800 flex-1" />
                      </div>

                      {/* Official Google Identity Services Sign-In Button */}
                      <GoogleAuthButton
                        clientId={googleClientIdInput.trim() || llmConfig.googleClientId}
                        onSuccess={(email, name) => {
                          setAuthenticatedGoogleEmail(email);
                          setAuthenticatedGoogleName(name);
                          const updated = loadLLMProviderConfig();
                          setLlmConfig(updated);
                          setLlmTestStatus({
                            loading: false,
                            ok: true,
                            message: `Google Sign-In verified for ${name} (${email})! Google AI Pro active.`,
                          });
                          playBeep('complete');
                        }}
                      />

                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={isSigningInGoogle}
                        className="w-full min-h-[36px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                      >
                        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                        </svg>
                        <span>{isSigningInGoogle ? 'Signing into Google...' : 'Launch Google Sign-In Popup'}</span>
                      </button>

                      <div className="text-[11px] text-slate-400 space-y-1 pl-1">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Check className="w-3 h-3 text-cyan-400" />
                          <span>1M context window & zero rate-limit throttling</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <Check className="w-3 h-3 text-cyan-400" />
                          <span>Native Google Search Grounding on every turn</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Custom OAuth Client ID Toggle */}
                  <div className="pt-1 border-t border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => setShowClientIdInput(!showClientIdInput)}
                      className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                    >
                      {showClientIdInput ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      <span>Advanced: Custom Google OAuth Client ID</span>
                    </button>

                    {showClientIdInput && (
                      <div className="mt-2 p-2.5 bg-[#0a0f17] border border-slate-800 rounded-lg flex flex-col gap-2">
                        <input
                          type="text"
                          value={googleClientIdInput}
                          onChange={(e) => setGoogleClientIdInput(e.target.value)}
                          placeholder="apps.googleusercontent.com Client ID"
                          className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1.5 text-[11px] font-mono-tabular text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                        <button
                          type="button"
                          onClick={handleSaveGoogleClientId}
                          className="self-end px-3 py-1 bg-cyan-900 hover:bg-cyan-800 text-cyan-200 text-xs rounded font-medium cursor-pointer"
                        >
                          Save Client ID
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* OPENAI CHATGPT PLUS/PRO SUBSCRIPTION */}
              {llmConfig.providerId === 'openai' && (
                <div className="rounded-xl border border-emerald-900/60 bg-[#0c1815] p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                        <span>ChatGPT Plus & Pro</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 font-mono-tabular">
                          SUBSCRIPTION
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400">OpenAI ChatGPT Plus or Pro Subscription Plan</p>
                    </div>
                  </div>

                  {llmConfig.connectedAccounts?.openai?.status === 'connected' ? (
                    <div className="p-3 bg-[#11241e] border border-emerald-500/40 rounded-lg flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          {llmConfig.connectedAccounts.openai.displayName || llmConfig.connectedAccounts.openai.email}
                        </div>
                        <div className="text-[11px] text-emerald-400 font-mono-tabular">● {llmConfig.connectedAccounts.openai.email} CONNECTED</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDisconnectSubscription('openai')}
                        className="px-2 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-[11px] text-red-200 cursor-pointer"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">Your OpenAI Account Email</label>
                        <input
                          type="email"
                          value={userOpenAIEmail}
                          onChange={(e) => setUserOpenAIEmail(e.target.value)}
                          placeholder="e.g. user@domain.com"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">ChatGPT Plus / Pro Key or Token</label>
                        <input
                          type="password"
                          value={userOpenAIKey}
                          onChange={(e) => setUserOpenAIKey(e.target.value)}
                          placeholder="sk-... (API key or platform token)"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectOpenAISubscription}
                        disabled={isConnectingSubscription || !userOpenAIEmail.trim() || !userOpenAIKey.trim()}
                        className="w-full min-h-[38px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isConnectingSubscription ? 'Verifying...' : 'Connect ChatGPT Plus / Pro Account'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ANTHROPIC CLAUDE PRO SUBSCRIPTION */}
              {llmConfig.providerId === 'anthropic' && (
                <div className="rounded-xl border border-amber-900/60 bg-[#19140e] p-3 flex flex-col gap-2.5">
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                      <span>Claude Pro & Team</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-950 border border-amber-500/50 text-amber-300 font-mono-tabular">
                        SUBSCRIPTION
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-400">Anthropic Claude Pro Subscription Plan</p>
                  </div>

                  {llmConfig.connectedAccounts?.anthropic?.status === 'connected' ? (
                    <div className="p-3 bg-[#241c14] border border-amber-500/40 rounded-lg flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-200">
                          {llmConfig.connectedAccounts.anthropic.displayName || llmConfig.connectedAccounts.anthropic.email}
                        </div>
                        <div className="text-[11px] text-amber-400 font-mono-tabular">● {llmConfig.connectedAccounts.anthropic.email} CONNECTED</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDisconnectSubscription('anthropic')}
                        className="px-2 py-1 rounded bg-red-950/60 hover:bg-red-900 border border-red-700/60 text-[11px] text-red-200 cursor-pointer"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">Your Anthropic Account Email</label>
                        <input
                          type="email"
                          value={userAnthropicEmail}
                          onChange={(e) => setUserAnthropicEmail(e.target.value)}
                          placeholder="e.g. user@domain.com"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-slate-300 font-medium">Claude Pro / Team Key or Token</label>
                        <input
                          type="password"
                          value={userAnthropicKey}
                          onChange={(e) => setUserAnthropicKey(e.target.value)}
                          placeholder="sk-ant-... (API key or session token)"
                          className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectAnthropicSubscription}
                        disabled={isConnectingSubscription || !userAnthropicEmail.trim() || !userAnthropicKey.trim()}
                        className="w-full min-h-[38px] px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isConnectingSubscription ? 'Verifying...' : 'Connect Claude Pro Account'}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* GROQ LPU INFERENCE */}
              {llmConfig.providerId === 'groq' && (
                <div className="rounded-xl border border-orange-900/60 bg-[#170e0a] p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                        <span>Groq Cloud LPU Inference</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-950 border border-orange-500/50 text-orange-300 font-mono-tabular">
                          GROQ LPU
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-400">Sub-second real-time inference with Llama 3.3 and DeepSeek R1.</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-orange-300/80 leading-relaxed">
                    Powered by Groq LPUs. Configure your Groq API key (gsk_...) in the API Key (BYOK) tab for instantaneous streaming.
                  </p>
                </div>
              )}

              {/* OLLAMA AIR-GAPPED */}
              {llmConfig.providerId === 'ollama' && (
                <div className="rounded-xl border border-slate-800 bg-[#0d0f17] p-3 flex flex-col gap-2">
                  <div className="text-xs font-bold text-slate-200">Local Workstation Air-Gapped Engine</div>
                  <p className="text-[11px] text-slate-400">Running directly on local hardware without cloud subscriptions.</p>
                  <input
                    type="text"
                    value={llmConfig.endpoint}
                    onChange={(e) => setLlmConfig({ ...llmConfig, endpoint: e.target.value })}
                    placeholder="http://localhost:11434"
                    className="w-full bg-[#12151f] border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
                  />
                </div>
              )}

              {/* Model Selector for Subscription */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-slate-300 font-medium">Select Plan Model</label>
                <div className="flex flex-wrap gap-1.5">
                  {(SUBSCRIPTION_PLANS[llmConfig.providerId]?.recommendedModels || [llmConfig.modelName]).map((m) => {
                    const isMSelected = llmConfig.modelName === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          playBeep('tap');
                          const nextConfig = { ...llmConfig, modelName: m };
                          saveLLMProviderConfig(nextConfig);
                          setLlmConfig(nextConfig);
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-mono-tabular border cursor-pointer transition-colors ${
                          isMSelected
                            ? 'bg-cyan-900/60 border-cyan-400 text-cyan-200 font-bold'
                            : 'bg-[#12151f] border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* MULTI-PROVIDER BYOK KEY VAULT VIEW */
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
                    {llmConfig.providerId.toUpperCase()}
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
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => handleTestLlm(llmConfig.authMode)}
              disabled={llmTestStatus.loading}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/60 text-xs font-medium text-cyan-200 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${llmTestStatus.loading ? 'animate-spin' : ''}`} />
              <span>{llmTestStatus.loading ? 'Testing Link...' : `Test ${llmConfig.providerId.toUpperCase()} Connection (${llmConfig.authMode === 'subscription' ? 'Subscription' : 'BYOK'})`}</span>
            </button>
          </div>

          {llmTestStatus.message && (
            <p className={`text-xs font-mono-tabular ${llmTestStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {llmTestStatus.message}
            </p>
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

        {/* Battery / Token Gauge Reset & Audio Toggle */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              ambientAudioService.setAmbientEnabled(next, next);
            }}
            className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
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

          <button
            type="button"
            onClick={handleRechargeTokens}
            className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <BatteryCharging className="w-4 h-4 text-amber-400" />
            <span>Recharge Battery</span>
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
