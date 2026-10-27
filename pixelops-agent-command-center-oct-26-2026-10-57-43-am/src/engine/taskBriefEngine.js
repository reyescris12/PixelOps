/**
 * Ambiguity Detection & Structured Task Brief Generator for PixelOps
 * Matches StarNet's pattern for unblocking autonomous agents.
 *
 * When a prompt is overly vague, ambiguous, or lacks critical parameters
 * (e.g., "fix it", "broken", or empty input), this engine calculates an
 * ambiguity score and constructs a structured clarification brief.
 * Normal questions, direct commands, coding requests, and conversational
 * queries pass straight to the agent without interruption.
 */

// Common ultra-vague stubs that truly lack any instruction
const VAGUE_TASK_PATTERNS = [
  /^(fix\s+it|fix\s+this|broken|it\s+doesn'?t\s+work)$/i,
  /^(do\s+the\s+thing)$/i,
];

// Ambiguity categories with clarifying questions only when prompt is a single bare keyword without context
const AMBIGUITY_CATEGORY_PRESETS = [
  {
    category: 'CODE_ACTION',
    matcher: /^(refactor|optimize|clean\s*up|debug|patch)$/i,
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

  // 1. Check for ultra-vague stubs
  const matchesVague = VAGUE_TASK_PATTERNS.some((rgx) => rgx.test(trimmed));
  if (matchesVague) {
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

  // 2. Domain-specific bare-keyword missing parameter heuristics
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
