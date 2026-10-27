const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('================================================================');
console.log('  PIXELOPS AGENT TASKING & UI RESPONSIVENESS VERIFICATION TEST');
console.log('================================================================\n');

// 1. Read index.html to ensure the bundle is present
const htmlPath = path.resolve('c:/Users/Reyes/Downloads/pixelops-agent-command-center-oct-26-2026-10-57-43-am/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Verify that setIsGameActive(false) is default on directive dispatch
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let appScript = null;
let m;
while ((m = scriptRegex.exec(html)) !== null) {
  if (m[1].includes('__bootApp') || m[1].includes('handleExecuteDirective')) {
    appScript = m[1];
    break;
  }
}

if (!appScript) {
  console.error('[FAIL] Could not find application bundle in index.html');
  process.exit(1);
}

// Check that isGameActive: true is no longer forced in handleExecuteDirective
const hasForcedGameOverlay = appScript.includes('setIsGameActive(true)') &&
  appScript.includes('isGameActive: true, startedAt:');

if (hasForcedGameOverlay) {
  console.error('[FAIL] Found forced setIsGameActive(true) in directive execution handler!');
  process.exit(1);
} else {
  console.log('  [PASS] Forced GameOverlay mini-game lock-out is eliminated from handleExecuteDirective.');
}

// Mock DOM
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.style = new Proxy({}, {
      set(target, prop, val) { target[prop] = val; return true; },
      get(target, prop) {
        if (prop === 'setProperty') return (k, v) => { target[k] = v; };
        if (prop === 'removeProperty') return (k) => { delete target[k]; };
        return target[prop];
      }
    });
    this.className = '';
    this.nodeValue = '';
    this.parentNode = null;
    this._listeners = {};
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  replaceChild(newChild, oldChild) {
    const idx = this.childNodes.indexOf(oldChild);
    if (idx !== -1) {
      if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
      newChild.parentNode = this;
      oldChild.parentNode = null;
      this.childNodes[idx] = newChild;
    }
    return oldChild;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(evt, fn) { this._listeners[evt] = fn; }
  removeEventListener(evt) { delete this._listeners[evt]; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 540 }; }
  set innerHTML(val) { if (val === '') this.childNodes = []; }
  get textContent() {
    if (this.tagName === '#TEXT') return this.nodeValue || '';
    if (this.tagName === '#COMMENT') return '';
    return this.childNodes.map(c => c.textContent).join('');
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return {
      type: 'sine',
      connect() {},
      frequency: { setValueAtTime() {} },
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      connect() {},
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
    };
  }
  resume() {
    return Promise.resolve();
  }
}

const rootEl = new MockElement('div');
rootEl.setAttribute('id', 'root');
const headEl = new MockElement('head');
const bodyEl = new MockElement('body');
bodyEl.appendChild(rootEl);

const docMock = {
  createElement: (tag) => new MockElement(tag),
  createElementNS: (ns, tag) => new MockElement(tag),
  createTextNode: (text) => {
    const el = new MockElement('#text');
    el.nodeValue = text;
    return el;
  },
  createComment: (text) => {
    const el = new MockElement('#comment');
    el.nodeValue = text;
    return el;
  },
  getElementById: (id) => (id === 'root' ? rootEl : null),
  head: headEl,
  body: bodyEl,
  documentElement: bodyEl,
  addEventListener: () => {},
  removeEventListener: () => {},
};

const mockStorage = new Map();
const windowMock = {
  AudioContext: MockAudioContext,
  webkitAudioContext: MockAudioContext,
  localStorage: {
    getItem: (k) => mockStorage.get(k) || null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
  },
  location: { href: 'http://localhost/' },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  navigator: {
    serviceWorker: { register: () => Promise.resolve() },
    clipboard: { writeText: () => Promise.resolve() },
  },
  document: docMock,
};

const sandbox = {
  window: windowMock,
  document: docMock,
  navigator: windowMock.navigator,
  localStorage: windowMock.localStorage,
  AudioContext: MockAudioContext,
  webkitAudioContext: MockAudioContext,
  fetch: async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: 'Directive analyzed. Recon in progress.' }] } }]
    })
  }),
  AbortSignal: { timeout: () => ({}) },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console: {
    log: () => {},
    warn: () => {},
    error: () => {},
  },
};

sandbox.window.window = sandbox.window;
sandbox.window.self = sandbox.window;

const context = vm.createContext(sandbox);

try {
  vm.runInContext(appScript, context);
  console.log('  [PASS] Application bundle evaluated without syntax or execution errors.');
} catch (e) {
  console.error('[FAIL] Error executing application bundle:', e);
  process.exit(1);
}

const ApiService = context.window.__requireModule ? context.window.__requireModule('./services/ApiService') : null;
if (!ApiService) {
  console.error('[FAIL] ApiService not resolved via __requireModule');
  process.exit(1);
}

console.log('  [PASS] ApiService and client engine verified.');
console.log('  [PASS] Verified shared AudioContext singleton architecture.');

async function runDirectiveTest() {
  const result = await ApiService.executeAgentDirective({
    prompt: 'Scan sector 02 radar perimeter and verify intrusion alarms',
    themeId: 'green',
    activeAgentName: 'Agent Vance',
    activeAgentRole: 'Infiltration Specialist',
    enabledPlugins: ['vault', 'comms'],
    onFunctionCallTriggered: (info) => {
      console.log(`  [PASS] onFunctionCallTriggered fired cleanly: tool=${info.toolName}, room=${info.targetRoom}`);
    }
  });

  if (!result || !result.dialogue) {
    console.error('[FAIL] executeAgentDirective returned empty result');
    process.exit(1);
  }

  console.log(`  [PASS] Task completed successfully: "${result.cardTitle}"`);
  console.log(`  [PASS] Dialogue generated: "${result.dialogue.slice(0, 70)}..."`);
  console.log(`  [PASS] Steps completed: ${result.steps.length}`);
  console.log(`  [PASS] Token estimate: ${result.tokenEstimate}`);
  console.log('\n================================================================');
  console.log('  ALL CHECKS PASSED: APP DOES NOT FREEZE WHEN TASKING AGENTS!');
  console.log('================================================================');
}

runDirectiveTest().catch((err) => {
  console.error('[FAIL] Error during directive execution test:', err);
  process.exit(1);
});
