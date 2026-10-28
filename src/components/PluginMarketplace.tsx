import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposioService,
  ComposioIntegration,
  CURATED_COMPOSIO_INTEGRATIONS,
  getOrCreateEntityId,
} from '../services/ComposioService';

interface PluginMarketplaceProps {
  onPluginStatusChange?: () => void;
  onClose?: () => void;
}

const CATEGORIES = [
  'All',
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
  const [integrations, setIntegrations] = useState<ComposioIntegration[]>(() => CURATED_COMPOSIO_INTEGRATIONS);
  const [loading, setLoading] = useState(false);
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const entityId = useMemo(() => getOrCreateEntityId(), []);

  // Fetch available integrations and annotate with live connection status
  const refreshIntegrations = useCallback(async () => {
    try {
      setLoading(true);
      const items = await ComposioService.getAvailableIntegrations();
      if (items && items.length > 0) {
        setIntegrations(items);
      }
    } catch (err: any) {
      console.error('[ARMORY MARKETPLACE FETCH ERROR]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshIntegrations();

    // Re-check connections when user re-focuses the tab (e.g. returns from OAuth popup)
    const handleWindowFocus = () => {
      refreshIntegrations();
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
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
          text: `[CONNECT LINK READY] Opened authorization window for ${app.name}. Complete authentication in popup.`,
          type: 'success',
        });
      } else {
        setFeedbackMessage({
          text: `[CONNECT SIGNAL SENT] Connection initiated for ${app.name}.`,
          type: 'info',
        });
      }

      // Check after 6 seconds to see if connection became active
      setTimeout(() => {
        refreshIntegrations();
        onPluginStatusChange?.();
      }, 6000);
    } catch (err: any) {
      setFeedbackMessage({
        text: `[CONNECTION ERROR] Failed to initiate ${app.name}: ${err?.message || err}`,
        type: 'error',
      });
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
        selectedCategory === 'All' || item.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [integrations, searchQuery, selectedCategory]);

  const connectedCount = useMemo(() => {
    return integrations.filter((i) => i.connected).length;
  }, [integrations]);

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
              onClick={refreshIntegrations}
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
                  className={`px-2.5 py-1 font-mono-tabular text-xs rounded-xs border cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#e59838] text-[#121110] border-[#e59838] font-bold shadow-[0_0_8px_rgba(229,152,56,0.3)]'
                      : 'bg-[#121110] text-[#b8a690] border-[#382917] hover:border-[#6e5233] hover:text-[#f3ead8]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
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
                    className={`p-3.5 bg-[#121110] border rounded-xs flex flex-col justify-between gap-3 transition-all ${
                      app.connected
                        ? 'border-[#2d6a4f] shadow-[0_0_12px_rgba(74,222,128,0.1)]'
                        : 'border-[#382917] hover:border-[#785732]'
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
                        <div className="shrink-0">
                          {app.connected ? (
                            <span className="px-2 py-0.5 bg-[#0f2416] border border-[#2d6a4f] text-[#4ade80] font-mono-tabular text-[10px] font-bold tracking-wider flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                              CONNECTED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-[#1c1813] border border-[#4a351d] text-[#8c7a65] font-mono-tabular text-[10px] tracking-wider">
                              OFFLINE
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
    </div>
  );
};
