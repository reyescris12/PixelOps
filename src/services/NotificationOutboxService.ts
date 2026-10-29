export type WebhookServiceType = 'slack' | 'telegram' | 'discord' | 'custom';

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
  serviceType: WebhookServiceType;
  webhookUrl: string;
}

const STORAGE_OUTBOX_KEY = 'pixelops_notification_outbox_v1';
const STORAGE_WEBHOOK_KEY = 'pixelops_webhook_config_v1';

export const DEFAULT_OUTBOX_NOTIFICATIONS: OutboxNotification[] = [];

export function loadOutboxNotifications(): OutboxNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOutboxNotifications(notifs: OutboxNotification[]) {
  try {
    localStorage.setItem(STORAGE_OUTBOX_KEY, JSON.stringify(notifs.slice(0, 50)));
  } catch {
    // Ignore storage quota
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
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed.enabled),
      serviceType: parsed.serviceType || 'slack',
      webhookUrl: parsed.webhookUrl || '',
    };
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('webhook:config-changed', { detail: config }));
    }
  } catch {
    // Ignore storage quota
  }
}

/**
 * Formats notification content into platform-specific webhook payload schemas
 * (Slack, Telegram, Discord, Custom JSON).
 */
export function formatWebhookPayload(
  serviceType: WebhookServiceType,
  data: { title: string; body: string; agentName: string; timestamp?: string }
): any {
  if (serviceType === 'slack') {
    return {
      text: `*[PixelOps Agent Alert]* *${data.title}*\n> ${data.body}\n_Operative: ${data.agentName}_`,
    };
  }
  if (serviceType === 'telegram') {
    return {
      text: `🚨 *[PixelOps Agent]* *${data.title}*\n${data.body}\n_Operative: ${data.agentName}_`,
      parse_mode: 'Markdown',
    };
  }
  if (serviceType === 'discord') {
    return {
      content: `🚨 **[PixelOps Agent] ${data.title}**\n>>> ${data.body}\n_Operative: ${data.agentName}_`,
    };
  }
  return {
    event: 'pixelops.alert',
    title: data.title,
    message: data.body,
    agent: data.agentName,
    timestamp: data.timestamp || new Date().toISOString(),
  };
}

/**
 * Dispatches a test ping payload to verify webhook endpoint health.
 */
export async function testWebhookEndpoint(
  config: WebhookConfig
): Promise<{ ok: boolean; message: string }> {
  if (!config.webhookUrl.trim()) {
    return { ok: false, message: 'Webhook endpoint URL cannot be empty.' };
  }
  try {
    const testPayload = formatWebhookPayload(config.serviceType, {
      title: 'Diagnostics Webhook Ping',
      body: 'Autonomous webhook ping verified from PixelOps Night Shift.',
      agentName: 'System Diagnostic Handler',
    });
    await fetch(config.webhookUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
      mode: 'no-cors',
    });
    return {
      ok: true,
      message: `Successfully transmitted test payload to ${config.serviceType.toUpperCase()} endpoint!`,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Network error transmitting to webhook endpoint.',
    };
  }
}

/**
 * Dispatches a push notification via Web Push API / Local Notifications
 * and pipes to configured Slack/Telegram/Discord/Custom webhooks.
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

  // 2. Dispatch to Webhook if enabled using service formatters
  const webhook = loadWebhookConfig();
  if (webhook.enabled && webhook.webhookUrl.trim()) {
    try {
      const payload = formatWebhookPayload(webhook.serviceType, {
        title: fullNotif.title,
        body: fullNotif.body,
        agentName: fullNotif.agentName,
        timestamp: fullNotif.timestamp,
      });

      await fetch(webhook.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        mode: 'no-cors',
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
