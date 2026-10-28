import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  Trash2,
  Lock,
  Globe,
  Radio,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import {
  PluginAuthCredential,
  getPluginCredential,
  savePluginCredential,
  clearPluginCredential,
  maskCredential,
  isPluginAuthenticated,
} from '../engine/pluginAuthManager';
import { initiateAppConnection } from '../services/ComposioService';

export interface PluginAuthTarget {
  id: string;
  name: string;
  description?: string;
  toolFunctionName?: string;
  serviceLabel?: string;
  accountHandle?: string;
  connected?: boolean;
  category?: string;
}

export interface PluginAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  plugin: PluginAuthTarget | null;
  onAuthorized?: (pluginId: string, credential: PluginAuthCredential) => void;
  onRevoked?: (pluginId: string) => void;
}

/**
 * Returns contextual guidance text for common plugins.
 */
function getPluginGuidance(pluginId: string): { label: string; placeholder: string; hint: string } {
  const clean = pluginId.toLowerCase();
  if (clean.includes('search') || clean.includes('wiki')) {
    return {
      label: 'Search API Key / Token',
      placeholder: 'Optional: Enter SerpApi, Tavily, or leave blank for Wiki REST',
      hint: 'Leave blank to utilize the default free Wikipedia/DuckDuckGo client endpoints, or provide a BYOK key for live web scraping.',
    };
  }
  if (clean.includes('github')) {
    return {
      label: 'GitHub Personal Access Token',
      placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      hint: 'Create a personal access token (classic or fine-grained) with "repo" or "public_repo" scope at github.com/settings/tokens.',
    };
  }
  if (clean.includes('slack')) {
    return {
      label: 'Slack Webhook URL or Bot Token',
      placeholder: 'https://hooks.slack.com/services/... or xoxb-...',
      hint: 'Incoming Webhook URL from your Slack app settings, or a bot user OAuth token with chat:write permissions.',
    };
  }
  if (clean.includes('calendar') || clean.includes('google')) {
    return {
      label: 'Google API Key or OAuth Bearer Token',
      placeholder: 'ya29.xxxxxxxxxxxxxxxxxxxx or AIzaSy...',
      hint: 'Client-side OAuth access token or Google Cloud API Key with Calendar API v3 enabled.',
    };
  }
  if (clean.includes('gateway') || clean.includes('fetch') || clean.includes('api')) {
    return {
      label: 'API Key / Bearer Token / Webhook Secret',
      placeholder: 'Bearer xxxxxxxxxxxx or API key...',
      hint: 'Authentication credentials attached to outgoing REST or Webhook payloads from the client safehouse.',
    };
  }
  if (clean.includes('sandbox') || clean.includes('code')) {
    return {
      label: 'Compute Runtime Passphrase (Optional)',
      placeholder: 'Optional execution auth token...',
      hint: 'Local client sandbox executes safe JS IIFEs without requiring external cloud credentials.',
    };
  }
  if (clean.includes('fs') || clean.includes('storage')) {
    return {
      label: 'IndexedDB Vault Passphrase (Optional)',
      placeholder: 'Optional local encryption key...',
      hint: 'IndexedDB storage operates locally within your browser sandbox.',
    };
  }
  if (clean.includes('memory') || clean.includes('lookup')) {
    return {
      label: 'Vector Provider Key (Optional)',
      placeholder: 'Optional embeddings API key...',
      hint: 'Queries Dexie.js local ledger and client-side keyword indices. Cloud vector models are optional.',
    };
  }
  if (clean.includes('composio')) {
    return {
      label: 'Composio Project API Key (Optional Override)',
      placeholder: 'ak_... or leave blank for Cloudflare Pages proxy',
      hint: 'Leave blank to use the secure Cloudflare server-side proxy on pixelops.app, or provide your personal Composio project key to override.',
    };
  }
  return {
    label: 'API Key / Access Token / Secret',
    placeholder: 'Enter your authorization token or secret key...',
    hint: 'Credentials are stored securely in browser localStorage/IndexedDB under your BYOK configuration.',
  };
}

function getComposioAppName(pluginId: string): string | null {
  const clean = pluginId.toLowerCase();
  if (clean.includes('github')) return 'github';
  if (clean.includes('slack')) return 'slack';
  if (clean.includes('gmail') || clean.includes('google') || clean.includes('calendar')) return 'gmail';
  if (clean.includes('notion')) return 'notion';
  if (clean.includes('linear')) return 'linear';
  if (clean.includes('composio')) return 'github';
  return null;
}

export const PluginAuthModal: React.FC<PluginAuthModalProps> = ({
  isOpen,
  onClose,
  plugin,
  onAuthorized,
  onRevoked,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [accountHandle, setAccountHandle] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [existingCred, setExistingCred] = useState<PluginAuthCredential | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isConnectingComposio, setIsConnectingComposio] = useState(false);

  // Sync state whenever modal opens or active plugin changes
  useEffect(() => {
    if (isOpen && plugin) {
      const stored = getPluginCredential(plugin.id);
      if (stored) {
        setExistingCred(stored);
        setApiKey(stored.apiKey || stored.accessToken || '');
        setAccountHandle(stored.accountHandle || '');
        setEndpointUrl(stored.endpointUrl || '');
      } else {
        setExistingCred(null);
        setApiKey('');
        setAccountHandle('');
        setEndpointUrl('');
      }
      setStatusMessage(null);
      setShowPassword(false);
    }
  }, [isOpen, plugin]);

  if (!isOpen || !plugin) return null;

  const isConfigured = Boolean(
    existingCred &&
    ((existingCred.apiKey && existingCred.apiKey.trim().length > 0) ||
      (existingCred.accessToken && existingCred.accessToken.trim().length > 0))
  );

  const guidance = getPluginGuidance(plugin.id);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const trimmedKey = apiKey.trim();
      const trimmedHandle = accountHandle.trim() || `${plugin.id}@local-safehouse`;
      const trimmedUrl = endpointUrl.trim();

      const saved = savePluginCredential(plugin.id, {
        apiKey: trimmedKey,
        accountHandle: trimmedHandle,
        endpointUrl: trimmedUrl || undefined,
      });

      setExistingCred(saved);
      setStatusMessage({
        text: `CREDENTIALS SAVED // ${trimmedKey ? 'AUTH ACTIVE' : 'OPEN CLIENT READY'}`,
        type: 'success',
      });

      onAuthorized?.(plugin.id, saved);

      // Auto dismiss success toast after 2.5s
      setTimeout(() => {
        setStatusMessage(null);
      }, 2500);
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || 'Failed to save credentials locally.',
        type: 'error',
      });
    }
  };

  const handleComposioOAuth = async () => {
    const app = getComposioAppName(plugin.id);
    if (!app) return;
    setIsConnectingComposio(true);
    try {
      const res = await initiateAppConnection(app);
      setStatusMessage({
        type: 'info',
        text: res.connectionUrl
          ? `[Composio OAuth] Authorization popup opened for ${app.toUpperCase()}. Complete sign-in to authorize.`
          : `[Composio OAuth] Connection active for ${app.toUpperCase()}.`,
      });
      const saved = savePluginCredential(plugin.id, {
        apiKey: 'composio-oauth-linked',
        accountHandle: accountHandle || `${app}_user`,
      });
      setExistingCred(saved);
      onAuthorized?.(plugin.id, saved);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Composio connect failed: ${err?.message || err}`,
      });
    } finally {
      setIsConnectingComposio(false);
    }
  };

  const handleDisconnect = () => {
    try {
      clearPluginCredential(plugin.id);
      setExistingCred(null);
      setApiKey('');
      setAccountHandle('');
      setEndpointUrl('');
      setStatusMessage({
        text: 'TOKEN REVOKED // CREDENTIAL REMOVED FROM SAFEHOUSE',
        type: 'info',
      });
      onRevoked?.(plugin.id);

      setTimeout(() => {
        setStatusMessage(null);
      }, 2500);
    } catch (err: any) {
      setStatusMessage({
        text: err?.message || 'Failed to clear credential.',
        type: 'error',
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-3 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
      style={{
        paddingTop: 'max(10px, env(safe-area-inset-top, 10px))',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
        paddingLeft: 'max(10px, env(safe-area-inset-left, 10px))',
        paddingRight: 'max(10px, env(safe-area-inset-right, 10px))',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#100e0b] border shadow-2xl rounded-sm flex flex-col font-mono-tabular text-sm text-[#e8dcc4] my-auto"
        style={{
          borderColor: 'var(--theme-border-color, #e59838)',
          boxShadow: '0 0 30px rgba(0,0,0,0.8), 0 0 15px var(--theme-glow-soft, rgba(229,152,56,0.25))',
        }}
      >
        {/* Header Bar */}
        <div
          className="bg-[#211a12] border-b px-4 py-3 flex items-center justify-between select-none"
          style={{ borderColor: 'var(--theme-border-color, #e59838)' }}
        >
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-[#e59838]" />
            <span className="font-bold uppercase tracking-wider text-xs sm:text-sm text-[#f3ead8]">
              BYOK Auth Gateway // {plugin.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#b8a690] hover:text-[#f3ead8] hover:bg-[#342618] rounded transition-colors cursor-pointer"
            title="Close [ESC]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plugin Metadata Subheader */}
        <div className="px-4 py-2.5 bg-[#17130e] border-b border-[#2e2114] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#8c7a65]">TOOL:</span>
            <span className="text-[#e59838] font-bold">{plugin.toolFunctionName || plugin.id}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#8c7a65]">STATUS:</span>
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 text-[#4ade80] font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                [AUTHORIZED // AES-GCM]
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[#e59838]">
                <AlertTriangle className="w-3.5 h-3.5" />
                [UNAUTHENTICATED / BYOK READY]
              </span>
            )}
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-4 flex flex-col gap-3.5">
          {plugin.description && (
            <p className="text-xs text-[#b8a690] leading-relaxed bg-[#14100c] p-2.5 rounded border border-[#2b2015]">
              {plugin.description}
            </p>
          )}

          {/* Composio Instant 1-Click OAuth Connect */}
          {getComposioAppName(plugin.id) && (
            <div className="p-3 bg-[#101926] border border-[#1d3d63] rounded flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#60a5fa] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#38bdf8]" />
                  Instant 1-Click OAuth (Composio)
                </span>
                <span className="text-[10px] bg-[#1e293b] text-[#93c5fd] px-1.5 py-0.5 rounded border border-[#2563eb]/40 font-mono">
                  Isolated Entity ID
                </span>
              </div>
              <p className="text-[11px] text-[#94a3b8] leading-tight">
                Authorize your {getComposioAppName(plugin.id)?.toUpperCase()} account securely without generating manual API tokens.
              </p>
              <button
                type="button"
                onClick={handleComposioOAuth}
                disabled={isConnectingComposio}
                className="w-full py-1.5 px-3 bg-[#2563eb] hover:bg-[#1d4ed8] text-white rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-[0_0_10px_rgba(37,99,235,0.3)]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>
                  {isConnectingComposio
                    ? 'Connecting to Composio...'
                    : `Connect ${getComposioAppName(plugin.id)?.toUpperCase()} with Composio`}
                </span>
              </button>
            </div>
          )}

          {/* Primary Key Input */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="plugin-auth-apikey" className="font-bold text-[#f3ead8] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#e59838]" />
                {guidance.label}
              </label>
              {isConfigured && existingCred?.apiKey && (
                <span className="text-[10px] text-[#4ade80]">
                  Current: {maskCredential(existingCred.apiKey)}
                </span>
              )}
            </div>

            <div className="relative">
              <input
                id="plugin-auth-apikey"
                type={showPassword ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={guidance.placeholder}
                className="w-full px-3 py-2 bg-[#0c0a08] border border-[#3d2e1d] focus:border-[#e59838] focus:outline-none rounded text-xs text-[#f3ead8] placeholder:text-[#635544] pr-10"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c7a65] hover:text-[#e59838] transition-colors p-1"
                title={showPassword ? 'Hide Secret' : 'Show Secret'}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <p className="text-[11px] text-[#8c7a65] leading-snug">
              {guidance.hint}
            </p>
          </div>

          {/* Advanced / Optional Credentials Toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-[#e59838] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>{showAdvanced ? '[-] Hide Custom Endpoint & Handle' : '[+] Custom Endpoint & Handle (Optional)'}</span>
            </button>

            {showAdvanced && (
              <div className="mt-2.5 pt-2.5 border-t border-[#261d12] flex flex-col gap-2.5 animate-in fade-in duration-100">
                <div className="flex flex-col gap-1">
                  <label htmlFor="plugin-auth-handle" className="text-xs text-[#b8a690]">
                    Account Handle / Identity Tag:
                  </label>
                  <input
                    id="plugin-auth-handle"
                    type="text"
                    value={accountHandle}
                    onChange={(e) => setAccountHandle(e.target.value)}
                    placeholder="e.g. operative@field-net or user-12"
                    className="w-full px-2.5 py-1.5 bg-[#0c0a08] border border-[#3d2e1d] focus:border-[#e59838] focus:outline-none rounded text-xs text-[#f3ead8] placeholder:text-[#635544]"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="plugin-auth-endpoint" className="text-xs text-[#b8a690]">
                    Custom REST / Webhook Base URL:
                  </label>
                  <input
                    id="plugin-auth-endpoint"
                    type="text"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://api.custom-service.internal/v1"
                    className="w-full px-2.5 py-1.5 bg-[#0c0a08] border border-[#3d2e1d] focus:border-[#e59838] focus:outline-none rounded text-xs text-[#f3ead8] placeholder:text-[#635544]"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Status Toast Banner */}
          {statusMessage && (
            <div
              className={`px-3 py-2 rounded text-xs flex items-center gap-2 border ${
                statusMessage.type === 'success'
                  ? 'bg-[#12281a] border-[#22c55e]/50 text-[#4ade80]'
                  : statusMessage.type === 'error'
                  ? 'bg-[#2b1414] border-[#ef4444]/50 text-[#f87171]'
                  : 'bg-[#1f1911] border-[#e59838]/50 text-[#f59e0b]'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              ) : statusMessage.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <Terminal className="w-4 h-4 shrink-0" />
              )}
              <span className="flex-1">{statusMessage.text}</span>
            </div>
          )}

          {/* Action Button Row */}
          <div className="pt-2 border-t border-[#261d12] flex items-center justify-between gap-2">
            <div>
              {isConfigured && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3 py-1.5 bg-[#211616] hover:bg-[#341b1b] text-[#f87171] border border-[#7f1d1d] rounded text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Remove local key and revoke authorization"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>[Disconnect / Revoke]</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 bg-[#1b1712] hover:bg-[#28211a] text-[#b8a690] border border-[#3d2e1d] rounded text-xs transition-colors cursor-pointer"
              >
                [Cancel]
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-[#e59838] hover:bg-[#f5a742] text-[#121110] border border-[#f5a742] rounded text-xs font-bold transition-all shadow-[0_0_12px_rgba(229,152,56,0.4)] cursor-pointer flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>[Save & Authorize]</span>
              </button>
            </div>
          </div>
        </form>

        {/* Footer Audit Notice */}
        <div className="px-4 py-2 bg-[#0c0a08] border-t border-[#1f170f] text-[10px] text-[#6b5d4f] flex items-center justify-between">
          <span>🔒 Pure Client-Side PWA Storage (No Backend Intermediary)</span>
          <span>IndexedDB / LocalStorage</span>
        </div>
      </div>
    </div>
  );
};

export default PluginAuthModal;
