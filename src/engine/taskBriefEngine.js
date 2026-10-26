/**
 * Ambiguity Detection & Structured Task Brief Generator for PixelOps
 * Matches StarNet's pattern for unblocking autonomous agents.
 *
 * When a prompt is overly vague, ambiguous, or lacks critical parameters
 * (e.g., target file, scope, output format, or tool mode), this engine
 * calculates an ambiguity score and constructs a structured clarification brief.
 */

// Common vague task triggers
const VAGUE_TASK_PATTERNS = [
  /^(fix\s+it|fix\s+this|fix\s+the\s+bug|it\s+doesn'?t\s+work|broken)$/i,
  /^(help|hello|test|run|start|execute|check|analyze|optimize)$/i,
  /^(make\s+it\s+better|improve\s+this|update\s+code|refactor)$/i,
  /^(do\s+the\s+thing|clean\s+up|search|find\s+data)$/i,
];

// Ambiguity categories with specific clarifying parameter prompts
const AMBIGUITY_CATEGORY_PRESETS = [
  {
    category: 'CODE_ACTION',
    matcher: /\b(refactor|optimize|clean\s*up|debug|fix|patch|format)\b/i,
    missingChecks: [
      {
        param: 'targetScope',
        test: (p) => !/\b(\.js|\.ts|\.tsx|\.css|\.html|file|component|module|function|class|test)\b/i.test(p),
        issue: 'Target file or component scope unspecified',
        question: 'Which sector of the codebase should the operative target for this code action?',
        options: [
          'Active workspace project files (src/components & src/services)',
          'Local test suite & test scripts only',
          'Autonomous agent rendering & sprite animation engine',
        ],
      },
    ],
  },
  {
    category: 'RESEARCH_ACTION',
    matcher: /\b(research|investigate|search|find|lookup|scan|analyze)\b/i,
    missingChecks: [
      {
        param: 'researchDepth',
        test: (p) => !/\b(live|wikipedia|docs|latest|overview|detailed|summary)\b/i.test(p),
        issue: 'Research depth & data source unspecified',
        question: 'What depth of intelligence retrieval is required?',
        options: [
          'High-level summary (Top 3 validated sources via Live Web Search)',
          'Deep architectural & technical deep-dive with actionable breakdown',
          'Local vault dossier query & historical telemetry inspection',
        ],
      },
    ],
  },
  {
    category: 'WRITING_ACTION',
    matcher: /\b(write|draft|document|readme|spec|summary|report)\b/i,
    missingChecks: [
      {
        param: 'formatStyle',
        test: (p) => !/\b(markdown|bullets?|formal|executive|changelog|spec)\b/i.test(p),
        issue: 'Output format & audience tone unspecified',
        question: 'What output format should the operative deliver?',
        options: [
          'Executive briefing markdown bulleted summary with action items',
          'Comprehensive technical documentation & API spec',
          'Tactical debrief dispatch formatted for terminal logs',
        ],
      },
    ],
  },
  {
    category: 'FILE_SYSTEM_ACTION',
    matcher: /\b(file|read|write|save|export|load|delete|create)\b/i,
    missingChecks: [
      {
        param: 'targetPath',
        test: (p) => !/\b(\/|\\|\.txt|\.json|\.md|\.js|\.ts|path|dir)\b/i.test(p),
        issue: 'Exact file path or output directory unspecified',
        question: 'Specify target file location within the safehouse workspace:',
        options: [
          'Save to ./scratch/ directory as a temporary output artifact',
          'Update directly in ./src/ application source directory',
          'Write to root README or project telemetry notes',
        ],
      },
    ],
  },
];

/**
 * Analyzes an incoming user prompt for ambiguity and missing parameters.
 *
 * @param {string} prompt - Raw user instruction
 * @param {object} context - Agent & workspace context (agentRole, currentRoom, etc.)
 * @returns {object} { requiresClarification: boolean, ambiguityScore: number, brief: object | null }
 */
export function analyzePromptAmbiguity(prompt, context = {}) {
  const trimmed = (prompt || '').trim();
  if (!trimmed) {
    return {
      requiresClarification: true,
      ambiguityScore: 1.0,
      brief: {
        headline: 'DIRECTIVE BUFFER EMPTY',
        understanding: 'No instructions or parameters were provided to the operative.',
        missingParameter: 'Operational directive',
        question: 'What objective should the active operative execute?',
        options: [
          'Audit and inspect current codebase architecture',
          'Research latest technical requirements and summarize findings',
          'Run a diagnostic health check across the safehouse systems',
        ],
      },
    };
  }

  // 1. Extreme brevity or vague keywords (< 18 characters or matches vague pattern)
  const isTooShort = trimmed.length < 18 && trimmed.split(/\s+/).length <= 3;
  const matchesVague = VAGUE_TASK_PATTERNS.some((rgx) => rgx.test(trimmed));

  if (isTooShort || matchesVague) {
    return {
      requiresClarification: true,
      ambiguityScore: 0.85,
      brief: {
        headline: 'INSUFFICIENT OPERATIONAL SCOPE',
        understanding: `Operative received vague directive "${trimmed}", but lacks specific target parameters, files, or execution boundaries.`,
        missingParameter: 'Scope & Target Definition',
        question: `How should the operative interpret "${trimmed}"?`,
        options: [
          `Execute a general codebase diagnosis & lint check for "${trimmed}"`,
          `Query technical documentation and draft an actionable plan for "${trimmed}"`,
          `Inspect recent error telemetry and command logs to trace faults`,
        ],
      },
    };
  }

  // 2. Domain-specific missing parameter heuristics
  for (const preset of AMBIGUITY_CATEGORY_PRESETS) {
    if (preset.matcher.test(trimmed)) {
      for (const check of preset.missingChecks) {
        if (check.test(trimmed)) {
          return {
            requiresClarification: true,
            ambiguityScore: 0.65,
            brief: {
              headline: `PARAMETER NEEDED: ${check.issue.toUpperCase()}`,
              understanding: `Operative understands the general ${preset.category.replace('_', ' ')} directive, but requires confirmation on ${check.issue.toLowerCase()} to avoid incorrect execution.`,
              missingParameter: check.param,
              question: check.question,
              options: check.options,
            },
          };
        }
      }
    }
  }

  // Prompt is sufficiently well-specified
  return {
    requiresClarification: false,
    ambiguityScore: 0.1,
    brief: null,
  };
}
