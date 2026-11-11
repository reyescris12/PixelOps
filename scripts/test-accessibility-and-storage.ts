/**
 * Test Suite: Form Field Accessibility, Autofill Compliance, and Modern Storage Persistence API
 */

import { requestPersistentStorage } from '../src/services/CommandLedgerDb';
import * as fs from 'fs';
import * as path from 'path';

async function runTestSuite() {
  console.log('=== TEST 1: Modern navigator.storage.persist API Verification ===');

  let persistCalled = false;
  let logOutput: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    logOutput.push(args.join(' '));
    originalLog(...args);
  };

  // Mock navigator.storage in Node test environment
  const mockStorage = {
    persist: async () => {
      persistCalled = true;
      return true;
    },
    persisted: async () => false,
    estimate: async () => ({ usage: 1024, quota: 10485760 }),
  };

  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: mockStorage },
      configurable: true,
      writable: true,
    });
  } catch {
    (navigator as any).storage = mockStorage;
  }

  const granted = await requestPersistentStorage();
  console.log = originalLog;

  if (!persistCalled) {
    console.error('FAIL: navigator.storage.persist was not invoked by requestPersistentStorage!');
    process.exit(1);
  }

  if (!granted) {
    console.error('FAIL: requestPersistentStorage did not return true when persistence was granted!');
    process.exit(1);
  }

  const foundLog = logOutput.some((line) => line.includes('Storage persistence granted.'));
  if (!foundLog) {
    console.error('FAIL: Expected console log "Storage persistence granted." was not logged!');
    process.exit(1);
  }
  console.log('PASS: Modern navigator.storage.persist API successfully verified and logged.');

  console.log('\n=== TEST 2: Absence of Deprecated webkitPersistentStorage or StorageType.persistent ===');
  const srcDir = path.resolve(process.cwd(), 'src');
  function scanDir(dir: string, extFilter: RegExp): string[] {
    let files: string[] = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        files = files.concat(scanDir(full, extFilter));
      } else if (extFilter.test(item.name)) {
        files.push(full);
      }
    }
    return files;
  }

  const allSourceFiles = scanDir(srcDir, /\.(ts|tsx|js|jsx)$/);
  const deprecatedTerms = ['webkitPersistentStorage', 'StorageType.persistent', 'webkitStorageInfo'];
  let deprecatedFound = false;

  for (const file of allSourceFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const term of deprecatedTerms) {
      if (content.includes(term)) {
        console.error(`FAIL: Found deprecated term "${term}" in ${file}!`);
        deprecatedFound = true;
      }
    }
  }

  if (deprecatedFound) {
    process.exit(1);
  }
  console.log('PASS: Zero occurrences of deprecated webkitPersistentStorage or StorageType.persistent found in source.');

  console.log('\n=== TEST 3: Form Field Accessibility & Autofill (id and name attributes) ===');

  const filesToCheck = [
    {
      file: 'src/components/PluginMarketplace.tsx',
      requiredPairs: [
        { id: 'composio-api-key', name: 'composio_api_key' },
        { id: 'composio-search-query', name: 'composio_search_query' },
        { id: 'composio-auth-config-id', name: 'composio_auth_config_id' },
        { id: 'composio-client-id', name: 'composio_client_id' },
        { id: 'composio-client-secret', name: 'composio_client_secret' },
        { id: 'composio-bearer-token', name: 'composio_bearer_token' },
      ],
    },
    {
      file: 'src/components/SettingsModal.tsx',
      requiredPairs: [
        { id: 'openrouter-api-key', name: 'openrouter_api_key' },
        { id: 'llm-custom-endpoint', name: 'llm_custom_endpoint' },
        { id: 'osint-key-shodan', name: 'osint_key_shodan' },
        { id: 'osint-key-abuseipdb', name: 'osint_key_abuseipdb' },
        { id: 'osint-key-virustotal', name: 'osint_key_virustotal' },
        { id: 'osint-key-otx', name: 'osint_key_otx' },
        { id: 'osint-key-ipinfo', name: 'osint_key_ipinfo' },
        { id: 'osint-key-github', name: 'osint_key_github' },
      ],
    },
    {
      file: 'src/components/PluginAuthModal.tsx',
      requiredPairs: [
        { id: 'plugin-auth-apikey', name: 'plugin_auth_apikey' },
        { id: 'plugin-auth-handle', name: 'plugin_auth_handle' },
        { id: 'plugin-auth-endpoint', name: 'plugin_auth_endpoint' },
      ],
    },
    {
      file: 'src/components/SyncAccountModal.tsx',
      requiredPairs: [
        { id: 'sync-login-username', name: 'username' },
        { id: 'sync-login-password', name: 'password' },
        { id: 'sync-register-callsign', name: 'callsign' },
        { id: 'sync-register-username', name: 'username' },
        { id: 'sync-register-email', name: 'email' },
        { id: 'sync-register-password', name: 'password' },
        { id: 'sync-register-confirm-password', name: 'confirm_password' },
        { id: 'sync-recovery-username', name: 'recovery_username' },
        { id: 'sync-recovery-key', name: 'recovery_key' },
        { id: 'sync-recovery-new-password', name: 'new_password' },
        { id: 'sync-recovery-confirm-password', name: 'confirm_new_password' },
      ],
    },
    {
      file: 'src/components/CustomPluginModal.tsx',
      requiredPairs: [
        { id: 'custom-plugin-name', name: 'plugin_name' },
        { id: 'custom-plugin-function-name', name: 'tool_function_name' },
        { id: 'custom-plugin-endpoint', name: 'endpoint_url' },
        { id: 'custom-plugin-auth-header-key', name: 'auth_header_key' },
        { id: 'custom-plugin-auth-token', name: 'auth_token' },
        { id: 'custom-plugin-description', name: 'description' },
      ],
    },
    {
      file: 'src/components/AgentEditorModal.tsx',
      requiredPairs: [
        { id: 'agent-editor-codename', name: 'agent_codename' },
        { id: 'agent-editor-role', name: 'agent_role' },
        { id: 'agent-editor-specialty', name: 'agent_specialty' },
      ],
    },
    {
      file: 'src/components/FeedbackTerminal.jsx',
      requiredPairs: [
        { id: 'resend-api-key-input', name: 'resend_api_key' },
        { id: 'feedback-callsign', name: 'feedback_callsign' },
        { id: 'feedback-email', name: 'feedback_email' },
      ],
    },
    {
      file: 'src/components/WorkspaceFileViewer.tsx',
      requiredPairs: [
        { id: 'vfs-search-query', name: 'vfs_search_query' },
        { id: 'vfs-new-folder-name', name: 'new_folder_name' },
        { id: 'vfs-custom-move-folder', name: 'custom_move_folder' },
        { id: 'vfs-new-file-path', name: 'new_file_path' },
      ],
    },
  ];

  for (const { file, requiredPairs } of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), file);
    const content = fs.readFileSync(fullPath, 'utf-8');

    for (const pair of requiredPairs) {
      if (!content.includes(pair.id)) {
        console.error(`FAIL: Missing id="${pair.id}" in ${file}!`);
        process.exit(1);
      }
      if (!content.includes(pair.name)) {
        console.error(`FAIL: Missing name="${pair.name}" in ${file}!`);
        process.exit(1);
      }
    }
    console.log(`PASS: ${file} verified with all ${requiredPairs.length} id/name attributes.`);
  }

  console.log('\n=== ALL ACCESSIBILITY & STORAGE TESTS PASSED SUCCESSFULLY! ===');
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
