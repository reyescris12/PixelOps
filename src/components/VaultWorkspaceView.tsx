import React, { useEffect, useRef, useState } from 'react';
import { FileText, Network, Plug } from 'lucide-react';
import { WorkspaceFileViewer } from './WorkspaceFileViewer';
import { BasementLinkBoardModal } from './BasementLinkBoardModal';

export type VaultSectionId = 'dossiers' | 'graph' | 'toolkits';

export interface VaultWorkspaceViewProps {
  initialSection?: VaultSectionId;
  initialFilePath?: string;
  onDispatchCorrelation?: (prompt: string) => void;
  toolkitsPanel: React.ReactNode;
}

const VAULT_TABS: readonly VaultSectionId[] = ['dossiers', 'graph', 'toolkits'];

export const VaultWorkspaceView: React.FC<VaultWorkspaceViewProps> = ({
  initialSection = 'dossiers',
  initialFilePath,
  onDispatchCorrelation,
  toolkitsPanel,
}) => {
  const [activeSection, setActiveSection] = useState<VaultSectionId>(initialSection);
  const [focusedFilePath, setFocusedFilePath] = useState<string | undefined>(initialFilePath);

  const tabRefs = useRef<Record<VaultSectionId, HTMLButtonElement | null>>({
    dossiers: null,
    graph: null,
    toolkits: null,
  });

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (initialFilePath) {
      setFocusedFilePath(initialFilePath);
      setActiveSection('dossiers');
    }
  }, [initialFilePath]);

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = VAULT_TABS.indexOf(activeSection);
    let nextIdx = idx;
    if (e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % VAULT_TABS.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + VAULT_TABS.length) % VAULT_TABS.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = VAULT_TABS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextTab = VAULT_TABS[nextIdx];
    setActiveSection(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#05090d] text-slate-100 overflow-hidden">
      {/* Calm Archive Sub-Navigation Strip (WAI-ARIA Tabs) */}
      <div className="px-4 bg-[#070d12] border-b border-slate-800/90 flex items-center justify-between gap-3 shrink-0">
        <div
          role="tablist"
          aria-label="Vault Archive Sections"
          onKeyDown={handleTabKeyDown}
          className="calm-c2-tablist"
        >
          <button
            ref={(el) => {
              tabRefs.current.dossiers = el;
            }}
            id="vault-tab-dossiers"
            role="tab"
            type="button"
            aria-selected={activeSection === 'dossiers'}
            aria-controls="vault-panel-dossiers"
            tabIndex={activeSection === 'dossiers' ? 0 : -1}
            onClick={() => setActiveSection('dossiers')}
            className="calm-c2-tab text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>Saved Dossiers</span>
          </button>

          <button
            ref={(el) => {
              tabRefs.current.graph = el;
            }}
            id="vault-tab-graph"
            role="tab"
            type="button"
            aria-selected={activeSection === 'graph'}
            aria-controls="vault-panel-graph"
            tabIndex={activeSection === 'graph' ? 0 : -1}
            onClick={() => setActiveSection('graph')}
            className="calm-c2-tab text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Network className="w-3.5 h-3.5 text-sky-400" />
            <span>Entity Link Graph</span>
          </button>

          <button
            ref={(el) => {
              tabRefs.current.toolkits = el;
            }}
            id="vault-tab-toolkits"
            role="tab"
            type="button"
            aria-selected={activeSection === 'toolkits'}
            aria-controls="vault-panel-toolkits"
            tabIndex={activeSection === 'toolkits' ? 0 : -1}
            onClick={() => setActiveSection('toolkits')}
            className="calm-c2-tab text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Plug className="w-3.5 h-3.5 text-amber-400" />
            <span>Connected Toolkits</span>
          </button>
        </div>

        <span className="hidden md:inline text-xs text-slate-400 truncate">
          Local IndexedDB Archive · Cross-Dossier Graph · Composio &amp; MCP Connectors
        </span>
      </div>

      {/* Vault Tab Panels */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <div
          id="vault-panel-dossiers"
          role="tabpanel"
          aria-labelledby="vault-tab-dossiers"
          hidden={activeSection !== 'dossiers'}
          className="h-full"
        >
          <div className="h-full p-2 sm:p-3 overflow-hidden">
            <WorkspaceFileViewer
              isOpen={activeSection === 'dossiers'}
              onClose={() => {}}
              initialFilePath={focusedFilePath}
              inlineMode={true}
              onSwitchToLinkBoard={() => setActiveSection('graph')}
            />
          </div>
        </div>

        <div
          id="vault-panel-graph"
          role="tabpanel"
          aria-labelledby="vault-tab-graph"
          hidden={activeSection !== 'graph'}
          className="h-full"
        >
          <div className="h-full p-2 sm:p-3 overflow-hidden">
            <BasementLinkBoardModal
              isOpen={activeSection === 'graph'}
              onClose={() => {}}
              inlineMode={true}
              onOpenVfsFile={(filePath) => {
                setFocusedFilePath(filePath);
                setActiveSection('dossiers');
              }}
              onDispatchCorrelation={onDispatchCorrelation}
            />
          </div>
        </div>

        <div
          id="vault-panel-toolkits"
          role="tabpanel"
          aria-labelledby="vault-tab-toolkits"
          hidden={activeSection !== 'toolkits'}
          className="h-full"
        >
          <div className="h-full overflow-y-auto p-3 sm:p-5">{toolkitsPanel}</div>
        </div>
      </div>
    </div>
  );
};

export default VaultWorkspaceView;
