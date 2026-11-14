import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Zap, Radio, Cloud, CheckCircle2, X } from 'lucide-react';
import {
  type SubscriptionTier,
  TIER_LIMITS,
  TIER_DISPLAY_NAMES,
  hasMinimumTier,
  normalizeSubscriptionTier,
} from '../config/tierLimits';
import {
  getActiveSubscriptionTier,
  syncEntitlementsFromEdge,
} from '../services/AuthService';

/**
 * Reactive hook returning the current user's Cloudflare D1 subscription_tier
 * (defaults to 'operative' for local-first guests).
 */
export function useSubscriptionTier(): SubscriptionTier {
  const [tier, setTier] = useState<SubscriptionTier>(() => getActiveSubscriptionTier());

  useEffect(() => {
    setTier(getActiveSubscriptionTier());
    syncEntitlementsFromEdge()
      .then((resolved) => setTier(normalizeSubscriptionTier(resolved)))
      .catch(() => {});

    const handleAuthChange = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (detail?.session?.user?.subscription_tier) {
        setTier(normalizeSubscriptionTier(detail.session.user.subscription_tier));
      } else {
        setTier(getActiveSubscriptionTier());
      }
    };

    window.addEventListener('pixelops:auth-changed', handleAuthChange);
    return () => {
      window.removeEventListener('pixelops:auth-changed', handleAuthChange);
    };
  }, []);

  return tier;
}

export interface CommandersPassModalProps {
  isOpen: boolean;
  onClose: () => void;
  min?: SubscriptionTier;
  featureName: string;
  currentTier?: SubscriptionTier;
}

export const CommandersPassModal: React.FC<CommandersPassModalProps> = ({
  isOpen,
  onClose,
  min = 'pro',
  featureName,
  currentTier = 'operative',
}) => {
  if (!isOpen) return null;

  const targetLimits = TIER_LIMITS[min];
  const freeLimits = TIER_LIMITS.operative;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-label="Commander's Pass Required"
    >
      <div className="w-full max-w-xl rounded-none border-2 border-amber-500/80 bg-[#090d12] shadow-[0_0_32px_rgba(245,158,11,0.22)] p-5 flex flex-col gap-4">
        {/* 16-Bit Tactical Header */}
        <div className="flex items-start justify-between border-b border-amber-500/40 pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-950/80 border border-amber-400/60 text-amber-300">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">
                CLEARANCE ESCALATION // {TIER_DISPLAY_NAMES[min]}
              </div>
              <h2 className="text-sm sm:text-base font-bold text-amber-200 tracking-wider">
                COMMANDER&apos;S PASS REQUIRED
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center border border-slate-700 text-slate-400 hover:text-amber-200 hover:border-amber-500/60 cursor-pointer"
            aria-label="Close clearance modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Gated Feature Banner */}
        <div className="p-3 bg-amber-950/30 border border-amber-500/40 text-xs text-amber-100">
          <span className="font-bold text-amber-300 uppercase">Gated Capability:</span>{' '}
          <span>{featureName}</span>
          <div className="mt-1 text-[11px] text-slate-300">
            Active Clearance:{' '}
            <span className="text-emerald-300 font-bold uppercase">{currentTier}</span> → Required:{' '}
            <span className="text-amber-300 font-bold uppercase">{min}</span>
          </div>
        </div>

        {/* Comparison Grid: Free Local vs Pro Commander's Pass */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Free Operative Column */}
          <div className="p-3.5 bg-[#06090d] border border-emerald-500/40 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-300 uppercase flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" /> OPERATIVE (FREE LOCAL)
              </span>
              <span className="px-1.5 py-0.5 text-[9px] bg-emerald-950 border border-emerald-500/50 text-emerald-300">
                ACTIVE $0
              </span>
            </div>
            <p className="text-[10px] text-slate-400">
              100% sovereign browser-local intelligence at zero server cost:
            </p>
            <ul className="space-y-1.5 text-[11px] text-slate-200">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Encrypted BYOK Vault (Gemini, Claude, OpenAI, OpenRouter)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>{freeLimits.maxNais} Local NAI Watch Zone ({freeLimits.minPollSeconds}s cadence)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Live Pre-Media Sensor Bus (ADS-B, Seismic, IODA, Civic)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>Local IndexedDB VFS & Portable JSON Backups</span>
              </li>
            </ul>
          </div>

          {/* Pro / Station Chief Column */}
          <div className="p-3.5 bg-[#0e100b] border border-amber-500/60 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-300 uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" /> COMMANDER&apos;S PASS
              </span>
              <span className="px-1.5 py-0.5 text-[9px] bg-amber-950 border border-amber-400/60 text-amber-200">
                {min === 'station_chief' ? 'STATION CHIEF' : 'PRO TIER'}
              </span>
            </div>
            <p className="text-[10px] text-amber-200/80">
              Persistent edge infrastructure & multi-sector telemetry:
            </p>
            <ul className="space-y-1.5 text-[11px] text-amber-100">
              <li className="flex items-start gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>24/7 Locked-Phone Edge Push & Background Tripwires</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Up to {targetLimits.maxNais} Simultaneous NAI Watch Zones ({targetLimits.minPollSeconds}s sweep)
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>Cross-Device E2EE Cloudflare D1 State Synchronization</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Hosted Managed AI Sweeps
                  {targetLimits.canExportStix ? ' + STIX 2.1 Bundle Export' : ''}
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px]">
          <span className="text-slate-400">
            Local-first sensors & BYOK remain 100% unrestricted.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold uppercase tracking-wider cursor-pointer transition-colors"
          >
            ACKNOWLEDGE
          </button>
        </div>
      </div>
    </div>
  );
};

export interface TierGateProps {
  min?: SubscriptionTier;
  featureName: string;
  children: React.ReactNode;
  /**
   * When 'banner' (default), renders a compact 16-bit clearance card that opens the modal.
   * When 'intercept', renders children dimmed and intercepts clicks to open the modal.
   */
  fallbackMode?: 'banner' | 'intercept';
}

export const TierGate: React.FC<TierGateProps> = ({
  min = 'pro',
  featureName,
  children,
  fallbackMode = 'banner',
}) => {
  const currentTier = useSubscriptionTier();
  const [modalOpen, setModalOpen] = useState(false);

  if (hasMinimumTier(currentTier, min)) {
    return <>{children}</>;
  }

  return (
    <>
      {fallbackMode === 'intercept' ? (
        <div
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setModalOpen(true);
          }}
          className="relative cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
          title={`${featureName} — Requires ${TIER_DISPLAY_NAMES[min]}`}
        >
          <div className="pointer-events-none">{children}</div>
        </div>
      ) : (
        <div className="p-3 bg-[#090d12] border border-amber-500/50 flex items-center justify-between gap-3 font-mono text-xs">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="text-amber-200 font-bold uppercase tracking-wide text-[11px]">
                {featureName}
              </div>
              <div className="text-[10px] text-slate-400">
                Requires {TIER_DISPLAY_NAMES[min]} · Local IndexedDB & BYOK active for free
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 bg-amber-950/90 hover:bg-amber-900 border border-amber-400/70 text-amber-200 font-bold text-[10px] uppercase tracking-wider shrink-0 cursor-pointer"
          >
            COMMANDER&apos;S PASS
          </button>
        </div>
      )}

      <CommandersPassModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        min={min}
        featureName={featureName}
        currentTier={currentTier}
      />
    </>
  );
};
