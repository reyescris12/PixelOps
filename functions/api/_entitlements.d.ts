export type EdgeSubscriptionTier = 'operative' | 'pro' | 'station_chief';

export interface EdgeEntitledUser {
  id: string;
  username: string;
  subscription_tier: EdgeSubscriptionTier;
  sweeps_remaining: number;
}

export interface RequireTierResult {
  ok: boolean;
  status: number;
  user: EdgeEntitledUser | null;
  currentTier: EdgeSubscriptionTier;
  requiredTier: EdgeSubscriptionTier;
  response?: Response;
}

export function normalizeTier(raw: unknown): EdgeSubscriptionTier;
export function extractSessionTokenFromRequest(request: Request): string;
export function ensureD1EntitlementColumns(d1: any): Promise<void>;
export function resolveSessionUser(request: Request, env: any): Promise<EdgeEntitledUser | null>;
export function requireTier(
  request: Request,
  env: any,
  minTier?: EdgeSubscriptionTier
): Promise<RequireTierResult>;
