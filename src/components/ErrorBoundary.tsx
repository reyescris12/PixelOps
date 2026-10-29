import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PixelOps ErrorBoundary] Caught unhandled React error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] bg-[#0a0c14] text-[#f3ead8] flex flex-col items-center justify-center p-6 font-mono-tabular">
          <div className="w-full max-w-lg bg-[#141724] border-2 border-[#ef4444] shadow-[0_0_30px_rgba(239,68,68,0.3)] p-6 space-y-4">
            <div className="flex items-center gap-3 border-b border-[#363d54] pb-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h2 className="text-sm font-bold text-[#ef4444] uppercase tracking-wider">
                  {this.props.fallbackTitle || 'SEC-FAILURE // SUB-SYSTEM RUNTIME ANOMALY'}
                </h2>
                <p className="text-[11px] text-[#94a3b8]">
                  Tactical fail-safe circuit breaker engaged. Component state preserved.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#0d0f18] border border-[#2b354f] text-xs font-mono text-[#fca5a5] break-words max-h-48 overflow-y-auto">
              <code>{this.state.error?.message || 'Unknown render exception.'}</code>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-3 py-1.5 bg-[#1e2438] hover:bg-[#2b354f] text-[#cbd5e1] border border-[#363d54] text-xs font-semibold cursor-pointer transition-colors"
              >
                [DISMISS & CONTINUE]
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-1.5 bg-[#ef4444] hover:bg-[#dc2626] text-white text-xs font-bold border border-[#f87171] cursor-pointer transition-colors"
              >
                [RELOAD COMMAND CENTER]
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
