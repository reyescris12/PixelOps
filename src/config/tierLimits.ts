/**
 * Single Source of Truth for PixelOps Entitlement Tiers & Operational Limits
 * (src/config/tierLimits.ts)
 */

export type SubscriptionTier = 'operative' | 'pro' | 'station_chief';

export interface TierLimitSpec {
  maxNais: number;
  minPollSeconds: number;
  canUseManagedAi: boolean;
  canUseEdgePush: boolean;
  canSyncCloud: boolean;
  canExportStix: boolean;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimitSpec> = {
  operative: {
    maxNais: 1,
    minPollSeconds: 60,
    canUseManagedAi: false,
    canUseEdgePush: false,
    canSyncCloud: false,
    canExportStix: false,
  },
  pro: {
    maxNais: 5,
    minPollSeconds: 30,
    canUseManagedAi: true,
    canUseEdgePush: true,
    canSyncCloud: true,
    canExportStix: false,
  },
  station_chief: {
    maxNais: 50,
    minPollSeconds: 15,
    canUseManagedAi: true,
    canUseEdgePush: true,
    canSyncCloud: true,
    canExportStix: true,
  },
};

export const TIER_RANK: Record<SubscriptionTier, number> = {
  operative: 0,
  pro: 1,
  station_chief: 2,
};

export const TIER_DISPLAY_NAMES: Record<SubscriptionTier, string> = {
  operative: 'OPERATIVE (FREE LOCAL)',
  pro: "COMMANDER'S PASS (PRO)",
  station_chief: 'STATION CHIEF (SOVEREIGN)',
};

export function normalizeSubscriptionTier(value: unknown): SubscriptionTier {
  const clean = String(value || '')
    .trim()
    .toLowerCase();
  if (clean === 'station_chief') return 'station_chief';
  if (clean === 'pro') return 'pro';
  return 'operative';
}

export function hasMinimumTier(
  currentTier: SubscriptionTier | string | null | undefined,
  minTier: SubscriptionTier
): boolean {
  const normalizedCurrent = normalizeSubscriptionTier(currentTier);
  return TIER_RANK[normalizedCurrent] >= TIER_RANK[minTier];
}
