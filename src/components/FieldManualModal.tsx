/**
 * FieldManualModal.tsx - PixelOps Classified Safehouse Field Manual & Operative Handbook
 * 
 * Provides comprehensive operational intelligence:
 * - Safehouse Grid & 7 Sectors
 * - Managing Operatives & Memory Clearance Progression
 * - Night Shift Background Worker Configuration
 * - Transparent API Keys (BYOK: Gemini 3.1 Flash Lite) vs. Hosted Pro Pass Guide
 * - Complete Command Encyclopedia for Briefing Terminal & Headless CLI
 * - Exhaustive Composio Integrations Guide (Gmail, GitHub, Slack, Calendar, Notion, Linear)
 * - Performance Secrets & Pro-Tips
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  BookOpen,
  Compass,
  Users,
  Moon,
  KeyRound,
  Terminal,
  Zap,
  Check,
  Copy,
  Search,
  Shield,
  Server,
  Radio,
  FileText,
  Clock,
  Sparkles,
  ExternalLink,
  Code2,
  Mail,
  Send,
  CloudSun,
  Database,
  Calendar,
  Layers,
  AlertTriangle,
  Radar,
  FolderTree,
  Workflow,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export interface FieldManualModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt?: (samplePrompt: string) => void;
}

type ManualSectionId = 'grid' | 'recon' | 'operatives' | 'vfs' | 'workflows' | 'nightshift' | 'auth' | 'commands' | 'composio' | 'protips';
type CommandCategoryFilter = 'all' | 'terminal' | 'composio' | 'chaining' | 'reports' | 'code' | 'cli' | 'diagnostics';

interface CommandExample {
  title: string;
  category: 'Task Chaining' | 'Report Generation' | 'Composio & External' | 'CLI Console' | 'Code & Eval' | 'Diagnostics' | 'Research & Tools';
  prompt: string;
  description: string;
  leadOperative: 'Vance' | 'Cipher' | 'Nyx' | 'Any Operative';
  targetSector: string;
  channel: 'terminal' | 'cli' | 'both';
}

const COMMAND_CATALOG: CommandExample[] = [
  // ==========================================
  // 1. TASK CHAINING & MULTI-AGENT WORKFLOWS
  // ==========================================
  {
    title: 'Autonomous Multi-Agent Task Chain (Compound Prompt)',
    category: 'Task Chaining',
    channel: 'terminal',
    prompt: 'Vance, search for modern zero-trust architecture guidelines and compile the key principles. Then Cipher, write this out into a security report file zero_trust_brief.md. Finally Nyx, verify and prepare a mission summary.',
    description: 'Decomposes prompt into 3 sequential phases, moves operatives to War Room, Library, and Comms Tower, transfers intermediate findings, and auto-uploads the report.',
    leadOperative: 'Vance',
    targetSector: 'War Room ➔ Library ➔ Comms Tower',
  },
  {
    title: 'Numbered Multi-Phase Operational Pipeline',
    category: 'Task Chaining',
    channel: 'terminal',
    prompt: '1. Vance research GitHub Actions CI/CD security best practices. 2. Cipher write a hardened workflow template and audit summary to reports/ci_cd_security.md. 3. Nyx dispatch notice to lead@company.com.',
    description: 'Executes numbered steps sequentially with zero user intervention between phases, passing file paths and research context forward.',
    leadOperative: 'Vance',
    targetSector: 'War Room ➔ Server Vault ➔ Comms Tower',
  },
  {
    title: 'Explicit Workflow Directive Prefix',
    category: 'Task Chaining',
    channel: 'terminal',
    prompt: 'workflow: Vance audit token bucket algorithm, after that have Cipher patch the rate limiter utility, and then have Nyx broadcast completion on Slack #alerts',
    description: 'Uses the "workflow:" or "chain:" prefix to force multi-agent orchestration across safehouse sectors.',
    leadOperative: 'Vance',
    targetSector: 'War Room ➔ Server Vault ➔ Comms Tower',
  },
  {
    title: 'Headless Task Chain via CLI Console',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops chain Vance research memory isolation in WASM, then Cipher draft benchmark script, then Nyx log summary',
    description: 'Triggers the autonomous multi-agent task chain engine directly from the tactical CLI terminal (~).',
    leadOperative: 'Vance',
    targetSector: 'Safehouse Multi-Sector Grid',
  },

  // ==========================================
  // 2. REPORT GENERATION & WORKSPACE FILES (VFS)
  // ==========================================
  {
    title: 'Automated Report Generation & IndexedDB Upload',
    category: 'Report Generation',
    channel: 'terminal',
    prompt: 'Cipher, write a comprehensive security report on zero-trust architecture guidelines and save to reports/zero_trust_brief.md',
    description: 'Synthesizes executive summary, defensive principles, verification matrix, and auto-uploads the file to Dexie IndexedDB workspace files.',
    leadOperative: 'Cipher',
    targetSector: 'Library Archives (library_archive_terminal)',
  },
  {
    title: 'Safehouse Perimeter Defense Audit Brief',
    category: 'Report Generation',
    channel: 'terminal',
    prompt: 'generate an audit brief for safehouse perimeter defenses with threat matrix and action items',
    description: 'Compiles technical defense audit, evaluates physical/cryptographic boundaries, and commits to reports/safehouse_perimeter_defenses_audit.md.',
    leadOperative: 'Cipher',
    targetSector: 'Library Archives',
  },
  {
    title: 'Incident Postmortem Report',
    category: 'Report Generation',
    channel: 'terminal',
    prompt: 'create an incident postmortem report titled "Q3 API Latency Spike & Gateway Recovery" and upload to workspace',
    description: 'Generates structured postmortem with root cause analysis, timeline, remediation steps, and commits to IndexedDB.',
    leadOperative: 'Cipher',
    targetSector: 'Library Archives',
  },
  {
    title: 'List Workspace Files via CLI',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops files reports',
    description: 'Queries Dexie IndexedDB and displays all agent-generated markdown reports, logs, and configs.',
    leadOperative: 'Any Operative',
    targetSector: 'Library Archives',
  },
  {
    title: 'Inspect Workspace Report Content via CLI',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops cat reports/zero_trust_brief.md',
    description: 'Reads and outputs the exact Markdown content of a workspace report in the console.',
    leadOperative: 'Any Operative',
    targetSector: 'Library Archives',
  },
  {
    title: 'S2 Underground Wire Ingestion & BLUF SITREP Sweep',
    category: 'Report Generation',
    channel: 'terminal',
    prompt: 'Vance, ingest the latest S2 Underground text dispatches, extract the BLUF and key SITREP anomalies, and compile a structured threat matrix report',
    description: 'Parses clean SITREP text blocks with //The Wire//, //BLUF://, and //END REPORT// formatting directly into agent prompt context with persistent, non-gibberish titles.',
    leadOperative: 'Vance',
    targetSector: 'War Room ➔ Library Archives',
  },
  {
    title: 'Tactical Satellite Reconnaissance & Geocoding Lock',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'scan satellite imagery of Suez Canal and Red Sea subsea cable corridor',
    description: 'Locks the Orbital Recon Monitor modal directly onto target coordinates with 1:1 uncropped square WMTS tiles, CRT shader filters, and real-time live telemetry.',
    leadOperative: 'Nyx',
    targetSector: 'Tactical Recon Monitor Modal',
  },
  {
    title: 'Postal Code & Global City Satellite Lock',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'lock satellite recon on postal code SW1A 1AA London',
    description: 'Zero-key multi-source geocoding instantly resolves postal codes (ZIP, UK, Canadian, EU) and auto-centers the live Esri high-res optical imagery.',
    leadOperative: 'Nyx',
    targetSector: 'Tactical Recon Monitor Modal',
  },

  // ==========================================
  // 3. COMPOSIO EXTERNAL ACTIONS (BRIEFING TERMINAL)
  // ==========================================
  {
    title: 'Gmail: Outbound Email Dispatch',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'Nyx, send an email to lead@company.com with subject "Operational Clearance" saying "All perimeter sectors verified nominal."',
    description: 'Extracts recipient, subject, and body, checks OAuth credentials in Armory, and dispatches email live via Google Workspace / Gmail.',
    leadOperative: 'Nyx',
    targetSector: 'Comms Tower (comms_broadcast_desk)',
  },
  {
    title: 'Gmail: Inbox Sweeps & Unread Emails',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'Nyx, check my emails and fetch latest unread messages from inbox',
    description: 'Executes GMAIL_FETCH_EMAILS on the user connected Gmail account and summarizes latest message senders and snippets.',
    leadOperative: 'Nyx',
    targetSector: 'Comms Tower',
  },
  {
    title: 'GitHub: Create Repository Issue',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'Cipher, create an issue in my-org/my-project titled "Implement token bucket rate limiter for external webhooks" saying "Priority high. Enforce 100 req/min."',
    description: 'Parses repository owner/name, title, and body parameters and files an issue live via user connected GitHub account.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault (vault_core_rack)',
  },
  {
    title: 'GitHub: Star Repository',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'star repo owner/repository',
    description: 'Executes GITHUB_STAR_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER on the authenticated GitHub account.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'Slack: Post Channel Broadcast',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'Nyx, send a slack message to #operations saying "Night Shift automated security scan completed with zero detected anomalies."',
    description: 'Parses channel and text, executes SLACK_CHAT_POST_MESSAGE on user connected Slack workspace.',
    leadOperative: 'Nyx',
    targetSector: 'Comms Tower',
  },
  {
    title: 'Google Calendar: Schedule Tactical Briefing',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'schedule calendar event titled "Quarterly Strategic Alignment" at "Tomorrow 14:00 UTC" with attendees team@domain.com',
    description: 'Parses title, datetime, and attendees, and creates an event on Google Calendar via Composio.',
    leadOperative: 'Nyx',
    targetSector: 'Comms Tower',
  },
  {
    title: 'Notion: Create Workspace Documentation Page',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'create notion page titled "Safehouse Zero-Trust Protocol" in workspace with content "Operational rules and key rotation policies."',
    description: 'Formats content into Notion blocks and creates a new document page in the user authorized Notion workspace.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'Linear: Create Engineering Ticket',
    category: 'Composio & External',
    channel: 'terminal',
    prompt: 'create linear issue titled "Audit VFS Storage Quotas" with description "Implement automatic LRU eviction for files older than 30 days."',
    description: 'Creates a prioritized ticket in the user connected Linear workspace via Composio API.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },

  // ==========================================
  // 4. COMPOSIO CLI COMMANDS
  // ==========================================
  {
    title: 'CLI: Inspect Composio Engine & Accounts',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio status',
    description: 'Inspects user entityId isolation, BYOK API key source, ping connectivity, and online third-party account states.',
    leadOperative: 'Any Operative',
    targetSector: 'Armory',
  },
  {
    title: 'CLI: Initiate OAuth App Connection',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio connect github',
    description: 'Opens centered browser OAuth popup bridge to connect GitHub, Gmail, Slack, Notion, or Linear with polling callback.',
    leadOperative: 'Any Operative',
    targetSector: 'Armory',
  },
  {
    title: 'CLI: List Available Toolkits',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio list',
    description: 'Displays full catalog of available Composio integrations, action schemas, and connection statuses.',
    leadOperative: 'Any Operative',
    targetSector: 'Armory',
  },
  {
    title: 'CLI: Set Custom Composio API Key',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio key comp_live_xxxxxxxxxxxx',
    description: 'Saves and persists a custom Composio BYOK API key for direct browser REST execution.',
    leadOperative: 'Any Operative',
    targetSector: 'Master Vault',
  },
  {
    title: 'CLI: Execute Raw Tool Action',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio run GMAIL_SEND_EMAIL \'{"recipient_email":"team@domain.com","subject":"Alert","body":"Perimeter clear"}\'',
    description: 'Executes a raw action directly against the connected third-party app with JSON parameters.',
    leadOperative: 'Any Operative',
    targetSector: 'Comms Tower',
  },
  {
    title: 'CLI: Run Autonomous Agent with Tool Tools',
    category: 'CLI Console',
    channel: 'cli',
    prompt: 'pixelops composio agent "Check my unread emails and check issues in owner/repo on GitHub"',
    description: 'Deploys an autonomous Gemini agent with dynamic tool bindings across all connected accounts.',
    leadOperative: 'Vance',
    targetSector: 'War Room',
  },

  // ==========================================
  // 5. CODE DRAFTING & JS/TS SANDBOX EVALUATION
  // ==========================================
  {
    title: 'TypeScript Debounce Utility with Verification',
    category: 'Code & Eval',
    channel: 'terminal',
    prompt: 'Cipher, write a typescript debounce utility with immediate execution flag and run verification tests',
    description: 'Architects TypeScript logic and executes verification client-side in the Web Worker code sandbox.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'Binary Search Algorithm Implementation',
    category: 'Code & Eval',
    channel: 'terminal',
    prompt: 'Cipher, write a binary search algorithm in python with time complexity analysis and test cases',
    description: 'Produces clean, commented Python algorithm with O(log n) efficiency proofs.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'String Reversal & Palindrome Checker',
    category: 'Code & Eval',
    channel: 'terminal',
    prompt: 'write a function to test if a string is a palindrome in javascript',
    description: 'Implements alphanumeric normalization and palindrome verification with test suite.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'Array Sorting by Custom Object Property',
    category: 'Code & Eval',
    channel: 'terminal',
    prompt: 'Cipher, implement an array sort function for object lists with asc/desc toggle in javascript',
    description: 'Generates non-mutating sort logic with comparator functions.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },

  // ==========================================
  // 6. RESEARCH, MATH & ATMOSPHERIC TOOLS
  // ==========================================
  {
    title: 'Live Web Intel Ingestion',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'Vance, search the web for latest quantum computing encryption standards and compile top takeaways',
    description: 'Executes verified live web search tool, extracts knowledge snippets, and summarizes findings into mission brief.',
    leadOperative: 'Vance',
    targetSector: 'Comms Tower',
  },
  {
    title: 'Atmospheric / Weather Radar Query',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'check the weather and 3-day forecast in Tokyo',
    description: 'Queries Open-Meteo API for real-time temperature, wind speed, precipitation, and conditions.',
    leadOperative: 'Nyx',
    targetSector: 'Comms Tower',
  },
  {
    title: 'Mathematical Computation & Precision Eval',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'calculate (144 * 12) / 3.14159',
    description: 'Evaluates arithmetic expression with precision checks client-side.',
    leadOperative: 'Cipher',
    targetSector: 'Server Vault',
  },
  {
    title: 'Operative Memory Vector Recall',
    category: 'Research & Tools',
    channel: 'terminal',
    prompt: 'recall previous findings on zero-trust architecture guidelines from your memory log',
    description: 'Scans the operative append-only memory bank and returns historical task summaries.',
    leadOperative: 'Vance',
    targetSector: 'War Room',
  },

  // ==========================================
  // 7. DIAGNOSTICS & SYSTEM DRILLS
  // ==========================================
  {
    title: 'Diagnostic Overheat Circuit Breaker Drill',
    category: 'Diagnostics',
    channel: 'terminal',
    prompt: '[DRILL:429]',
    description: 'Simulates HTTP 429 Rate Limit error to test retro circuit-breaker modal and cooldown countdown timer.',
    leadOperative: 'Any Operative',
    targetSector: 'System Diagnostic',
  },
  {
    title: 'Diagnostic Auth Failure Drill',
    category: 'Diagnostics',
    channel: 'terminal',
    prompt: '[DRILL:401]',
    description: 'Simulates HTTP 401 Invalid Key error to verify Vault error handling and recovery prompt.',
    leadOperative: 'Any Operative',
    targetSector: 'Master Vault',
  },
  {
    title: 'Diagnostic Network Sever Drill',
    category: 'Diagnostics',
    channel: 'terminal',
    prompt: '[DRILL:NET]',
    description: 'Simulates network drop (TypeError: Failed to fetch) to test offline fallback handling.',
    leadOperative: 'Any Operative',
    targetSector: 'Comms Tower',
  },
  {
    title: 'Diagnostic Malformed JSON Drill',
    category: 'Diagnostics',
    channel: 'terminal',
    prompt: '[DRILL:JSON]',
    description: 'Simulates SyntaxError: Unexpected token < in JSON at position 0 to test JSON repair guards.',
    leadOperative: 'Any Operative',
    targetSector: 'Server Vault',
  },
];

export const FieldManualModal: React.FC<FieldManualModalProps> = ({
  isOpen,
  onClose,
  onSelectPrompt,
}) => {
  const { playBeep } = useTheme();
  const [activeSection, setActiveSection] = useState<ManualSectionId>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CommandCategoryFilter>('all');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    playBeep('tap');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const filteredCommands = useMemo(() => {
    return COMMAND_CATALOG.filter((cmd) => {
      // Category filter
      if (categoryFilter === 'terminal' && cmd.channel === 'cli') return false;
      if (categoryFilter === 'cli' && cmd.channel === 'terminal') return false;
      if (categoryFilter === 'composio' && !cmd.category.includes('Composio')) return false;
      if (categoryFilter === 'chaining' && cmd.category !== 'Task Chaining') return false;
      if (categoryFilter === 'reports' && cmd.category !== 'Report Generation') return false;
      if (categoryFilter === 'code' && cmd.category !== 'Code & Eval') return false;
      if (categoryFilter === 'diagnostics' && cmd.category !== 'Diagnostics') return false;

      // Text search query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        cmd.title.toLowerCase().includes(q) ||
        cmd.prompt.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.leadOperative.toLowerCase().includes(q) ||
        cmd.targetSector.toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-[#0f1118] border-2 border-[#e59838] shadow-[0_0_35px_rgba(229,152,56,0.35)] text-[#f3ead8] font-mono-tabular overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Classified Header Bar */}
        <div className="bg-[#181510] border-b border-[#e59838] px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <BookOpen className="w-5 h-5 text-[#e59838]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold text-[#e59838] tracking-wider uppercase">
                  CLASSIFIED // SAFEHOUSE FIELD MANUAL
                </span>
                <span className="hidden sm:inline px-1.5 py-0.2 bg-[#e59838]/20 border border-[#e59838]/60 text-[#fde047] text-[10px] font-bold">
                  SEC-LEVEL: OMEGA
                </span>
                <span className="hidden md:inline px-1.5 py-0.2 bg-[#38bdf8]/20 border border-[#38bdf8]/60 text-[#38bdf8] text-[10px] font-bold">
                  ENGINE: GEMINI 3.8 FLASH
                </span>
              </div>
              <p className="text-[10px] text-[#9c8265]">
                PixelOps Agent Command Center v3.4 · Operative Tactical Handbook & Directive Guide
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="p-1 hover:bg-[#2a2217] text-[#c5c9d6] hover:text-[#f3ead8] border border-transparent hover:border-[#e59838] cursor-pointer transition-colors"
            title="Close Field Manual (ESC)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tactical Sub-Navigation Ribbon */}
        <div className="bg-[#12131c] border-b border-[#2d3246] px-3 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shrink-0">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setActiveSection('grid');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'grid'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>1. Safehouse Grid</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('recon');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'recon'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Radar className="w-3.5 h-3.5" />
              <span>2. Recon Monitor</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('operatives');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'operatives'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>3. Operatives & Memory</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('vfs');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'vfs'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>4. Workspace Files</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('workflows');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'workflows'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Workflow className="w-3.5 h-3.5" />
              <span>5. Workflows & Playbooks</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('nightshift');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'nightshift'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>6. Night Shift</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('auth');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'auth'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>7. BYOK & Pro Pass</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('commands');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'commands'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>8. Commands ({COMMAND_CATALOG.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('composio');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'composio'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>9. Composio</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveSection('protips');
                playBeep('tap');
              }}
              className={`px-2.5 py-1 border transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSection === 'protips'
                  ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold shadow-[0_0_10px_rgba(229,152,56,0.4)]'
                  : 'bg-[#181a24] text-[#cbd5e1] border-[#363d54] hover:border-[#e59838]'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>10. Pro-Tips</span>
            </button>
          </div>
        </div>

        {/* Scrollable Manual Body */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6 text-sm text-[#cbd5e1] leading-relaxed">
          {/* ========================================================= */}
          {/* SECTION 1: THE SAFEHOUSE GRID */}
          {/* ========================================================= */}
          {activeSection === 'grid' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Compass className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 01 // THE SAFEHOUSE SECTOR GRID</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  PixelOps safehouse is divided into 7 specialized isometric sectors. Each sector houses distinct workstation rigs, local runtime tools, and specialized operative capabilities.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Comms Tower */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#38bdf8] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#38bdf8] flex items-center gap-1.5">
                      <Radio className="w-4 h-4" /> Comms Tower [SEC-03]
                    </span>
                    <span className="text-[10px] bg-[#38bdf8]/10 text-[#38bdf8] px-1.5 py-0.5 border border-[#38bdf8]/30">
                      External Data & APIs
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    Primary broadcast uplink for external web lookups, weather forecasts, outgoing Gmail/Slack dispatches, and webhook relays.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Station:</strong> Comms Broadcast Desk<br />
                    <strong>Lead Operative:</strong> Nyx (Signal Specialist)<br />
                    <strong>Active Tools:</strong> live_web_search, weather_lookup, composio_gmail, composio_slack
                  </div>
                </div>

                {/* Server Vault */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#4ade80] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#4ade80] flex items-center gap-1.5">
                      <Server className="w-4 h-4" /> Server Vault [SEC-02]
                    </span>
                    <span className="text-[10px] bg-[#4ade80]/10 text-[#4ade80] px-1.5 py-0.5 border border-[#4ade80]/30">
                      VFS & Code Sandbox
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    High-security computational core. Executes client-side code sandbox evaluations, GitHub issue creation, and algorithmic tests.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Station:</strong> Vault Core Rack<br />
                    <strong>Lead Operative:</strong> Cipher (Cryptographic Engineer)<br />
                    <strong>Active Tools:</strong> code_sandbox_eval, github_integration, memory_vector_lookup
                  </div>
                </div>

                {/* War Room */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#e59838] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#e59838] flex items-center gap-1.5">
                      <Shield className="w-4 h-4" /> War Room [SEC-01]
                    </span>
                    <span className="text-[10px] bg-[#e59838]/10 text-[#e59838] px-1.5 py-0.5 border border-[#e59838]/30">
                      Strategy & Town Hall
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    Central command operations. Coordinates multi-agent task chains, high-level intelligence synthesis, and Town Hall roundtable meetings.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Station:</strong> War Center Desk<br />
                    <strong>Lead Operative:</strong> Vance (Tactical Strategist)<br />
                    <strong>Active Tools:</strong> town_hall_roundtable, task_chain_orchestrator, executive_synthesis
                  </div>
                </div>

                {/* Library Archives */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#a855f7] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#a855f7] flex items-center gap-1.5">
                      <FileText className="w-4 h-4" /> Library Archives [SEC-05]
                    </span>
                    <span className="text-[10px] bg-[#a855f7]/10 text-[#a855f7] px-1.5 py-0.5 border border-[#a855f7]/30">
                      Workspace Reports & VFS
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    Repository of agent-generated markdown reports, intelligence briefs, and permanent workspace records stored in IndexedDB.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Station:</strong> Library Archive Terminal<br />
                    <strong>Lead Operative:</strong> Cipher / Research Squad<br />
                    <strong>Active Tools:</strong> fs_storage_manager, workspace_report_generator
                  </div>
                </div>

                {/* Armory */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#f97316] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#f97316] flex items-center gap-1.5">
                      ⚔️ Armory [SEC-04]
                    </span>
                    <span className="text-[10px] bg-[#f97316]/10 text-[#f97316] px-1.5 py-0.5 border border-[#f97316]/30">
                      Composio Toolkits & Gear
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    Connect external app integrations (Gmail, GitHub, Slack, Notion, Linear, Calendar) via OAuth and inspect active gear configurations.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Station:</strong> Armory Tactical Workbench<br />
                    <strong>Capabilities:</strong> OAuth popup bridge, account verification, token status
                  </div>
                </div>

                {/* Archive Basement & Lounge */}
                <div className="p-3 bg-[#131622] border border-[#2b354f] rounded-none hover:border-[#94a3b8] transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-[#cbd5e1] flex items-center gap-1.5">
                      🛋️ Lounge [SEC-06] & Archive [SEC-07]
                    </span>
                    <span className="text-[10px] bg-[#94a3b8]/10 text-[#94a3b8] px-1.5 py-0.5 border border-[#94a3b8]/30">
                      Ledger & Downtime
                    </span>
                  </div>
                  <p className="text-xs text-[#94a3b8] mb-2">
                    Lounge maintains operative morale and memory consolidation. Archive Basement houses the immutable Dexie.js audit ledger.
                  </p>
                  <div className="text-[11px] text-[#cbd5e1] bg-[#0c0e17] p-2 border border-[#1e2438]">
                    <strong>Primary Stations:</strong> Lounge Station, Archive Filing Array<br />
                    <strong>Capabilities:</strong> 50-command rolling history, backup exports, storage audits
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 2: TACTICAL RECON MONITOR & SATELLITE OVERWATCH */}
          {/* ========================================================= */}
          {activeSection === 'recon' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Radar className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 02 // TACTICAL RECON MONITOR & GEOGRAPHIC INTEL</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Orbital overwatch terminal pairing NASA GIBS daily orbital passes (MODIS/VIIRS) and high-resolution Esri World Imagery with an interactive HTML5 Canvas tactical overlay.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-[#121520] border border-[#38bdf8] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-[#38bdf8] uppercase">
                      🛰️ Responsive Fullscreen Popup Modal
                    </h4>
                    <span className="text-[10px] bg-[#38bdf8]/10 text-[#38bdf8] px-2 py-0.5 border border-[#38bdf8]/40 font-bold">
                      POPUP ENGINE
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    The Recon Monitor opens as a dedicated tactical modal instead of overlaying inside the room diorama, ensuring full mobile responsiveness, clean viewport height, zero clipping, and safe-area margin handling.
                  </p>
                </div>

                <div className="p-4 bg-[#121520] border border-[#4ade80] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-[#4ade80] uppercase">
                      🎯 HTML5 Canvas Tactical Overlay & Geographically Locked Pins
                    </h4>
                    <span className="text-[10px] bg-[#4ade80]/10 text-[#4ade80] px-2 py-0.5 border border-[#4ade80]/40 font-bold">
                      60 FPS CANVAS
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Intelligence pins (S2 Wire dispatches, USGS seismic sensors, ENTSO-E grid telemetry) are mapped via Web Mercator projection to exact geographic coordinates. When you pan (<code className="text-[#4ade80]">N/S/E/W</code>) or zoom (<code className="text-[#4ade80]">Z</code>), pins stay locked to their real-world locations. Off-screen pins display edge indicators on the viewport border with click-to-center support.
                  </p>
                </div>

                <div className="p-4 bg-[#121520] border border-[#fde047] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-[#fde047] uppercase">
                      📍 Zero-Key Postal Code & Global City Geocoding
                    </h4>
                    <span className="text-[10px] bg-[#fde047]/10 text-[#fde047] px-2 py-0.5 border border-[#fde047]/40 font-bold">
                      GLOBAL GEOCODER
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Enter postal codes (e.g. <code className="text-[#fde047]">SW1A 1AA</code>, <code className="text-[#fde047]">90210</code>, <code className="text-[#fde047]">M5V 3L9</code>), city names, or coordinates. The Recon Monitor geocodes the location, centers the camera, automatically switches to high-res optical imagery at street zoom levels, and plants a persistent <code className="text-[#38bdf8]">RECON TARGET</code> pin.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 3: MANAGING OPERATIVES & CLEARANCE */}
          {/* ========================================================= */}
          {activeSection === 'operatives' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Users className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 03 // MANAGING OPERATIVES, RECRUITS & S2 WIRE INTEL</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Safehouse agents operate as autonomous persistent intelligence units with independent memory banks, custom prompt overrides, responsive tray navigation, and structured SITREP reporting.
                </p>
              </div>

              {/* The Core Triumvirate */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-[#fde047] uppercase tracking-wider">
                  The Core Triumvirate:
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-[#16130f] border border-[#5e4326]">
                    <div className="font-bold text-[#e59838] text-sm mb-1">VANCE</div>
                    <div className="text-[10px] text-[#9c8265] uppercase mb-2">Lead Strategist & Commander</div>
                    <p className="text-xs text-[#cbd5e1]">
                      Specializes in high-level directive decomposition, live web research, tactical planning, and synthesizing multi-agent findings.
                    </p>
                  </div>
                  <div className="p-3 bg-[#0f1712] border border-[#2b4c3b]">
                    <div className="font-bold text-[#4ade80] text-sm mb-1">CIPHER</div>
                    <div className="text-[10px] text-[#2b4c3b] uppercase mb-2">Cryptographic & Code Specialist</div>
                    <p className="text-xs text-[#cbd5e1]">
                      Executes JavaScript sandbox evaluations, security audits, technical markdown report compilation, and GitHub operations.
                    </p>
                  </div>
                  <div className="p-3 bg-[#0e1620] border border-[#1e3a5f]">
                    <div className="font-bold text-[#38bdf8] text-sm mb-1">NYX</div>
                    <div className="text-[10px] text-[#1e3a5f] uppercase mb-2">Cyber Signal & Infiltration</div>
                    <p className="text-xs text-[#cbd5e1]">
                      Handles communications relay, Gmail dispatches, Slack notifications, stealth API lookups, and morning briefing broadcasts.
                    </p>
                  </div>
                </div>
              </div>

              {/* S2 Underground Wire & Structured SITREP Reports */}
              <div className="p-3.5 bg-[#12141f] border border-[#e59838]/60 space-y-2.5">
                <h4 className="text-xs font-bold text-[#e59838] uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-[#e59838]" />
                  S2 Underground Wire Dispatches & Structured Report Naming
                </h4>
                <p className="text-xs text-[#cbd5e1]">
                  Agents parse clean military SITREP dispatches (<code className="text-[#e59838]">//The Wire//</code>, <code className="text-[#e59838]">//BLUF://</code>, <code className="text-[#e59838]">//END REPORT//</code>) directly from the text stream instead of processing web link fragments.
                </p>
                <ul className="list-disc list-inside text-xs text-[#94a3b8] space-y-1">
                  <li><strong>Human-Readable Titles:</strong> Reports are intelligently titled after the analyzed intelligence itself rather than prompt fragments or random gibberish IDs.</li>
                  <li><strong>Persistent Dialogue:</strong> Switching between Briefing Terminal and Town Hall Roundtable tabs preserves existing agent responses and meeting minutes without retyping.</li>
                  <li><strong>Mobile-Responsive Bottom Tray:</strong> Operative status tags and dispatch navigation buttons feature touch-slide scrolling so third and recruited agents are never cut off on small screens.</li>
                </ul>
              </div>

              {/* Agent Memory Ledgers */}
              <div className="p-3.5 bg-[#12141f] border border-[#2b354f] space-y-2.5">
                <h4 className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-[#38bdf8]" />
                  Independent Agent Memory Banks
                </h4>
                <p className="text-xs text-[#cbd5e1]">
                  Every operative maintains an append-only memory ledger. When Vance, Cipher, or Nyx complete directives, the result summary is committed to their local memory store:
                </p>
                <ul className="list-disc list-inside text-xs text-[#94a3b8] space-y-1">
                  <li><strong>Prompt Context Injection:</strong> The agent&apos;s 5 most recent memory items are automatically embedded into future prompts.</li>
                  <li><strong>Session Persistence:</strong> Memory ledgers survive page reloads and browser restarts in LocalStorage.</li>
                  <li><strong>Memory Inspection:</strong> Open the <strong>Crew</strong> tab and click an operative&apos;s name to view, edit, or purge their memory log.</li>
                </ul>
              </div>

              {/* Clearance & Progression System */}
              <div className="p-3.5 bg-[#17140f] border border-[#5e4326] space-y-2.5">
                <h4 className="text-xs font-bold text-[#e59838] uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[#e59838]" />
                  Clearance Progression & Decryption Boost
                </h4>
                <p className="text-xs text-[#cbd5e1]">
                  Operatives begin at <strong>Tier 1 (Recruit)</strong> and advance as they execute missions:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2 bg-[#0e0f17] border border-[#2b354f]">
                    <strong className="text-[#fde047]">Tier 1 · Operative</strong>
                    <p className="text-[11px] text-[#94a3b8] mt-0.5">Basic tool access, local file storage, and standard token limits.</p>
                  </div>
                  <div className="p-2 bg-[#0e0f17] border border-[#2b354f]">
                    <strong className="text-[#4ade80]">Tier 2 · Specialist</strong>
                    <p className="text-[11px] text-[#94a3b8] mt-0.5">Unlocks Composio external tools (Gmail, GitHub) and code sandbox eval.</p>
                  </div>
                  <div className="p-2 bg-[#0e0f17] border border-[#2b354f]">
                    <strong className="text-[#38bdf8]">Tier 3 · Commander</strong>
                    <p className="text-[11px] text-[#94a3b8] mt-0.5">Autonomous task chain orchestration and cross-sector delegation.</p>
                  </div>
                </div>
                <p className="text-[11px] text-[#9c8265]">
                  💡 <em>Tip: Successfully solving the manual bypass puzzle on the canvas gives a temporary +35% to +100% Decryption Boost for high-speed inferences!</em>
                </p>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 4: WORKSPACE FILES, VFS & MULTI-SELECT */}
          {/* ========================================================= */}
          {activeSection === 'vfs' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 04 // WORKSPACE FILES (VFS), MULTI-SELECT & FOLDERS</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Local-first Virtual File System (Dexie IndexedDB + OPFS) storing all classified agent dossiers, logs, configurations, and intelligence archives.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-[#121520] border border-[#a855f7] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-[#a855f7] uppercase">
                      📁 Batch Multi-Select, Organize & Move
                    </h4>
                    <span className="text-[10px] bg-[#a855f7]/10 text-[#a855f7] px-2 py-0.5 border border-[#a855f7]/40 font-bold">
                      VFS BATCH OPS
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Click <code className="text-[#a855f7]">[☑️ MULTI-SELECT]</code> in the Workspace File Explorer to select multiple files at once. You can move selected files to any target folder (<code className="text-[#a855f7]">intel/</code>, <code className="text-[#a855f7]">reports/</code>, <code className="text-[#a855f7]">archive/</code>, <code className="text-[#a855f7]">logs/</code>) or batch delete them with persistent deletion tombstones.
                  </p>
                </div>

                <div className="p-4 bg-[#121520] border border-[#4ade80] space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs sm:text-sm font-bold text-[#4ade80] uppercase">
                      📂 Independent Folder Architecture & Persistent Tombstones
                    </h4>
                    <span className="text-[10px] bg-[#4ade80]/10 text-[#4ade80] px-2 py-0.5 border border-[#4ade80]/40 font-bold">
                      PERSISTENT SYNC
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Deleting all files inside a folder leaves the directory intact. Folder deletion is a separate, intentional action. Deleted files are recorded with persistent deletion tombstones so they never resurrect or re-sync back during cloud sync or page reloads.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 5: WORKFLOWS & INTELLIGENCE PLAYBOOKS */}
          {/* ========================================================= */}
          {activeSection === 'workflows' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 05 // WORKFLOWS, TASK CHAINS & INTELLIGENCE PLAYBOOKS</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Execute complex, autonomous multi-phase tasks across safehouse agents. Workflows can be triggered via natural language directives, playbook buttons, or scheduled cron routines.
                </p>
              </div>

              {/* Workflow Orchestration Pillars */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-[#121524] border border-[#38bdf8] space-y-2.5">
                  <span className="font-bold text-xs uppercase text-[#38bdf8] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#38bdf8]" />
                    Pillar 1: Multi-Agent Task Chaining (Briefing Terminal)
                  </span>
                  <p className="text-xs text-[#cbd5e1]">
                    Direct multiple agents in a single prompt. The engine parses sequential steps, auto-navigates operatives to their specialized sectors, passes intermediate research forward, and writes results to the Virtual File System (VFS).
                  </p>
                  <div className="p-2.5 bg-[#0b0e17] border border-[#1e2438] space-y-1.5 text-[11px] font-mono-tabular">
                    <div className="text-[#38bdf8] font-bold">Natural Language Chaining:</div>
                    <code className="text-[#4ade80] block text-[10px] break-all">
                      &quot;1. Vance research zero-trust best practices. 2. Cipher write a hardened report to reports/zero_trust.md. 3. Nyx notify team on Slack.&quot;
                    </code>
                    <div className="text-[#e59838] font-bold mt-2">Explicit Workflow Prefix:</div>
                    <code className="text-[#fde047] block text-[10px] break-all">
                      &quot;workflow: Vance audit token bucket algorithm, then have Cipher write patch, and then have Nyx broadcast completion on Slack #alerts&quot;
                    </code>
                  </div>
                </div>

                <div className="p-4 bg-[#141512] border border-[#4ade80] space-y-2.5">
                  <span className="font-bold text-xs uppercase text-[#4ade80] flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-[#4ade80]" />
                    Pillar 2: 1-Click Action Playbooks (Room-Scoped)
                  </span>
                  <p className="text-xs text-[#cbd5e1]">
                    Pre-packaged operational playbooks accessible directly from Safehouse room control decks (War Room, Comms Tower, Server Vault, Basement).
                  </p>
                  <ul className="text-xs text-[#94a3b8] space-y-1.5 list-disc list-inside">
                    <li><strong className="text-[#f3ead8]">📡 Wire-Tap Watch:</strong> Scrapes target websites, feeds, and prices (Nyx in Comms Tower).</li>
                    <li><strong className="text-[#f3ead8]">🔍 Deep Recon Dossier:</strong> Compiles comprehensive entity/threat dossier to Markdown (Nyx).</li>
                    <li><strong className="text-[#f3ead8]">🌅 Morning Intel Briefing:</strong> Aggregates unread news, repos, and updates (Vance in War Room).</li>
                    <li><strong className="text-[#f3ead8]">⚡ Triage Gmail to Tasks:</strong> Scans inbox via Composio and populates task queue (Vance).</li>
                    <li><strong className="text-[#f3ead8]">🐛 GitHub Repo Pulse:</strong> Inspects open PRs, issues, and commits (Cipher in Library).</li>
                  </ul>
                </div>
              </div>

              {/* Execution Lifecyle & Persistence */}
              <div className="p-4 bg-[#12141e] border border-[#2b354f] space-y-3">
                <h4 className="text-xs font-bold text-[#fde047] uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-[#fde047]" />
                  How Workflows Run & Persist
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-[#94a3b8]">
                  <div className="p-2.5 bg-[#0f111a] border border-[#23293d] space-y-1">
                    <strong className="text-[#38bdf8]">1. Step Execution:</strong>
                    <p className="text-[11px]">
                      Operatives walk across sectors to reach their required rigs (War Room for strategic prompts, Server Vault for code eval, Comms Tower for Composio relays).
                    </p>
                  </div>
                  <div className="p-2.5 bg-[#0f111a] border border-[#23293d] space-y-1">
                    <strong className="text-[#4ade80]">2. Artifact Generation:</strong>
                    <p className="text-[11px]">
                      Output documents and dossiers are automatically saved into <code className="text-[#4ade80]">reports/</code> or <code className="text-[#4ade80]">intel/</code> in IndexedDB, complete with download buttons.
                    </p>
                  </div>
                  <div className="p-2.5 bg-[#0f111a] border border-[#23293d] space-y-1">
                    <strong className="text-[#e59838]">3. State Integrity:</strong>
                    <p className="text-[11px]">
                      Briefing responses and meeting call transcriptions remain cached and persistent when switching between tabs or rooms until explicitly replaced.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 6: CONFIGURING NIGHT SHIFT */}
          {/* ========================================================= */}
          {activeSection === 'nightshift' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Moon className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 06 // CONFIGURING NIGHT SHIFT (BACKGROUND CRON)</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Night Shift allows operatives to execute automated maintenance, security scans, research sweeps, and inbox summaries while the command center is idle or running in the background.
                </p>
              </div>

              {/* Step-by-Step Guide */}
              <div className="p-4 bg-[#12141e] border border-[#2b354f] space-y-3">
                <h4 className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#38bdf8]" />
                  Step-by-Step Routine & Task Chain Setup
                </h4>

                <ol className="list-decimal list-inside space-y-2 text-xs text-[#cbd5e1]">
                  <li>
                    <strong>Open Night Shift:</strong> Click the <code className="text-[#e59838] bg-[#1a1c26] px-1">[NIGHT SHIFT]</code> button in the top-right header or press the moon icon.
                  </li>
                  <li>
                    <strong>Create New Routine:</strong> Click <code className="text-[#4ade80] bg-[#1a1c26] px-1">+ Create Routine / Task Chain</code> and give your routine a descriptive title (e.g. <em>&ldquo;Daily Zero-Trust Vulnerability Scan&rdquo;</em>).
                  </li>
                  <li>
                    <strong>Select Mode & Operatives:</strong>
                    <ul className="list-disc list-inside ml-4 mt-1 text-[#94a3b8] space-y-1">
                      <li><strong>Single Operative Routine:</strong> Pick any operative (Vance, Nyx, Cipher, Vector, or custom recruits) to execute a targeted scheduled directive.</li>
                      <li><strong>Multi-Agent Task Chain:</strong> Chain multiple operatives sequentially! Operative A searches the web/scans intel &rarr; Operative B synthesizes and writes a Markdown report &rarr; Operative C broadcasts findings to Slack or Gmail.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Set Interval Schedule:</strong> Select recurrence frequency (Every 5 Minutes, Every 15 Minutes, Every 1 Hour, Every 6 Hours, Daily Midnight, or Weekly).
                  </li>
                  <li>
                    <strong>Configure Multi-Channel Notifications:</strong>
                    <ul className="list-disc list-inside ml-4 mt-1 text-[#94a3b8] space-y-1">
                      <li><strong className="text-slate-200">Browser Desktop Push:</strong> Native OS popup notification on routine completion.</li>
                      <li><strong className="text-slate-200">Mobile Phone / Haptics:</strong> Pulses vibration and triggers PWA push notifications on mobile devices.</li>
                      <li><strong className="text-slate-200">Gmail Email Briefings:</strong> Sends full operational email summaries via authenticated Composio connection.</li>
                      <li><strong className="text-slate-200">Slack & Discord Dispatches:</strong> Dispatches real-time cards to designated team channels or webhooks.</li>
                    </ul>
                  </li>
                  <li>
                    <strong>Edit Anytime:</strong> Click the <strong>Edit</strong> button on any existing routine card to adjust prompts, swap operatives, reorder chained steps, or modify alert channels without losing execution counts.
                  </li>
                  <li>
                    <strong>Activate & Monitor:</strong> Toggle status to <strong>ACTIVE</strong>. The background scheduler checks every 30 seconds to autonomously fire due tasks!
                  </li>
                </ol>
              </div>

              {/* Morning Briefing Logs */}
              <div className="p-3.5 bg-[#17140f] border border-[#5e4326] space-y-2">
                <h4 className="text-xs font-bold text-[#e59838] uppercase tracking-wider">
                  Reading Morning Briefing Logs & Notifications
                </h4>
                <p className="text-xs text-[#cbd5e1]">
                  When a routine completes while you are away:
                </p>
                <ul className="list-disc list-inside text-xs text-[#94a3b8] space-y-1">
                  <li>The <code className="text-[#e59838] bg-[#1a1c26] px-1">[NIGHT SHIFT:X]</code> badge in the header displays unread routine notifications and completion briefings.</li>
                  <li>Click <code className="text-[#e59838] bg-[#1a1c26] px-1">[NIGHT SHIFT]</code> and navigate to <strong>Routine Briefings</strong> to see a step-by-step breakdown of each agent&apos;s contributions, token telemetry, and links to generated workspace files.</li>
                  <li>Configure platform-specific payload formats (Slack, Telegram, Discord, or Custom JSON) in the <strong>Channels &amp; Webhooks</strong> tab of Night Shift.</li>
                </ul>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 7: API KEYS (BYOK) VS PRO PASS */}
          {/* ========================================================= */}
          {activeSection === 'auth' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 07 // API KEYS (BYOK: GEMINI 3.8 FLASH) VS. HOSTED PRO PASS</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  PixelOps is built with a 100% transparent execution model. You can run completely offline for free, connect your own API keys, or use the hosted Pro Pass.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* BYOK */}
                <div className="p-4 bg-[#12151f] border-2 border-[#38bdf8] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base text-[#38bdf8] flex items-center gap-1.5">
                      <KeyRound className="w-5 h-5" /> BYOK (Custom Keys)
                    </span>
                    <span className="text-[10px] bg-[#38bdf8]/10 text-[#38bdf8] px-2 py-0.5 border border-[#38bdf8]/40 font-bold">
                      100% FREE & PRIVATE
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Bring Your Own Key directly from Google, OpenAI, Anthropic, or run a local Ollama model.
                  </p>
                  <div className="space-y-2 text-xs text-[#94a3b8]">
                    <div className="p-2 bg-[#0c0e17] border border-[#1e2438]">
                      <strong className="text-[#f3ead8]">Active Recommended Engine:</strong>
                      <div className="mt-1 p-2 bg-[#172554] border border-[#3b82f6] text-[#93c5fd]">
                        <span className="font-bold text-[#60a5fa]">gemini-3.8-flash</span>
                        <p className="text-[11px] text-[#bfdbfe] mt-0.5">
                          Ultra-low latency, blazing fast time-to-first-token, full function calling tool integration, and high accuracy for code, markdown reports, and web search synthesis.
                        </p>
                      </div>
                      <ul className="list-disc list-inside mt-2 space-y-0.5 text-[11px]">
                        <li><strong>Google Gemini:</strong> <span className="text-[#4ade80] font-semibold">gemini-3.8-flash</span> (Active Default), gemini-3.5-flash-lite</li>
                        <li><strong>OpenAI:</strong> gpt-4o, gpt-4o-mini</li>
                        <li><strong>Anthropic:</strong> claude-3-5-sonnet-20241022</li>
                        <li><strong>Local Ollama:</strong> llama3, mistral (localhost:11434, air-gapped)</li>
                      </ul>
                    </div>
                    <div className="p-2 bg-[#0c0e17] border border-[#1e2438]">
                      <strong className="text-[#f3ead8]">Privacy Guarantee:</strong>
                      <p className="text-[11px] mt-0.5">
                        Your API key is encrypted client-side in browser storage using the Master Vault. Inferences travel directly from your browser to Google/OpenAI with zero middleman servers.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                    }}
                    className="w-full py-1.5 bg-[#1e293b] hover:bg-[#334155] text-[#38bdf8] text-xs font-bold border border-[#38bdf8]/50 cursor-pointer transition-colors"
                  >
                    Configure Custom Key in Settings (⚙️)
                  </button>
                </div>

                {/* Pro Pass */}
                <div className="p-4 bg-[#1a140d] border-2 border-[#e59838] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base text-[#e59838] flex items-center gap-1.5">
                      <Sparkles className="w-5 h-5 text-[#fde047]" /> PixelOps Pro Pass
                    </span>
                    <span className="text-[10px] bg-[#e59838]/10 text-[#fde047] px-2 py-0.5 border border-[#e59838]/40 font-bold">
                      TURNKEY FLEET
                    </span>
                  </div>
                  <p className="text-xs text-[#cbd5e1]">
                    Ideal for users who don&apos;t want to manage API keys, cloud billings, or model rate limits.
                  </p>
                  <div className="space-y-2 text-xs text-[#94a3b8]">
                    <div className="p-2 bg-[#120e09] border border-[#3b2b1a]">
                      <strong className="text-[#fde047]">What&apos;s Included:</strong>
                      <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
                        <li><strong>Hosted Token Allowance:</strong> 500,000 monthly high-speed inference tokens powered by Gemini 3.1 Flash Lite.</li>
                        <li><strong>Multi-Model Redundancy:</strong> Automatic failover if Google or OpenAI experiences an outage.</li>
                        <li><strong>Unlimited Composio Connectors:</strong> Direct Gmail, GitHub, Slack, Notion relays.</li>
                        <li><strong>Exclusive Soundscapes:</strong> Unlocks all safehouse retro synth audio profiles.</li>
                      </ul>
                    </div>
                    <div className="p-2 bg-[#120e09] border border-[#3b2b1a]">
                      <strong className="text-[#fde047]">Zero-Configuration:</strong>
                      <p className="text-[11px] mt-0.5">
                        Start instantly without opening cloud accounts or copying raw API tokens.
                      </p>
                    </div>
                  </div>
                  <div className="p-2 text-center text-xs text-[#fde047] font-semibold border border-dashed border-[#e59838]/60 bg-[#e59838]/10">
                    Pro Pass Fleet status: Hosted Inference Ready (Gemini 3.1 Flash Lite)
                  </div>
                </div>
              </div>

              {/* Free Offline Heuristic Mode */}
              <div className="p-3.5 bg-[#0f1412] border border-[#2b4c3b] space-y-1.5">
                <h4 className="text-xs font-bold text-[#4ade80] uppercase tracking-wider flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[#4ade80]" />
                  100% Free Offline Mode (Zero Keys Needed)
                </h4>
                <p className="text-xs text-[#cbd5e1]">
                  If no API key is provided, PixelOps seamlessly engages its <strong>Local Heuristic Engine</strong>. You can compute math, execute code in the sandbox, generate full formatted Markdown reports, save files to IndexedDB, and test safehouse workflows completely free with zero internet access!
                </p>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 8: COMMAND ENCYCLOPEDIA */}
          {/* ========================================================= */}
          {activeSection === 'commands' && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-[#e59838]" />
                    <span>SECTION 08 // COMMAND ENCYCLOPEDIA & EXAMPLES</span>
                  </h3>
                  <p className="text-xs text-[#9c8265] mt-0.5">
                    Exhaustive catalog of every briefing terminal directive, task chain, code eval, and CLI command. Click &ldquo;Try Directive ▶&rdquo; to load directly into the prompt box.
                  </p>
                </div>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-[#9c8265] absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search directives (e.g. report, email, git)..."
                    className="w-full bg-[#141724] border border-[#363d54] focus:border-[#e59838] pl-8 pr-3 py-1.5 text-xs text-[#f3ead8] placeholder-[#64748b] outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-2.5 text-[#94a3b8] hover:text-[#f3ead8]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Channel / Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-b border-[#2b354f] pb-3 text-xs">
                {(
                  [
                    { id: 'all', label: `All Commands (${COMMAND_CATALOG.length})` },
                    { id: 'terminal', label: 'Briefing Terminal' },
                    { id: 'composio', label: 'Composio External' },
                    { id: 'chaining', label: 'Task Chaining' },
                    { id: 'reports', label: 'Reports & VFS' },
                    { id: 'code', label: 'Code & Eval' },
                    { id: 'cli', label: 'CLI Console' },
                    { id: 'diagnostics', label: 'Diagnostic Drills' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(cat.id);
                      playBeep('tap');
                    }}
                    className={`px-2 py-0.5 border text-[11px] transition-colors cursor-pointer ${
                      categoryFilter === cat.id
                        ? 'bg-[#e59838] text-[#121110] border-[#fde047] font-bold'
                        : 'bg-[#141824] text-[#94a3b8] border-[#2b354f] hover:text-[#f3ead8]'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Commands List */}
              <div className="space-y-3">
                {filteredCommands.length === 0 ? (
                  <div className="p-8 text-center bg-[#131520] border border-[#2b354f] text-[#94a3b8] text-xs">
                    No commands matching &ldquo;{searchQuery}&rdquo;. Try searching for <em>report</em>, <em>chain</em>, <em>email</em>, or <em>cli</em>.
                  </div>
                ) : (
                  filteredCommands.map((cmd, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#131622] border border-[#2b354f] hover:border-[#e59838] transition-colors space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-[#f3ead8]">
                            {cmd.title}
                          </span>
                          <span className="text-[10px] bg-[#1e2438] text-[#38bdf8] px-1.5 py-0.5 border border-[#38bdf8]/30 font-semibold">
                            {cmd.category}
                          </span>
                          <span className="text-[10px] bg-[#1b150e] text-[#e59838] px-1 py-0.5 border border-[#e59838]/30">
                            {cmd.channel === 'both' ? 'Terminal + CLI' : cmd.channel.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[10px] text-[#94a3b8] flex items-center gap-3">
                          <span>Operative: <strong className="text-[#e59838]">{cmd.leadOperative}</strong></span>
                          <span>Sector: <strong className="text-[#4ade80]">{cmd.targetSector}</strong></span>
                        </div>
                      </div>

                      <p className="text-xs text-[#94a3b8]">
                        {cmd.description}
                      </p>

                      <div className="flex items-center justify-between gap-2 bg-[#0a0c14] border border-[#1c2236] p-2">
                        <code className="text-xs text-[#4ade80] break-all select-all font-mono-tabular">
                          {cmd.prompt}
                        </code>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopy(cmd.prompt, idx)}
                            className="px-2 py-1 bg-[#1e2438] hover:bg-[#2a334d] text-[#cbd5e1] hover:text-[#f3ead8] text-[10px] border border-[#363d54] cursor-pointer flex items-center gap-1 transition-colors"
                            title="Copy command to clipboard"
                          >
                            {copiedIndex === idx ? (
                              <>
                                <Check className="w-3 h-3 text-[#4ade80]" />
                                <span className="text-[#4ade80]">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {onSelectPrompt && cmd.channel !== 'cli' && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectPrompt(cmd.prompt);
                                playBeep('complete');
                                onClose();
                              }}
                              className="px-2.5 py-1 bg-[#e59838] hover:bg-[#d48828] text-[#121110] text-[10px] font-bold border border-[#e59838] cursor-pointer flex items-center gap-1 transition-colors"
                              title="Paste directly into terminal and close manual"
                            >
                              <span>Try Directive ▶</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 9: COMPOSIO FULL INTEGRATIONS GUIDE */}
          {/* ========================================================= */}
          {activeSection === 'composio' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 09 // COMPOSIO INTEGRATIONS GUIDE (BRIEFING TERMINAL & CLI)</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  Connect third-party developer and operational toolkits (Gmail, GitHub, Slack, Notion, Linear, Calendar) via OAuth and execute actions live from both the Briefing Terminal and CLI.
                </p>
              </div>

              {/* Supported Apps Matrix */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3 bg-[#131624] border border-[#2b354f] space-y-1.5">
                  <span className="font-bold text-[#38bdf8] flex items-center gap-1.5 text-xs">
                    <Mail className="w-4 h-4" /> Google Workspace / Gmail
                  </span>
                  <p className="text-xs text-[#94a3b8]">
                    Send emails, fetch unread emails, search threads, and parse message bodies.
                  </p>
                  <div className="bg-[#0c0e17] p-2 text-[11px] text-[#cbd5e1] space-y-1">
                    <div><strong>Terminal:</strong> <code>Nyx, send an email to user@test.com subject &quot;Update&quot; body &quot;Alert&quot;</code></div>
                    <div><strong>CLI Action:</strong> <code>pixelops composio run GMAIL_SEND_EMAIL &apos;{JSON.stringify({ to: "user@test.com", subject: "Hi", body: "Hello" })}&apos;</code></div>
                  </div>
                </div>

                <div className="p-3 bg-[#131624] border border-[#2b354f] space-y-1.5">
                  <span className="font-bold text-[#4ade80] flex items-center gap-1.5 text-xs">
                    <Code2 className="w-4 h-4" /> GitHub Repositories
                  </span>
                  <p className="text-xs text-[#94a3b8]">
                    Star repositories, create issues, inspect pull requests, and list commits.
                  </p>
                  <div className="bg-[#0c0e17] p-2 text-[11px] text-[#cbd5e1] space-y-1">
                    <div><strong>Terminal:</strong> <code>Cipher, create an issue in owner/repo titled &quot;Bug&quot; saying &quot;Fix&quot;</code></div>
                    <div><strong>CLI Action:</strong> <code>pixelops composio run GITHUB_STAR_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER &apos;{JSON.stringify({ owner: "my-org", repo: "my-project" })}&apos;</code></div>
                  </div>
                </div>

                <div className="p-3 bg-[#131624] border border-[#2b354f] space-y-1.5">
                  <span className="font-bold text-[#e59838] flex items-center gap-1.5 text-xs">
                    <Send className="w-4 h-4" /> Slack Channels & DMs
                  </span>
                  <p className="text-xs text-[#94a3b8]">
                    Post announcements, broadcast alerts, and notify channels from task chains.
                  </p>
                  <div className="bg-[#0c0e17] p-2 text-[11px] text-[#cbd5e1] space-y-1">
                    <div><strong>Terminal:</strong> <code>Nyx, send a slack message to #general saying &quot;Online&quot;</code></div>
                    <div><strong>CLI Action:</strong> <code>pixelops composio run SLACK_CHAT_POST_MESSAGE &apos;{JSON.stringify({ channel: "C123", text: "Alert" })}&apos;</code></div>
                  </div>
                </div>

                <div className="p-3 bg-[#131624] border border-[#2b354f] space-y-1.5">
                  <span className="font-bold text-[#a855f7] flex items-center gap-1.5 text-xs">
                    <Calendar className="w-4 h-4" /> Google Calendar & Notion
                  </span>
                  <p className="text-xs text-[#94a3b8]">
                    Schedule meetings, create documentation pages, and file Linear project issues.
                  </p>
                  <div className="bg-[#0c0e17] p-2 text-[11px] text-[#cbd5e1] space-y-1">
                    <div><strong>Terminal:</strong> <code>schedule calendar event titled &quot;Review&quot; at &quot;15:00 UTC&quot;</code></div>
                    <div><strong>Terminal:</strong> <code>create notion page titled &quot;Zero-Trust Guide&quot; in workspace</code></div>
                  </div>
                </div>
              </div>

              {/* Complete CLI Composio Subcommands Table */}
              <div className="p-4 bg-[#0d0f17] border border-[#23293d] space-y-3">
                <h4 className="text-xs font-bold text-[#fde047] uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-[#fde047]" />
                  Complete Composio CLI Command Matrix
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#2b354f] text-[#94a3b8]">
                        <th className="py-2 pr-4 font-bold text-[#38bdf8]">CLI Command Syntax</th>
                        <th className="py-2 pr-4 font-bold text-[#e59838]">Description & Operation</th>
                        <th className="py-2 font-bold text-[#4ade80]">Example</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e2438] text-[#cbd5e1]">
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio status</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Check entity authentication, ping API, list connected accounts</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio status</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio list</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Display catalog of available apps and connection states</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio list</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio connect &lt;app&gt;</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Open centered OAuth popup bridge to connect third-party app</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio connect github</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio key &lt;apiKey&gt;</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Save and persist custom Composio API key locally</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio key comp_live_xxx</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio run &lt;act&gt; &lt;json&gt;</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Execute direct tool action live on user connected account</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio run GMAIL_FETCH_EMAILS &apos;{`{"max_results":5}`}&apos;</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4 font-mono-tabular text-[#38bdf8]">pixelops composio agent &lt;prompt&gt;</td>
                        <td className="py-2 pr-4 text-[#94a3b8]">Execute dynamic Gemini agent with all active Composio tools</td>
                        <td className="py-2 font-mono-tabular text-[#4ade80]">pixelops composio agent &quot;List PRs&quot;</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* SECTION 10: PRO-TIPS & MAXIMUM PERFORMANCE */}
          {/* ========================================================= */}
          {activeSection === 'protips' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-[#e59838] flex items-center gap-2">
                  <Zap className="w-5 h-5 text-[#e59838]" />
                  <span>SECTION 10 // PRO-TIPS & MAXIMUM PERFORMANCE SECRETS</span>
                </h3>
                <p className="text-xs text-[#9c8265] mt-1">
                  How to extract maximum efficiency, battery optimization, and tactical fluency from the PixelOps Command Center.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-3.5 bg-[#121520] border border-[#2b354f] space-y-1.5">
                  <h4 className="text-xs font-bold text-[#38bdf8] uppercase">
                    1. Use Google Gemini 3.8 Flash for Sub-Second Responses
                  </h4>
                  <p className="text-xs text-[#cbd5e1]">
                    When using BYOK or subscription plans, <code className="text-[#4ade80]">gemini-3.8-flash</code> is the active flagship engine. It offers leading tool-calling capabilities and deep accuracy for code, markdown reports, and web search synthesis.
                  </p>
                </div>

                <div className="p-3.5 bg-[#121520] border border-[#2b354f] space-y-1.5">
                  <h4 className="text-xs font-bold text-[#4ade80] uppercase">
                    2. Install as a Progressive Web App (PWA)
                  </h4>
                  <p className="text-xs text-[#cbd5e1]">
                    Click <code className="text-[#e59838]">[INSTALL APP]</code> in the header to install PixelOps as a native desktop or mobile application. The service worker precaches all pixel art assets and UI bundles, allowing full offline boot even during internet outages!
                  </p>
                </div>

                <div className="p-3.5 bg-[#121520] border border-[#2b354f] space-y-1.5">
                  <h4 className="text-xs font-bold text-[#e59838] uppercase">
                    3. Keyboard Shortcuts for Rapid Ops
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#94a3b8] mt-1">
                    <div><kbd className="bg-[#1f2438] text-[#fde047] px-1 border border-[#363d54]">~</kbd> or <kbd className="bg-[#1f2438] text-[#fde047] px-1 border border-[#363d54]">`</kbd> : Toggle CLI Console</div>
                    <div><kbd className="bg-[#1f2438] text-[#fde047] px-1 border border-[#363d54]">ESC</kbd> : Close open modal / manual</div>
                    <div><kbd className="bg-[#1f2438] text-[#fde047] px-1 border border-[#363d54]">ENTER</kbd> : Dispatch terminal prompt</div>
                    <div><kbd className="bg-[#1f2438] text-[#fde047] px-1 border border-[#363d54]">UP / DOWN</kbd> : Cycle CLI command history</div>
                  </div>
                </div>

                <div className="p-3.5 bg-[#121520] border border-[#2b354f] space-y-1.5">
                  <h4 className="text-xs font-bold text-[#fde047] uppercase">
                    4. Sector Ambient Synth Audio Loops
                  </h4>
                  <p className="text-xs text-[#cbd5e1]">
                    Click <code className="text-[#4ade80]">[🔊 SYNTH: ...]</code> in the center header to engage generative Web Audio ambient synth loops tailored to each sector (War Room hum, Server Vault server fans, Comms Tower radio static).
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="bg-[#14120e] border-t border-[#4a351e] px-4 py-2.5 flex items-center justify-between text-xs shrink-0">
          <span className="text-[11px] text-[#9c8265]">
            CLASSIFICATION: <strong>OMEGA-RESTRICTED</strong> · ENGINE: <strong>GEMINI-3.8-FLASH</strong> · PROPERTY OF PIXELOPS COMMAND
          </span>
          <button
            type="button"
            onClick={() => {
              playBeep('tap');
              onClose();
            }}
            className="px-4 py-1 bg-[#e59838] hover:bg-[#d48828] text-[#121110] font-bold border border-[#e59838] cursor-pointer transition-colors"
          >
            [CLOSE FIELD MANUAL]
          </button>
        </div>
      </div>
    </div>
  );
};
