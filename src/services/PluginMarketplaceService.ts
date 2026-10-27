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

export const DEFAULT_CUSTOM_PLUGINS: CustomPluginConnector[] = [
  {
    id: 'plugin-crypto-tracker',
    name: 'Crypto Market Telemetry',
    endpointUrl: 'https://api.coincap.io/v2/assets?limit=5',
    authHeaderKey: '',
    authHeaderValue: '',
    toolFunctionName: 'crypto_market_telemetry',
    description: 'Queries live cryptocurrency asset prices, market caps, and volume statistics from CoinCap.',
    jsonSchemaParameters: {
      properties: {
        assetName: {
          type: 'STRING',
          description: 'Optional cryptocurrency symbol or name to filter (e.g. bitcoin, ethereum).',
        },
      },
      required: [],
    },
    enabled: true,
    createdAt: new Date().toISOString(),
  },
];

export function loadCustomPlugins(): CustomPluginConnector[] {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM_PLUGINS_KEY);
    if (!raw) return DEFAULT_CUSTOM_PLUGINS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_CUSTOM_PLUGINS;
  } catch {
    return DEFAULT_CUSTOM_PLUGINS;
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
