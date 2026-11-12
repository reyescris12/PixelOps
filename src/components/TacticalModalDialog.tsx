import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export interface TacticalModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Native `<dialog closedby="any">` modal wrapper adhering to Modern Web Guidance:
 * - Opened via `showModal()` for top-layer promotion, inert background, focus containment, & Esc dismissal
 * - Declarative light-dismiss via `closedby="any"` + coordinate-verified fallback when `closedBy` is unsupported
 * - Resets `dialog.returnValue = ''` on close to prevent stale returnValue leakage
 */
export const TacticalModalDialog: React.FC<TacticalModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  icon,
  maxWidthClass,
  headerActions,
  children,
}) => {
  const { playBeep } = useTheme();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch {
          // Guard if already open in another state
        }
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback for browsers without native `closedBy` support on HTMLDialogElement.prototype
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;

        if (isDialogContent) return;
        dialog.close();
      };

      dialog.addEventListener('click', handleBackdropClick);
      return () => dialog.removeEventListener('click', handleBackdropClick);
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as any)}
      aria-labelledby={titleId}
      className={`tactical-modal-dialog tactical-scanlines font-mono-tabular rounded-sm overflow-hidden ${
        maxWidthClass || ''
      }`}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = '';
        }
        onClose();
      }}
    >
      {/* Tactical CRT Bezel Header */}
      <div
        className="px-3.5 sm:px-5 py-3 bg-[#0e1320] border-b flex items-center justify-between gap-3 shrink-0"
        style={{ borderColor: 'var(--theme-border-color)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <div
              className="w-8 h-8 rounded-sm bg-[#131b2e] border flex items-center justify-center shrink-0"
              style={{
                borderColor: 'var(--theme-border-color)',
                color: 'rgb(var(--theme-primary-rgb))',
              }}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                id={titleId}
                className="font-pixel text-xs sm:text-sm font-bold uppercase tracking-wider truncate"
                style={{
                  color: 'rgb(var(--theme-primary-rgb))',
                  textShadow: '0 0 8px var(--theme-glow-color)',
                }}
              >
                {title}
              </h2>
              {badge && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-[#152036] border border-[#2d3e5e] text-[#e59838]">
                  {badge}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-[#94a3b8] truncate mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {headerActions}
          <button
            type="button"
            autoFocus
            aria-label={`Close ${title}`}
            onClick={() => {
              playBeep('tap');
              dialogRef.current?.close();
            }}
            className="tactical-ctrl min-h-[34px] px-2.5 py-1 bg-[#141a29] hover:bg-[#1f2940] border border-[#334155] text-xs font-bold text-[#cbd5e1] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>ESC</span>
          </button>
        </div>
      </div>

      {/* Scrollable Modal Body */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{children}</div>
    </dialog>
  );
};
