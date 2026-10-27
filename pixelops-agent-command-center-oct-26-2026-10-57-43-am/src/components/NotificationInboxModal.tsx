import React, { useState } from 'react';
import {
  X,
  Bell,
  Send,
  ShieldAlert,
  CheckCircle2,
  Trash2,
  Radio,
  KeyRound,
  Check,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useInbox } from '../context/InboxContext';

interface NotificationInboxModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationInboxModal: React.FC<NotificationInboxModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { theme, playBeep } = useTheme();
  const {
    notifications,
    unreadCount,
    webhookConfig,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    updateWebhookConfig,
    requestPushPermission,
  } = useInbox();

  const [activeTab, setActiveTab] = useState<'inbox' | 'webhooks'>('inbox');
  const [serviceType, setServiceType] = useState<'slack' | 'telegram' | 'custom'>(
    webhookConfig.serviceType
  );
  const [webhookUrl, setWebhookUrl] = useState(webhookConfig.webhookUrl);
  const [webhookEnabled, setWebhookEnabled] = useState(webhookConfig.enabled);
  const [pushStatus, setPushStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    playBeep('complete');
    updateWebhookConfig({
      enabled: webhookEnabled,
      serviceType,
      webhookUrl: webhookUrl.trim(),
    });
  };

  const handleEnablePush = async () => {
    playBeep('tap');
    const granted = await requestPushPermission();
    if (granted) {
      setPushStatus('Web Push & Lock-Screen Notifications Enabled!');
      playBeep('complete');
    } else {
      setPushStatus('Permission denied or not supported in this environment.');
      playBeep('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-[#11141c] border border-slate-800 p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Centralized Notification Inbox & Outbox Bridge
              </h2>
              <p className="text-xs text-slate-400">
                Agent dispatches, approvals, and outbound webhook stubs
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('inbox');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'inbox'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notification Inbox</span>
            {unreadCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-[10px] font-mono-tabular text-white font-bold">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              setActiveTab('webhooks');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'webhooks'
                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Push & Webhook Connectors</span>
          </button>
        </div>

        {/* Tab 1: Notification Inbox */}
        {activeTab === 'inbox' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Completed routines, agent notes & human-in-the-loop approval requests
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playBeep('tap');
                    markAllAsRead();
                  }}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 border border-slate-800 cursor-pointer"
                >
                  Mark All Read
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playBeep('error');
                    clearNotifications();
                  }}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[11px] text-red-400 border border-slate-800 cursor-pointer flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 max-h-[50vh] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 bg-[#0a0a0c] rounded-xl border border-slate-800/80">
                  Notification inbox is empty. Agent alerts and approvals will appear here.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      if (!n.read) markAsRead(n.id);
                    }}
                    className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-colors cursor-pointer ${
                      n.read
                        ? 'bg-[#0a0a0c]/70 border-slate-800/80 text-slate-400'
                        : 'bg-[#12151f] border-indigo-500/50 text-slate-200 shadow-lg'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {n.type === 'human_approval_required' ? (
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-100">{n.title}</span>
                      </div>
                      <span className="font-mono-tabular text-[10px] text-slate-500">
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed pl-6">
                      {n.body}
                    </p>

                    <div className="flex items-center justify-between text-[10px] font-mono-tabular pl-6 pt-1 text-slate-400">
                      <span>Operative: {n.agentName}</span>
                      <div className="flex items-center gap-2">
                        {n.webhookSent && (
                          <span className="text-cyan-400">[WEBHOOK PIPED]</span>
                        )}
                        {!n.read && (
                          <span className="text-indigo-400 font-bold">[UNREAD]</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Webhook & Push Connectors */}
        {activeTab === 'webhooks' && (
          <form onSubmit={handleSaveWebhook} className="flex flex-col gap-4">
            {/* Web Push API Stubs */}
            <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Web Push API & Lock-Screen Notifications</span>
                </span>
                <span className="font-mono-tabular text-[11px] text-emerald-400">
                  {typeof window !== 'undefined' && 'Notification' in window
                    ? `Permission: ${Notification.permission}`
                    : 'Not Supported'}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Receive browser lock-screen push notifications when background routines complete or an agent requires human approval.
              </p>
              <button
                type="button"
                onClick={handleEnablePush}
                className="min-h-[36px] px-3 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/60 text-xs font-medium text-cyan-200 flex items-center gap-1.5 transition-colors cursor-pointer self-start"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Request Push Notifications Permission</span>
              </button>
              {pushStatus && (
                <p className="text-xs font-mono-tabular text-emerald-400">{pushStatus}</p>
              )}
            </div>

            {/* Outbound Messaging Webhook Connectors (Slack / Telegram) */}
            <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Outbound Webhook Formatters (Slack / Telegram)</span>
                </span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookEnabled}
                    onChange={(e) => setWebhookEnabled(e.target.checked)}
                    className="accent-indigo-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 font-mono-tabular">
                    {webhookEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['slack', 'telegram', 'custom'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      playBeep('tap');
                      setServiceType(s);
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-mono-tabular uppercase transition-colors cursor-pointer ${
                      serviceType === s
                        ? 'bg-indigo-950/60 border-indigo-500 text-indigo-200 font-bold'
                        : 'bg-[#12151f] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-300 font-medium">
                  {serviceType.toUpperCase()} Webhook URL Endpoint
                </label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder={`https://hooks.${serviceType}.com/services/T00/B00/XXXX`}
                  className="w-full bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              className={`w-full min-h-[42px] rounded-xl text-xs font-semibold text-slate-950 ${theme.accentBgClass} hover:opacity-95 transition-opacity cursor-pointer`}
            >
              Save Webhook Configuration
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[40px] rounded-xl text-xs font-semibold bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          Close Notification Center
        </button>
      </div>
    </div>
  );
};
