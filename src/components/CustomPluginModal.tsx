import React, { useState } from 'react';
import { X, Plus, Play, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  CustomPluginConnector,
  executeCustomPlugin,
} from '../services/PluginMarketplaceService';

interface CustomPluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (plugin: CustomPluginConnector) => void;
  editingPlugin?: CustomPluginConnector | null;
}

export const CustomPluginModal: React.FC<CustomPluginModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingPlugin,
}) => {
  const { theme, playBeep } = useTheme();

  const [name, setName] = useState(editingPlugin?.name || '');
  const [endpointUrl, setEndpointUrl] = useState(editingPlugin?.endpointUrl || '');
  const [authHeaderKey, setAuthHeaderKey] = useState(editingPlugin?.authHeaderKey || 'Authorization');
  const [authHeaderValue, setAuthHeaderValue] = useState(editingPlugin?.authHeaderValue || '');
  const [toolFunctionName, setToolFunctionName] = useState(editingPlugin?.toolFunctionName || 'custom_api_query');
  const [description, setDescription] = useState(editingPlugin?.description || '');
  const [schemaJson, setSchemaJson] = useState(
    JSON.stringify(
      editingPlugin?.jsonSchemaParameters || {
        properties: {
          query: { type: 'STRING', description: 'Search keyword or parameter.' },
        },
        required: ['query'],
      },
      null,
      2
    )
  );

  const [testResult, setTestResult] = useState<{ loading: boolean; output?: string; error?: string } | null>(null);

  if (!isOpen) return null;

  const handleTestConnector = async () => {
    setTestResult({ loading: true });
    playBeep('tap');
    try {
      let parsedSchema: any;
      try {
        parsedSchema = JSON.parse(schemaJson);
      } catch {
        throw new Error('Invalid JSON schema format.');
      }

      const mockPlugin: CustomPluginConnector = {
        id: editingPlugin?.id || `plugin-${Date.now()}`,
        name: name.trim() || 'Test Plugin',
        endpointUrl: endpointUrl.trim(),
        authHeaderKey: authHeaderKey.trim(),
        authHeaderValue: authHeaderValue.trim(),
        toolFunctionName: toolFunctionName.trim() || 'custom_api_query',
        description: description.trim(),
        jsonSchemaParameters: parsedSchema,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      const result = await executeCustomPlugin(mockPlugin, { query: 'test' });
      setTestResult({
        loading: false,
        output: JSON.stringify(result, null, 2),
      });
      playBeep('complete');
    } catch (err: any) {
      setTestResult({
        loading: false,
        error: err?.message || 'Test fetch failed.',
      });
      playBeep('error');
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !endpointUrl.trim() || !toolFunctionName.trim()) return;

    let parsedSchema: any;
    try {
      parsedSchema = JSON.parse(schemaJson);
    } catch {
      alert('Please provide a valid JSON Schema for parameters.');
      return;
    }

    const plugin: CustomPluginConnector = {
      id: editingPlugin?.id || `plugin-${Date.now()}`,
      name: name.trim(),
      endpointUrl: endpointUrl.trim(),
      authHeaderKey: authHeaderKey.trim(),
      authHeaderValue: authHeaderValue.trim(),
      toolFunctionName: toolFunctionName.trim(),
      description: description.trim(),
      jsonSchemaParameters: parsedSchema,
      enabled: editingPlugin ? editingPlugin.enabled : true,
      createdAt: editingPlugin?.createdAt || new Date().toISOString(),
    };

    onSave(plugin);
    playBeep('complete');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl bg-[#11141c] border border-slate-800 p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{editingPlugin ? 'Configure Custom Connector' : 'Add Custom Plugin Connector'}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="custom-plugin-name" className="text-[11px] text-slate-300 font-medium cursor-pointer">Plugin Name</label>
              <input
                id="custom-plugin-name"
                name="plugin_name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Weather API, Jira, Custom Webhook"
                autoComplete="off"
                className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="custom-plugin-function-name" className="text-[11px] text-slate-300 font-medium cursor-pointer">Tool Function Name</label>
              <input
                id="custom-plugin-function-name"
                name="tool_function_name"
                type="text"
                value={toolFunctionName}
                onChange={(e) => setToolFunctionName(e.target.value)}
                placeholder="e.g., fetch_jira_tickets"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="custom-plugin-endpoint" className="text-[11px] text-slate-300 font-medium cursor-pointer">Endpoint URL / API Hook</label>
            <input
              id="custom-plugin-endpoint"
              name="endpoint_url"
              type="url"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.example.com/v1/data"
              autoComplete="url"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="custom-plugin-auth-header-key" className="text-[11px] text-slate-300 font-medium cursor-pointer">Auth Header Key</label>
              <input
                id="custom-plugin-auth-header-key"
                name="auth_header_key"
                type="text"
                value={authHeaderKey}
                onChange={(e) => setAuthHeaderKey(e.target.value)}
                placeholder="Authorization / X-Api-Key"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="custom-plugin-auth-token" className="text-[11px] text-slate-300 font-medium cursor-pointer">Auth Token / Secret</label>
              <input
                id="custom-plugin-auth-token"
                name="auth_token"
                type="password"
                value={authHeaderValue}
                onChange={(e) => setAuthHeaderValue(e.target.value)}
                placeholder="Bearer sk-..."
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="custom-plugin-description" className="text-[11px] text-slate-300 font-medium cursor-pointer">Description (Agent Instructions)</label>
            <input
              id="custom-plugin-description"
              name="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describes what this tool does so the AI agent knows when to invoke it."
              autoComplete="off"
              className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-300 font-medium">JSON Schema Parameters (Properties)</label>
            <textarea
              value={schemaJson}
              onChange={(e) => setSchemaJson(e.target.value)}
              rows={4}
              className="bg-[#12151f] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono-tabular text-slate-100 focus:outline-none focus:border-emerald-500 resize-none"
              required
            />
          </div>

          {/* Test Connector Sandbox Console */}
          <div className="rounded-xl bg-[#0a0a0c] border border-slate-800 p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Plugin Sandbox & Test Console</span>
              <button
                type="button"
                onClick={handleTestConnector}
                disabled={testResult?.loading || !endpointUrl.trim()}
                className="px-3 py-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-900 border border-emerald-600/60 text-xs font-medium text-emerald-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Play className={`w-3 h-3 ${testResult?.loading ? 'animate-spin' : ''}`} />
                <span>{testResult?.loading ? 'Testing...' : 'Test Connector'}</span>
              </button>
            </div>

            {testResult?.output && (
              <pre className="p-2.5 rounded bg-[#12151f] text-[10px] font-mono-tabular text-emerald-400 overflow-x-auto max-h-32">
                {testResult.output}
              </pre>
            )}
            {testResult?.error && (
              <p className="text-[11px] font-mono-tabular text-red-400">{testResult.error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-4 py-2 rounded-xl text-xs font-semibold text-slate-950 ${theme.accentBgClass} cursor-pointer hover:opacity-95`}
            >
              Save Connector
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
