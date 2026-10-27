import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  OutboxNotification,
  WebhookConfig,
  loadOutboxNotifications,
  saveOutboxNotifications,
  loadWebhookConfig,
  saveWebhookConfig,
  dispatchOutboxNotification,
} from '../services/NotificationOutboxService';

interface InboxContextValue {
  notifications: OutboxNotification[];
  unreadCount: number;
  webhookConfig: WebhookConfig;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
  sendNotification: (
    notif: Omit<OutboxNotification, 'id' | 'timestamp' | 'read' | 'webhookSent'>
  ) => Promise<OutboxNotification>;
  updateWebhookConfig: (config: WebhookConfig) => void;
  requestPushPermission: () => Promise<boolean>;
}

const InboxContext = createContext<InboxContextValue | undefined>(undefined);

export const InboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<OutboxNotification[]>(loadOutboxNotifications);
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(loadWebhookConfig);

  useEffect(() => {
    saveOutboxNotifications(notifications);
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    saveOutboxNotifications([]);
  }, []);

  const sendNotification = useCallback(
    async (notif: Omit<OutboxNotification, 'id' | 'timestamp' | 'read' | 'webhookSent'>) => {
      const created = await dispatchOutboxNotification(notif);
      setNotifications((prev) => [created, ...prev]);
      return created;
    },
    []
  );

  const updateWebhookConfig = useCallback((config: WebhookConfig) => {
    setWebhookConfig(config);
    saveWebhookConfig(config);
  }, []);

  const requestPushPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }, []);

  return (
    <InboxContext.Provider
      value={{
        notifications,
        unreadCount,
        webhookConfig,
        markAsRead,
        markAllAsRead,
        clearNotifications,
        sendNotification,
        updateWebhookConfig,
        requestPushPermission,
      }}
    >
      {children}
    </InboxContext.Provider>
  );
};

export const useInbox = (): InboxContextValue => {
  const ctx = useContext(InboxContext);
  if (!ctx) {
    throw new Error('useInbox must be used within an InboxProvider');
  }
  return ctx;
};
