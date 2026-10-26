export interface OutboxNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: 'routine_complete' | 'agent_note' | 'human_approval_required';
  agentName: string;
  read: boolean;
  webhookSent?: boolean;
}

export interface WebhookConfig {
  enabled: boolean;
  serviceType: 'slack' | 'telegram' | 'custom';
  webhookUrl: string;
}

const STORAGE_OUTBOX_KEY = 'pixelops_notification_outbox_v1';
const STORAGE_WEBHOOK_KEY = 'pixelops_webhook_config_v1';

export const DEFAULT_OUTBOX_NOTIFICATIONS: OutboxNotification[] = [
  {
    id: 'outbox-1',
    title: 'Human-In-The-Loop Approval Required',
    body: 'Agent Nyx is blocked trying to create GitHub issue "Mainframe Firewall Patch". Tap to approve dispatch.',
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    type: 'human_approval_required',
    agentName: 'Agent Nyx',
    read: false,
    webhookSent: true,
  },
  {
    id: 'outbox-2',
    title: 'Night Shift Routine Completed',
    body: 'Autonomous web threat scan finished successfully. 0 perimeter anomalies detected.',
    timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    type: 'routine_complete',
    agentName: 'Agent Cipher',
    read: true,
    webhookSent: true,
  },
];

export function loadOutboxNotifications(): OutboxNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_OUTBOX_KEY);
    if (!raw) return DEFAULT_OUTBOX_NOTIFICATIONS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_OUTBOX_NOTIFICATIONS;
  } catch {
    return DEFAULT_OUTBOX_NOTIFICATIONS;
  }
}

export function saveOutboxNotifications(notifs: OutboxNotification[]) {
  try {
    localStorage.setItem(STORAGE_OUTBOX_KEY, JSON.stringify(notifs.slice(0, 50)));
  } catch {
    // Ignore
  }
}

export function loadWebhookConfig(): WebhookConfig {
  try {
    const raw = localStorage.getItem(STORAGE_WEBHOOK_KEY);
    if (!raw) {
      return {
        enabled: false,
        serviceType: 'slack',
        webhookUrl: '',
      };
    }
    return JSON.parse(raw);
  } catch {
    return {
      enabled: false,
      serviceType: 'slack',
      webhookUrl: '',
    };
  }
}

export function saveWebhookConfig(config: WebhookConfig) {
  try {
    localStorage.setItem(STORAGE_WEBHOOK_KEY, JSON.stringify(config));
  } catch {
    // Ignore
  }
}

/**
 * Dispatches a push notification via Web Push API / Local Notifications
 * and pipes to configured Slack/Telegram webhooks.
 */
export async function dispatchOutboxNotification(
  notification: Omit<OutboxNotification, 'id' | 'timestamp' | 'read' | 'webhookSent'>
): Promise<OutboxNotification> {
  const fullNotif: OutboxNotification = {
    ...notification,
    id: `outbox-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: new Date().toISOString(),
    read: false,
    webhookSent: false,
  };

  // 1. Trigger Web Push / Browser Notification if permitted
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(`[PixelOps Agent] ${fullNotif.title}`, {
        body: fullNotif.body,
        icon: '/pwa-192x192.png',
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') {
          new Notification(`[PixelOps Agent] ${fullNotif.title}`, {
            body: fullNotif.body,
            icon: '/pwa-192x192.png',
          });
        }
      });
    }
  }

  // 2. Dispatch to Webhook if enabled (Slack/Telegram formatter stub)
  const webhook = loadWebhookConfig();
  if (webhook.enabled && webhook.webhookUrl.trim()) {
    try {
      let payload: any = {};
      if (webhook.serviceType === 'slack') {
        payload = {
          text: `*[PixelOps Agent Alert]* *${fullNotif.title}*\n> ${fullNotif.body}\n_Agent: ${fullNotif.agentName}_`,
        };
      } else if (webhook.serviceType === 'telegram') {
        payload = {
          text: `🚨 *[PixelOps Agent]* *${fullNotif.title}*\n${fullNotif.body}\n_Agent: ${fullNotif.agentName}_`,
          parse_mode: 'Markdown',
        };
      } else {
        payload = {
          title: fullNotif.title,
          message: fullNotif.body,
          agent: fullNotif.agentName,
          timestamp: fullNotif.timestamp,
        };
      }

      await fetch(webhook.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'no-cors', // handle cross-origin webhook stubs safely
      });
      fullNotif.webhookSent = true;
    } catch {
      fullNotif.webhookSent = false;
    }
  }

  // Save to persistent storage
  const current = loadOutboxNotifications();
  saveOutboxNotifications([fullNotif, ...current]);
  return fullNotif;
}
