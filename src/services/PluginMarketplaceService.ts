import { getPluginCredential } from '../engine/pluginAuthManager';

export interface CustomPluginConnector {
  id: string;
  name: string;
  endpointUrl: string;
  authHeaderKey: string;
  authHeaderValue: string;
  toolFunctionName: string;
  description: string;
  jsonSchemaParameters: {
    properties: Record<string, { type: 'STRING' | 'NUMBER' | 'BOOLEAN'; description: string }>;
    required: string[];
  };
  enabled: boolean;
  createdAt: string;
}

const STORAGE_CUSTOM_PLUGINS_KEY = 'pixelops_custom_market_plugins_v1';

export const DEFAULT_CUSTOM_PLUGINS: CustomPluginConnector[] = [];

export function loadCustomPlugins(): CustomPluginConnector[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_PLUGINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter out retired fake crypto telemetry stub
    return parsed.filter(
      (p) =>
        p.id !== 'plugin-crypto-tracker' &&
        p.toolFunctionName !== 'crypto_market_telemetry'
    );
  } catch {
    return [];
  }
}

export function saveCustomPlugins(plugins: CustomPluginConnector[]) {
  try {
    localStorage.setItem(STORAGE_CUSTOM_PLUGINS_KEY, JSON.stringify(plugins));
  } catch {
    // Ignore
  }
}

/**
 * Executes a custom user-defined plugin API call at runtime.
 */
export async function executeCustomPlugin(
  plugin: CustomPluginConnector,
  args: Record<string, any>
): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Check stored BYOK credentials from local storage
  const byokCred = getPluginCredential(plugin.id);
  if (plugin.authHeaderKey && (plugin.authHeaderValue || byokCred?.apiKey)) {
    headers[plugin.authHeaderKey] = plugin.authHeaderValue || byokCred?.apiKey || '';
  } else if (byokCred?.apiKey) {
    headers['Authorization'] = byokCred.apiKey.startsWith('Bearer ')
      ? byokCred.apiKey
      : `Bearer ${byokCred.apiKey}`;
  }

  const isGet = !plugin.endpointUrl.includes('POST') && !plugin.endpointUrl.includes('PUT');
  let url = plugin.endpointUrl;

  const res = await fetch(url, {
    method: isGet ? 'GET' : 'POST',
    headers,
    body: isGet ? undefined : JSON.stringify(args),
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }
  return { text: await res.text(), status: res.status };
}
