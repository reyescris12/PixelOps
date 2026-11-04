import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ComposioService,
  ComposioIntegration,
  CURATED_COMPOSIO_INTEGRATIONS,
  getOrCreateEntityId,
  getComposioApiKey,
  setComposioApiKey,
  pingComposio,
  normalizeAppSlug,
  getLocalConnectedAccounts,
  getConnectedAccounts,
  ComposioConnectedAccount,
} from '../services/ComposioService';

interface PluginMarketplaceProps {
  onPluginStatusChange?: () => void;
  onClose?: () => void;
}

const CATEGORIES = [
  'All',
  'Connected',
  'Developer',
  'Communication',
  'Productivity',
  'Project Management',
  'Finance',
] as const;

type CategoryFilter = (typeof CATEGORIES)[number];

export const PluginMarketplace: React.FC<PluginMarketplaceProps> = ({
  onPluginStatusChange,
  onClose,
}) => {
  // Initialize catalog immediately hydrated with locally verified active accounts
  const [integrations, setIntegrations] = useState<ComposioIntegration[]>(() => {
    const localAccounts = getLocalConnectedAccounts();
    const localMap = new Map(localAccounts.map((a) => [normalizeAppSlug(a.appName), a]));
    return CURATED_COMPOSIO_INTEGRATIONS.map((item) => {
      const acc = localMap.get(normalizeAppSlug(item.appName));
      const isOnline = acc && acc.status !== 'FAILED' && acc.status !== 'EXPIRED';
      return {
        ...item,
        connected: Boolean(isOnline),
        connectionId: acc?.id,
      };
    });
  });
  const [loading, setLoading] = useState(false);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Diagnostics Modal state
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState<{
    accounts: ComposioConnectedAccount[];
    ping: { ok: boolean; status?: number; latencyMs?: number; error?: string };
  } | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // BYOK Composio API Key state
  const [apiKey, setApiKey] = useState(() => getComposioApiKey());
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [inputApiKey, setInputApiKey] = useState(() => getComposioApiKey());
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [entityId, setEntityId] = useState(() => getOrCreateEntityId());

  const isRefreshingRef = useRef(false);
  const lastRefreshTimeRef = useRef(0);

  // Fetch available integrations and annotate with live connection status
  const refreshIntegrations = useCallback(async (isInitial = false) => {
    const now = Date.now();
    if (isRefreshingRef.current) return;
    if (!isInitial && now - lastRefreshTimeRef.current < 2000) return;

    try {
      isRefreshingRef.current = true;
      lastRefreshTimeRef.current = now;
      if (isInitial) {
        setLoading(true);
      }
      const items = await ComposioService.getAvailableIntegrations();
      if (items && items.length > 0) {
        setIntegrations(items);
      }
    } catch (err: any) {
      console.error('[ARMORY MARKETPLACE FETCH ERROR]', err);
    } finally {
      isRefreshingRef.current = false;
      if (isInitial) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshIntegrations(true);

    let debounceTimer: any = null;
    const handleSync = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshIntegrations(false);
      }, 500);
    };

    const handleEntityChanged = (e: any) => {
      if (e.detail?.entityId) {
        setEntityId(e.detail.entityId);
        refreshIntegrations(false);
      }
    };

    const handleApiKeyChanged = (e: any) => {
      const newKey = e.detail?.apiKey ?? getComposioApiKey();
      setApiKey(newKey);
      setInputApiKey(newKey);
      refreshIntegrations(false);
    };

    window.addEventListener('focus', handleSync);
    window.addEventListener('composio:connection-updated', handleSync);
    window.addEventListener('composio:session-synced', handleSync);
    window.addEventListener('composio:entity-changed', handleEntityChanged);
    window.addEventListener('composio:api-key-changed', handleApiKeyChanged);

    // In-memory sync without network refetch to eliminate infinite re-render loops
    const unsubscribe = ComposioService.subscribeToConnectionChanges?.((accounts) => {
      if (Array.isArray(accounts)) {
        setIntegrations((prev) => {
          const map = new Map(accounts.map((a) => [normalizeAppSlug(a.appName), a]));
          return prev.map((item) => {
            const acc = map.get(normalizeAppSlug(item.appName));
            if (acc) {
              const isOnline = acc.status !== 'FAILED' && acc.status !== 'EXPIRED';
              return {
                ...item,
                connected: isOnline,
                connectionId: acc.id || item.connectionId,
              };
            }
            return item;
          });
        });
      }
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', handleSync);
      window.removeEventListener('composio:connection-updated', handleSync);
      window.removeEventListener('composio:session-synced', handleSync);
      window.removeEventListener('composio:entity-changed', handleEntityChanged);
      window.removeEventListener('composio:api-key-changed', handleApiKeyChanged);
      unsubscribe?.();
    };
  }, [refreshIntegrations]);

  // Connect App Trigger
  const handleConnect = async (app: ComposioIntegration) => {
    setConnectingApp(app.appName);
    setFeedbackMessage({
      text: `[OAUTH INITIATED] Connecting ${app.name} for Commander (${entityId.slice(0, 18)}...)... Follow the popup prompt.`,
      type: 'info',
    });

    try {
      const res = await ComposioService.initiateAppConnection(app.appName);
      if (res.redirectUrl || res.connectionUrl) {
        setFeedbackMessage({
          text: `[OAUTH POPUP OPENED] Authorization window opened for ${app.name}. Complete sign-in in popup to link account.`,
          type: 'info',
        });
      } else {
        setFeedbackMessage({
          text: `[CONNECT SIGNAL SENT] Connection initiated for ${app.name}.`,
          type: 'info',
        });
      }

      // Automatically sync as soon as popup closes or completion is reported
      if (typeof res.waitForCompletion === 'function') {
        res.waitForCompletion().then((completed: boolean) => {
          if (completed) {
            setIntegrations((prev) =>
              prev.map((item) => {
                if (normalizeAppSlug(item.appName) === normalizeAppSlug(app.appName)) {
                  return {
                    ...item,
                    connected: true,
                    connectionId: res.connectionId || item.connectionId || `conn_${app.appName}`,
                  };
                }
                return item;
              })
            );
            setFeedbackMessage({
              text: `[CONNECTION ACTIVE] ${app.name} connected successfully! Live tool schemas calibrated for agents.`,
              type: 'success',
            });
          }
          refreshIntegrations();
          onPluginStatusChange?.();
        });
      }

      // Immediate staggered polling backup
      setTimeout(() => {
        refreshIntegrations();
        onPluginStatusChange?.();
      }, 2500);
      setTimeout(() => {
        refreshIntegrations();
        onPluginStatusChange?.();
      }, 5000);
    } catch (err: any) {
      const errStr = String(err?.message || err);
      const isMissingKey =
        errStr.includes('COMPOSIO_API_KEY_MISSING') ||
        errStr.includes('No Composio API key configured') ||
        errStr.includes('401') ||
        errStr.includes('unauthorized') ||
        errStr.includes('UNAUTHORIZED');

      if (isMissingKey) {
        setIsApiKeyModalOpen(true);
        setFeedbackMessage({
          text: `[COMPOSIO API KEY REQUIRED] Provide your Composio API key below to link ${app.name} accounts.`,
          type: 'error',
        });
      } else {
        setFeedbackMessage({
          text: `[CONNECTION ERROR] Failed to initiate ${app.name}: ${errStr}`,
          type: 'error',
        });
      }
    } finally {
      setConnectingApp(null);
    }
  };

  // Disconnect App Trigger
  const handleDisconnect = async (app: ComposioIntegration) => {
    if (!app.connectionId) {
      setFeedbackMessage({
        text: `No active connection ID found for ${app.name}.`,
        type: 'error',
      });
      return;
    }

    setDisconnectingId(app.connectionId);
    try {
      const success = await ComposioService.disconnectAccount(app.connectionId);
      if (success) {
        setIntegrations((prev) =>
          prev.map((item) => {
            if (normalizeAppSlug(item.appName) === normalizeAppSlug(app.appName)) {
              return {
                ...item,
                connected: false,
                connectionId: undefined,
              };
            }
            return item;
          })
        );
        setFeedbackMessage({
          text: `[REVOKED] ${app.name} connection disconnected successfully.`,
          type: 'success',
        });
        await refreshIntegrations();
        onPluginStatusChange?.();
      } else {
        setFeedbackMessage({
          text: `[WARNING] Could not disconnect ${app.name}. Check your connection status.`,
          type: 'error',
        });
      }
    } catch (err: any) {
      setFeedbackMessage({
        text: `Disconnect error: ${err?.message || err}`,
        type: 'error',
      });
    } finally {
      setDisconnectingId(null);
    }
  };

  // Filtered List
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((item) => {
      const matchesSearch =
        searchQuery.trim().length === 0 ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.appName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === 'All'
          ? true
          : selectedCategory === 'Connected'
          ? item.connected
          : item.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [integrations, searchQuery, selectedCategory]);

  const connectedCount = useMemo(() => {
    return integrations.filter((i) => i.connected).length;
  }, [integrations]);

  const handleOpenDiagnostics = async () => {
    setIsDiagnosing(true);
    setIsDiagnosticsOpen(true);
    try {
      const [accs, pingRes] = await Promise.all([
        getConnectedAccounts(),
        pingComposio(),
      ]);
      setDiagnosticsData({
        accounts: accs,
        ping: pingRes,
      });
    } catch (err: any) {
      setDiagnosticsData({
        accounts: getLocalConnectedAccounts(),
        ping: { ok: false, error: err?.message || 'Check failed' },
      });
    } finally {
      setIsDiagnosing(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-0">
      <div className="rounded-sm bg-[#121110] border border-[#b47b38] shadow-[0_0_25px_rgba(0,0,0,0.75)] overflow-hidden">
        {/* Armory Tactical Header */}
        <div className="bg-[#231b12] border-b border-[#4a351d] px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">⚔️</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular text-sm sm:text-base font-bold tracking-wider text-[#e59838] uppercase">
                  ARMORY TOOLKIT MARKETPLACE
                </span>
                <span className="px-1.5 py-0.2 bg-[#2d1c0c] border border-[#785732] text-[#f3ead8] text-[10px] font-mono-tabular font-bold">
                  v3.1 REST
                </span>
              </div>
              <p className="font-mono-tabular text-[11px] text-[#b8a690] mt-0.5">
                Browse and authorize external tools. Connected toolkits automatically deploy to Vance, Cipher, and Nyx.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setInputApiKey(getComposioApiKey());
                setTestResult(null);
                setIsApiKeyModalOpen(true);
              }}
              className={`px-2.5 py-1 font-mono-tabular text-xs cursor-pointer flex items-center gap-1.5 transition-colors border ${
                apiKey
                  ? 'bg-[#0f2416] text-[#4ade80] border-[#2d6a4f]'
                  : 'bg-[#2b1c0e] text-[#e59838] border-[#8c5e26] hover:bg-[#3d2714]'
              }`}
              title="Configure custom BYOK Composio API Key from dashboard.composio.dev"
            >
              <span>🔑 {apiKey ? 'BYOK KEY ACTIVE' : 'SET COMPOSIO KEY'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenDiagnostics}
              disabled={isDiagnosing}
              className="px-2.5 py-1 bg-[#1a1410] hover:bg-[#2c2014] text-[#a8957e] hover:text-[#f3ead8] border border-[#523d26] font-mono-tabular text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
              title="Inspect raw connection telemetry and diagnose active plugins"
            >
              <span>{isDiagnosing ? '🔍 Scanning...' : '🔍 Diagnostics'}</span>
            </button>
            <button
              type="button"
              onClick={() => refreshIntegrations(false)}
              disabled={loading}
              className="px-2.5 py-1 bg-[#1a1410] hover:bg-[#2c2014] text-[#e59838] border border-[#785732] font-mono-tabular text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
              title="Sync connection status with backend"
            >
              <span>{loading ? '⟳ Syncing...' : '⟳ Refresh'}</span>
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 py-1 bg-[#2b2116] hover:bg-[#3d2f20] text-[#f3ead8] border border-[#6e5233] font-mono-tabular text-xs cursor-pointer"
              >
                [Close]
              </button>
            )}
          </div>
        </div>

        {/* Security & Commander Entity Banner */}
        <div className="bg-[#0d0c0b] border-b border-[#2a1e12] px-4 py-2 flex flex-wrap items-center justify-between text-[11px] font-mono-tabular gap-2">
          <div className="flex items-center gap-2 text-[#8c7a65]">
            <span>COMMANDER ENTITY:</span>
            <span className="text-[#f3ead8] bg-[#1a1410] px-1.5 py-0.5 border border-[#3a2817] rounded-xs font-bold truncate max-w-[220px] sm:max-w-xs">
              {entityId}
            </span>
            <span className="text-[#4ade80] text-[10px]">[ISOLATED]</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[#e59838]">
              ACTIVE CONNECTIONS: <strong className="text-[#4ade80]">{connectedCount}</strong> / {integrations.length}
            </span>
          </div>
        </div>

        {/* Search & Category Filter Navigation */}
        <div className="p-4 bg-[#161412] border-b border-[#2d2014] flex flex-col gap-3">
          {/* Search Input Bar */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search toolkits by name, action or category (e.g. GitHub, Slack, Notion, Jira)..."
              className="w-full bg-[#0d0c0b] text-[#f3ead8] placeholder-[#7d6c59] border border-[#4a351d] px-3.5 py-2 font-mono-tabular text-xs sm:text-sm focus:outline-none focus:border-[#e59838] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8c7a65] hover:text-[#f3ead8] text-xs font-mono-tabular cursor-pointer px-1.5 py-0.5"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono-tabular text-[10px] uppercase text-[#8c7a65] mr-1">
              CATEGORY:
            </span>
            {CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 font-mono-tabular text-xs rounded-xs border cursor-pointer transition-colors flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold shadow-[0_0_8px_rgba(229,152,56,0.3)]'
                      : cat === 'Connected' && connectedCount > 0
                      ? 'bg-[#0f2416] text-[#4ade80] border-[#2d6a4f] hover:border-[#4ade80]'
                      : 'bg-[#121110] text-[#b8a690] border-[#382917] hover:border-[#6e5233] hover:text-[#f3ead8]'
                  }`}
                >
                  {cat === 'Connected' && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        connectedCount > 0 ? 'bg-[#4ade80] animate-pulse' : 'bg-[#785732]'
                      }`}
                    />
                  )}
                  <span>{cat}</span>
                  {cat === 'Connected' && (
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded-xs font-bold ${
                        isSelected
                          ? 'bg-[#121110] text-[#e59838]'
                          : connectedCount > 0
                          ? 'bg-[#1e462b] text-[#4ade80]'
                          : 'bg-[#291e14] text-[#8c7a65]'
                      }`}
                    >
                      {connectedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dedicated Online Integrations Quick Status HUD */}
        <div
          className={`px-4 py-2.5 border-b font-mono-tabular transition-colors ${
            connectedCount > 0
              ? 'bg-[#0a180f] border-[#1e462b]'
              : 'bg-[#100e0c] border-[#2a1e12]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectedCount > 0 ? 'bg-[#4ade80] animate-pulse' : 'bg-[#6b5844]'
                }`}
              />
              <span className="text-xs font-bold tracking-wider uppercase">
                {connectedCount > 0 ? (
                  <span className="text-[#4ade80]">
                    ONLINE PLUGINS ({connectedCount} ACTIVE):
                  </span>
                ) : (
                  <span className="text-[#8c7a65]">
                    NO PLUGINS ONLINE (0 / {integrations.length})
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#8c7a65]">
              {connectedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedCategory('Connected')}
                  className="text-[#4ade80] hover:underline cursor-pointer"
                >
                  Filter to Online ({connectedCount}) →
                </button>
              ) : (
                <span>Click "Connect" below to authenticate apps for agent use</span>
              )}
            </div>
          </div>

          {connectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-[#1e462b]/60">
              {integrations
                .filter((item) => item.connected)
                .map((app) => (
                  <div
                    key={`online-hud-${app.appName}`}
                    className="px-2.5 py-1 bg-[#12281a] border border-[#2d6a4f] rounded-xs flex items-center gap-2 text-xs"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                    {app.logoUrl ? (
                      <img src={app.logoUrl} alt={app.name} className="w-3.5 h-3.5 object-contain" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-xs bg-[#1f3a27] text-[#4ade80] text-[9px] flex items-center justify-center font-bold">
                        {app.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="font-bold text-[#4ade80]">{app.name}</span>
                    <span className="text-[10px] text-[#86efac] bg-[#0f2416] px-1 py-0.2 rounded-xs border border-[#1e462b]">
                      ONLINE
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(app)}
                      disabled={disconnectingId === app.connectionId}
                      className="text-[#f87171] hover:text-white text-[10px] ml-1 px-1 py-0.2 hover:bg-[#381a1a] rounded cursor-pointer transition-colors"
                      title={`Disconnect ${app.name}`}
                    >
                      {disconnectingId === app.connectionId ? '...' : '✕'}
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Feedback / Alert Notice Banner */}
        {feedbackMessage && (
          <div
            className={`px-4 py-2 border-b font-mono-tabular text-xs flex items-center justify-between ${
              feedbackMessage.type === 'success'
                ? 'bg-[#0f2416] text-[#4ade80] border-[#1e462b]'
                : feedbackMessage.type === 'error'
                ? 'bg-[#291313] text-[#f87171] border-[#522121]'
                : 'bg-[#211a12] text-[#e59838] border-[#4a351d]'
            }`}
          >
            <div className="flex items-center gap-2">
              <span>{feedbackMessage.type === 'success' ? '✓' : feedbackMessage.type === 'error' ? '⚠' : 'ℹ'}</span>
              <span>{feedbackMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="text-xs hover:text-white cursor-pointer px-1.5 py-0.5"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tactical Armory Card Grid */}
        <div className="p-4 bg-[#0e0d0c] min-h-[300px]">
          {loading && integrations.length === 0 ? (
            <div className="py-16 text-center font-mono-tabular text-xs text-[#e59838] flex flex-col items-center justify-center gap-2">
              <span className="text-2xl animate-spin">⚙</span>
              <span>CALIBRATING ARMORY TOOLKIT MATRIX...</span>
            </div>
          ) : filteredIntegrations.length === 0 ? (
            <div className="py-16 text-center font-mono-tabular text-xs text-[#8c7a65]">
              <p>NO TOOLKITS MATCHED CRITERIA: "{searchQuery || selectedCategory}"</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                className="mt-3 px-3 py-1 bg-[#1a1410] border border-[#4a351d] text-[#e59838] text-xs cursor-pointer hover:border-[#e59838]"
              >
                Reset Search Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredIntegrations.map((app) => {
                const isConnecting = connectingApp === app.appName;
                const isDisconnecting = disconnectingId === app.connectionId;

                return (
                  <div
                    key={app.appName}
                    className={`p-3.5 border rounded-xs flex flex-col justify-between gap-3 transition-all ${
                      app.connected
                        ? 'border-[#2d6a4f] bg-[#0c1610] shadow-[0_0_12px_rgba(74,222,128,0.12)] ring-1 ring-[#2d6a4f]/50'
                        : 'bg-[#121110] border-[#382917] hover:border-[#785732]'
                    }`}
                  >
                    {/* Top Row: Icon + Name + Badge */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          {/* App Icon */}
                          <div className="w-8 h-8 rounded-xs bg-[#1f1914] border border-[#4a351d] flex items-center justify-center shrink-0 overflow-hidden">
                            {app.logoUrl ? (
                              <img
                                src={app.logoUrl}
                                alt={app.name}
                                className="w-5 h-5 object-contain"
                                onError={(e) => {
                                  // Fallback to monogram if icon link fails
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="font-mono-tabular font-bold text-xs text-[#e59838]">
                                {app.name.slice(0, 2).toUpperCase()}
                              </span>
                            )}
                          </div>

                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono-tabular text-sm font-bold text-[#f3ead8]">
                                {app.name}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono-tabular text-[#8c7a65] uppercase">
                              {app.category}
                            </span>
                          </div>
                        </div>

                        {/* Connection Status Badge */}
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {app.connected ? (
                            <span className="px-2 py-0.5 bg-[#0f2416] border border-[#2d6a4f] text-[#4ade80] font-mono-tabular text-[10px] font-bold tracking-wider flex items-center gap-1.5 shadow-[0_0_8px_rgba(74,222,128,0.2)]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                              ONLINE
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-[#1c1813] border border-[#4a351d] text-[#8c7a65] font-mono-tabular text-[10px] tracking-wider">
                              OFFLINE
                            </span>
                          )}
                          {app.connected && app.connectionId && (
                            <span
                              className="text-[9px] font-mono-tabular text-[#86efac]/70 truncate max-w-[110px]"
                              title={app.connectionId}
                            >
                              ID: {app.connectionId.slice(0, 10)}...
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <p className="font-mono-tabular text-[11px] text-[#b8a690] leading-snug line-clamp-3">
                        {app.description}
                      </p>
                    </div>

                    {/* Bottom Row: Auth Scheme + Action Buttons */}
                    <div className="pt-2.5 border-t border-[#231a12] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 text-[10px] font-mono-tabular text-[#8c7a65]">
                        <span className="uppercase">
                          {app.authSchemes?.[0] || 'OAUTH2'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {app.connected ? (
                          <button
                            type="button"
                            onClick={() => handleDisconnect(app)}
                            disabled={isDisconnecting}
                            className="px-2.5 py-1 font-mono-tabular text-xs bg-[#241212] hover:bg-[#381a1a] text-[#fca5a5] border border-[#6b2c2c] cursor-pointer transition-colors"
                            title="Disconnect authorized integration"
                          >
                            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleConnect(app)}
                            disabled={isConnecting}
                            className="px-3 py-1 font-mono-tabular text-xs bg-[#e59838] hover:bg-[#d48828] text-[#121110] font-bold border border-[#e59838] cursor-pointer transition-all flex items-center gap-1"
                          >
                            {isConnecting ? (
                              <span>Linking...</span>
                            ) : (
                              <>
                                <span>Connect</span>
                                <span className="text-[10px]">↗</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: Live Tactical Directive Helper */}
        <div className="bg-[#121110] border-t border-[#382917] px-4 py-2.5 text-[11px] font-mono-tabular text-[#8c7a65] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[#e59838]">⚡ OPERATIVE TOOL DISPATCH:</span>
            <span>Connected tools auto-mount into Gemini prompt function declarations.</span>
          </div>

          <div className="text-[#a8957e]">
            Tip: Test immediately in terminal with <code className="text-[#e59838] bg-[#1a1410] px-1 py-0.5">pixelops composio agent &lt;prompt&gt;</code>
          </div>
        </div>
      </div>

      {/* Composio BYOK API Key Configuration Modal */}
      {isApiKeyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#141210] border-2 border-[#b47b38] shadow-[0_0_40px_rgba(229,152,56,0.35)] rounded-xs overflow-hidden font-mono-tabular">
            {/* Modal Header */}
            <div className="bg-[#231b12] border-b border-[#4a351d] px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🔑</span>
                <span className="font-bold text-xs sm:text-sm text-[#e59838] tracking-wider uppercase">
                  COMPOSIO PLATFORM API KEY CONFIGURATION
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(false)}
                className="text-xs text-[#8c7a65] hover:text-[#f3ead8] px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 flex flex-col gap-3 text-xs">
              <p className="text-[#c8b79f] leading-relaxed">
                To connect tools (GitHub, Slack, Gmail, Notion, Linear) for your isolated Commander entity, provide your Composio project API key.
              </p>

              <div className="bg-[#0b0a09] border border-[#2e2114] p-2.5 text-[11px] text-[#9c8a77] flex flex-col gap-1">
                <span className="text-[#e59838] font-bold">GET A FREE API KEY:</span>
                <span>
                  1. Visit <a href="https://dashboard.composio.dev" target="_blank" rel="noopener noreferrer" className="text-[#38bdf8] underline hover:text-[#7dd3fc]">dashboard.composio.dev</a>
                </span>
                <span>2. Open Platform &rarr; Settings &rarr; API Keys and copy your Project Key.</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[#e59838] font-bold uppercase tracking-wider">
                  Composio API Key:
                </label>
                <input
                  type="password"
                  value={inputApiKey}
                  onChange={(e) => {
                    setInputApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="Paste ak_... or project key here"
                  className="w-full bg-[#0d0c0b] text-[#f3ead8] placeholder-[#665442] border border-[#4a351d] px-3 py-2 font-mono-tabular text-xs focus:outline-none focus:border-[#e59838]"
                />
              </div>

              {testResult && (
                <div className={`p-2 border text-[11px] ${
                  testResult.includes('OK') || testResult.includes('Active')
                    ? 'bg-[#0f2416] text-[#4ade80] border-[#2d6a4f]'
                    : 'bg-[#291313] text-[#fca5a5] border-[#5c2424]'
                }`}>
                  {testResult}
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#2d2014]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isTestingKey}
                    onClick={async () => {
                      const trimmed = inputApiKey.trim();
                      if (!trimmed) {
                        setTestResult('Enter an API key first.');
                        return;
                      }
                      setIsTestingKey(true);
                      setTestResult('Testing connection to Composio v3...');
                      try {
                        setComposioApiKey(trimmed);
                        const ping = await pingComposio();
                        if (ping.ok) {
                          setTestResult(`✓ Connection Active! Latency: ${ping.latencyMs}ms`);
                        } else {
                          setTestResult(`⚠ Backend returned status ${ping.status}${ping.error ? `: ${ping.error}` : ''}`);
                        }
                      } catch (err: any) {
                        setTestResult(`✕ Connection failed: ${err?.message || err}`);
                      } finally {
                        setIsTestingKey(false);
                      }
                    }}
                    className="px-2.5 py-1 bg-[#1a1410] hover:bg-[#2c2014] text-[#c8b79f] hover:text-[#f3ead8] border border-[#4a351d] cursor-pointer text-xs"
                  >
                    {isTestingKey ? 'Pinging...' : 'Test Connection'}
                  </button>

                  {apiKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setComposioApiKey('');
                        setApiKey('');
                        setInputApiKey('');
                        setTestResult('API Key cleared. Reverted to default server proxy.');
                        refreshIntegrations();
                      }}
                      className="px-2.5 py-1 bg-[#241212] hover:bg-[#381a1a] text-[#fca5a5] border border-[#6b2c2c] cursor-pointer text-xs"
                    >
                      Clear Key
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsApiKeyModalOpen(false)}
                    className="px-3 py-1 bg-[#1a1410] text-[#c8b79f] border border-[#4a351d] cursor-pointer text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const trimmed = inputApiKey.trim();
                      setComposioApiKey(trimmed);
                      setApiKey(trimmed);
                      setIsApiKeyModalOpen(false);
                      setFeedbackMessage({
                        text: trimmed
                          ? '[API KEY SAVED] Custom Composio BYOK key configured for your session.'
                          : '[API KEY CLEARED] Reverted to default server proxy.',
                        type: 'success',
                      });
                      await refreshIntegrations();
                      onPluginStatusChange?.();
                    }}
                    className="px-3.5 py-1 bg-[#e59838] hover:bg-[#d48828] text-[#121110] font-bold border border-[#e59838] cursor-pointer text-xs"
                  >
                    Save Key
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Composio Live Connection Diagnostics Modal */}
      {isDiagnosticsOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-[#141210] border-2 border-[#2d6a4f] shadow-[0_0_40px_rgba(74,222,128,0.25)] rounded-xs overflow-hidden font-mono-tabular">
            {/* Modal Header */}
            <div className="bg-[#0f2416] border-b border-[#1e462b] px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
                <span className="font-bold text-xs sm:text-sm text-[#4ade80] tracking-wider uppercase">
                  COMPOSIO CONNECTION TELEMETRY & DIAGNOSTICS
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsDiagnosticsOpen(false)}
                className="text-xs text-[#8c7a65] hover:text-[#f3ead8] px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 flex flex-col gap-3 text-xs max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 bg-[#0d0c0b] p-3 border border-[#2a1e12] rounded-xs text-[11px]">
                <div>
                  <span className="text-[#8c7a65] block">ENTITY ID:</span>
                  <span className="text-[#f3ead8] font-bold truncate block">{entityId}</span>
                </div>
                <div>
                  <span className="text-[#8c7a65] block">API KEY SOURCE:</span>
                  <span className="text-[#e59838] font-bold block">
                    {apiKey ? 'BYOK Custom Key' : 'Cloudflare Server Proxy'}
                  </span>
                </div>
                <div>
                  <span className="text-[#8c7a65] block">PING STATUS:</span>
                  <span className={`font-bold block ${diagnosticsData?.ping.ok ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                    {diagnosticsData?.ping.ok
                      ? `🟢 HTTP ${diagnosticsData.ping.status} (${diagnosticsData.ping.latencyMs}ms)`
                      : `🔴 ${diagnosticsData?.ping.error || 'Failed'}`}
                  </span>
                </div>
                <div>
                  <span className="text-[#8c7a65] block">VERIFIED ACCOUNTS:</span>
                  <span className="text-[#4ade80] font-bold block">
                    {diagnosticsData?.accounts.length || 0} Connected
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-bold text-[#b8a690] uppercase block mb-1.5">
                  DETECTED CONNECTED ACCOUNTS ({diagnosticsData?.accounts.length || 0}):
                </span>
                {(!diagnosticsData?.accounts || diagnosticsData.accounts.length === 0) ? (
                  <div className="p-4 bg-[#0d0c0b] border border-[#2a1e12] text-center text-[#8c7a65]">
                    No connected accounts reported by backend or browser storage. Click "Connect" on any toolkit to authenticate via OAuth.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {diagnosticsData.accounts.map((acc, idx) => (
                      <div
                        key={`${acc.id}-${idx}`}
                        className="p-2.5 bg-[#0b1810] border border-[#1e462b] rounded-xs flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[#4ade80] uppercase">{acc.appName}</span>
                              <span className="text-[10px] text-[#86efac] bg-[#0f2416] px-1 py-0.2 rounded-xs border border-[#1e462b]">
                                {acc.status}
                              </span>
                            </div>
                            <span className="text-[10px] text-[#8c7a65] block truncate max-w-xs">
                              ID: {acc.id}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-[#6b5844]">
                          {acc.createdAt ? new Date(acc.createdAt).toLocaleDateString() : 'Active'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-[#2d2014] flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={isDiagnosing}
                  onClick={handleOpenDiagnostics}
                  className="px-3 py-1 bg-[#1a1410] hover:bg-[#2c2014] text-[#e59838] border border-[#785732] cursor-pointer text-xs flex items-center gap-1"
                >
                  <span>{isDiagnosing ? 'Scanning...' : '⟳ Re-Scan'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDiagnosticsOpen(false)}
                  className="px-3 py-1 bg-[#2b2116] hover:bg-[#3d2f20] text-[#f3ead8] border border-[#6e5233] cursor-pointer text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
