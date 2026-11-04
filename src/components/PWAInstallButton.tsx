import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall, useOnlineStatus } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isInstallable) {
            install();
          } else {
            setShowModal(true);
          }
        }}
        className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Install PixelOps PWA"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#111318] border border-slate-800 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <h3 className="text-base font-semibold text-slate-100">Install PixelOps PWA</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-200 rounded-lg"
                aria-label="Close install guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isIOS ? (
              <p className="text-sm text-slate-300 leading-relaxed">
                1. Tap the <strong>Share</strong> button in your Safari toolbar.<br />
                2. Scroll down and select <strong>Add to Home Screen</strong> to launch PixelOps in standalone full-screen mode.
              </p>
            ) : (
              <p className="text-sm text-slate-300 leading-relaxed">
                Open your browser menu or address bar install icon and choose <strong>Install PixelOps Agent Command Center</strong> (or open in a top-level browser tab if previewing inside an embedded frame).
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-medium text-slate-100 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 rounded-xl bg-amber-950/95 border border-amber-700 px-3.5 py-2 text-xs font-medium text-amber-200 shadow-lg">
      Offline Mode · Local cached telemetry active
    </div>
  );
};
