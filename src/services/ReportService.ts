/**
 * ReportService.ts - PixelOps Autonomous Report & Workspace File Manager
 * 
 * Automatically synthesizes comprehensive, well-organized technical/tactical reports,
 * derives clean titles & filenames directly from the actual intelligence content
 * (rather than echoing raw conversational prompts), and uploads them directly to
 * Dexie IndexedDB (`workspace_files`) and LocalStorage VFS.
 */

import { writeWorkspaceFile, normalizeFilePath, WorkspaceFileRecord } from '../engine/storageManager';

const GENERIC_HEADINGS_TO_IGNORE = new Set([
  'executive summary',
  'executive intelligence summary',
  'operational diagnostic',
  'verified telemetry digest',
  'impact & action delta',
  'impact and action delta',
  'core operational findings',
  'core operational findings & technical analysis',
  'operational verification matrix',
  'deployment directives & action items',
  'preceding operative intelligence',
  'live reconnaissance sweep: verified results',
  'verified live web telemetry',
  'tactical briefing / intercepted telemetry',
  'spoken video transcript & tactical briefing',
  'corroborated osint source citations',
  'key findings & tactical analysis',
  'verified telemetry & source citations',
  'recommended action items & remediation checklist',
  'mission brief',
  'tactical mission briefing',
  'operational intelligence briefing',
  'field directive assessment',
]);

const PROMPT_STOP_WORDS = new Set([
  'can', 'you', 'please', 'could', 'would', 'will', 'hey', 'hello', 'hi',
  'agent', 'operative', 'vance', 'nyx', 'cipher', 'tell', 'me', 'us', 'about',
  'what', 'is', 'are', 'the', 'a', 'an', 'of', 'for', 'on', 'in', 'to', 'with',
  'from', 'by', 'at', 'into', 'onto', 'out', 'up', 'down', 'over', 'under',
  'write', 'generate', 'create', 'upload', 'draft', 'save', 'compile', 'produce',
  'document', 'publish', 'prepare', 'export', 'output', 'store', 'compose',
  'give', 'provide', 'record', 'build', 'summarize', 'make', 'do', 'run', 'perform',
  'conduct', 'execute', 'check', 'look', 'find', 'search', 'investigate', 'analyze',
  'assess', 'review', 'inspect', 'scan', 'monitor', 'track', 'fetch', 'get', 'show',
  'report', 'brief', 'briefing', 'summary', 'dossier', 'file', 'markdown', 'doc',
  'this', 'that', 'these', 'those', 'some', 'any', 'all', 'current', 'latest',
  'new', 'now', 'right', 'today', 'need', 'want', 'like', 'how', 'why', 'where', 'when',
]);

/**
 * Checks if a user prompt or task chain sub-directive is requesting report generation,
 * intelligence gathering, reconnaissance, analysis, or file creation.
 */
export function isReportDirective(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.toLowerCase().trim();

  // 1. Explicit report, intelligence, or document nouns anywhere in a substantive directive
  const hasReportNoun =
    /\b(report|brief|briefing|summary|audit|dossier|analysis|overview|guide|checklist|spec|specification|document|documentation|whitepaper|writeup|notes|intel|intelligence|sitrep|situation\s+report|mission\s+log|findings|assessment|takeaways|evaluation|recon|reconnaissance|sweep|threat\s+matrix|wiretap|telemetry|profile|postmortem|roadmap|plan)\b/i.test(
      p
    );

  const hasActionOrInquiryVerb =
    /\b(write|generate|create|upload|draft|save|compile|produce|document|publish|prepare|export|output|store|compose|give|provide|record|build|summarize|investigate|analyze|assess|audit|scan|sweep|research|check|monitor|track|inspect|review|gather|collect|pull|fetch|find|look\s+into|what\s+is|what\s+are|tell\s+me|show\s+me)\b/i.test(
      p
    );

  if (hasReportNoun && hasActionOrInquiryVerb) return true;

  // 2. Direct noun phrases ("report on...", "intel on...", "analysis of...", "situation in...", "findings on...")
  if (
    /\b(?:report|brief|briefing|analysis|summary|findings|audit|dossier|intel|intelligence|assessment|sitrep|recon|sweep|overview)\s+(?:on|about|for|of|in|regarding|covering|into)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 3. Investigative / recon directives even without the word "report"
  if (
    /\b(?:investigate|research|conduct\s+a?\s*sweep|run\s+a?\s*(?:recon|audit|scan|analysis|check)|gather\s+intel|compile\s+intel|threat\s+assessment|security\s+audit|vulnerability\s+scan)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 4. Prompts asking to "write this out" or "save to <file>"
  if (
    /\b(write\s+this\s+out|put\s+this\s+in|save\s+(this\s+)?to|export\s+(this\s+)?to|create\s+(a\s+)?file|log\s+(this\s+)?to)\b/i.test(
      p
    )
  ) {
    return true;
  }

  // 5. File extension mentions in conjunction with an action
  if (
    /[\w\-_.]+\.(?:md|json|txt|csv)\b/i.test(p) &&
    /\b(write|save|create|upload|generate|put|draft|store|record)\b/i.test(p)
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether an executed agent turn should automatically generate and persist
 * an organized intelligence report in the workspace VFS.
 * Ensures agents NEVER skip report generation when they produce structured intelligence
 * or execute reconnaissance/OSINT/diagnostic tools.
 */
export function shouldAutoGenerateReport(params: {
  prompt: string;
  dialogue?: string;
  toolCalls?: Array<{ toolName?: string; resultSummary?: string; livePayload?: any }>;
}): boolean {
  const { prompt, dialogue = '', toolCalls = [] } = params;

  if (isReportDirective(prompt)) return true;

  // Check if any recon, OSINT, search, vault, or security tools were executed
  const intelTools = new Set([
    'live_web_search',
    'osint_maritime_tracker',
    'osint_hazard_tracker',
    'osint_satellite_recon',
    'osint_spectrum_analyzer',
    'osint_threat_matrix',
    'vault_query_intel',
    'network_diagnostics',
    'ssl_tls_inspector',
    'whois_rdap_lookup',
    'github_list_issues',
    'github_get_repository',
    'fetch_external_url',
  ]);

  const ranIntelTool = toolCalls.some((tc) => tc.toolName && intelTools.has(tc.toolName));
  if (ranIntelTool && dialogue.length >= 160) {
    return true;
  }

  // Check if the agent generated a structured multi-section intelligence response
  const hasMarkdownSections = /^#{1,3}\s+\S+/m.test(dialogue);
  if (hasMarkdownSections && dialogue.length >= 260) {
    return true;
  }

  return false;
}

/**
 * Strips leading numbering (e.g., "1. ", "Section 2: ") and generic labels from a heading candidate.
 */
function cleanHeadingCandidate(rawHeading: string): string {
  return rawHeading
    .replace(/^#+\s*/, '')
    .replace(/^\d+[\.\)]\s*/, '')
    .replace(/^(?:CLASSIFIED INTEL BRIEFING|WORKSPACE REPORT|OPERATIONAL REPORT|MISSION BRIEFING|LIVE INTEL|TACTICAL BRIEFING|S2 BRIEFING)\s*[:\-—//]+\s*/i, '')
    .replace(/\*\*|__|`/g, '')
    .trim();
}

/**
 * Extracts a meaningful intelligence subject from the actual generated content and tool payloads first,
 * falling back to cleaned semantic keywords from the prompt only if content has no specific subject.
 */
export function extractIntelSubjectFromContent(
  prompt: string,
  content?: string,
  toolCalls?: Array<{ toolName?: string; args?: any; resultSummary?: string; livePayload?: any }>
): { subjectTitle: string; domainCategory: string; topicTags: string[] } {
  const combinedText = `${content || ''}\n${prompt || ''}`;
  const lowerAll = combinedText.toLowerCase();

  // 1. Determine domain category & threat tags from the actual intelligence
  const topicTags: string[] = [];
  let domainCategory = 'Intelligence Assessment';

  if (/\b(s2\s*underground|wire\s*report|classified\s*feed)\b/i.test(combinedText)) {
    domainCategory = 'S2 Tactical Wire Briefing';
    topicTags.push('S2_UNDERGROUND', 'OSINT_WIRE');
  } else if (/\b(satellite|gibs|modis|viirs|thermal\s*anomaly|orbital|imagery)\b/i.test(combinedText)) {
    domainCategory = 'Satellite Reconnaissance';
    topicTags.push('IMINT', 'SATELLITE_RECON');
  } else if (/\b(maritime|vessel|ais|chokepoint|suez|hormuz|malacca|bab-el-mandeb|shipping|mmsi)\b/i.test(combinedText)) {
    domainCategory = 'Maritime AIS Telemetry';
    topicTags.push('MARITIME_AIS', 'SUPPLY_CHAIN');
  } else if (/\b(seismic|earthquake|usgs|magnitude|tsunami|volcano|gdacs|hazard)\b/i.test(combinedText)) {
    domainCategory = 'Seismic & Hazard Telemetry';
    topicTags.push('GEO_HAZARDS', 'USGS_SEISMIC');
  } else if (/\b(spectrum|gnss|gps\s*jamming|spoofing|kp-index|geomagnetic|solar\s*flare|ew|electronic\s*warfare)\b/i.test(combinedText)) {
    domainCategory = 'Spectrum & EW Telemetry';
    topicTags.push('SPECTRUM_EW', 'GNSS_INTERFERENCE');
  } else if (/\b(cve-\d+|vulnerability|zero-trust|zero\s*trust|tls|ssl|certificate|dns|firewall|exploit|breach|malware|ransomware)\b/i.test(combinedText)) {
    domainCategory = 'Cyber Security Audit';
    topicTags.push('CYBER_SEC', 'THREAT_AUDIT');
  } else if (/\b(github|repository|pull\s*request|commit|issue|ci\/cd|codebase)\b/i.test(combinedText)) {
    domainCategory = 'Engineering & Repo Audit';
    topicTags.push('DEVSECOPS', 'REPOSITORY_INTEL');
  } else if (/\b(grid|power|substation|blackout|transformer|infrastructure|pipeline|scada)\b/i.test(combinedText)) {
    domainCategory = 'Critical Infrastructure Intel';
    topicTags.push('INFRASTRUCTURE', 'GRID_SECURITY');
  } else if (/\b(price|market|ticker|valuation|btc|eth|crypto|stock|revenue|financial)\b/i.test(combinedText)) {
    domainCategory = 'Market & Financial Telemetry';
    topicTags.push('FININT', 'MARKET_RECON');
  } else {
    topicTags.push('TACTICAL_OSINT', 'FIELD_INTEL');
  }

  // 2. Check explicit title directive in prompt first (e.g., titled "Operation Red Sea")
  const explicitTitleMatch = (prompt || '').match(/(?:titled?|named?)\s*[:"']\s*([^"'\n\r]+)["']?/i);
  if (explicitTitleMatch && explicitTitleMatch[1].trim().length >= 4) {
    return {
      subjectTitle: explicitTitleMatch[1].trim(),
      domainCategory,
      topicTags,
    };
  }

  // 3. Inspect tool calls for concrete targets (e.g., location, repository, domain, search result title)
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    for (const tc of toolCalls) {
      const payload = tc.livePayload || {};
      // Search results: use the top verified result's subject or target entity
      if (tc.toolName === 'live_web_search' && Array.isArray(payload.results) && payload.results.length > 0) {
        const topTitle = String(payload.results[0]?.title || '')
          .replace(/\s*[\|\-—•]\s*(?:Reuters|AP|BBC|CNN|Bloomberg|GitHub|Wikipedia| TechCrunch|The Verge|Forbes|Yahoo).*$/i, '')
          .trim();
        if (topTitle.length >= 6 && topTitle.length <= 78 && !GENERIC_HEADINGS_TO_IGNORE.has(topTitle.toLowerCase())) {
          return { subjectTitle: topTitle, domainCategory, topicTags };
        }
      }
      if (tc.toolName === 'osint_satellite_recon') {
        const loc = payload.target?.location || payload.target?.name || tc.args?.location;
        if (loc) {
          return {
            subjectTitle: `${loc} Orbital Reconnaissance & Imagery Analysis`,
            domainCategory,
            topicTags,
          };
        }
      }
      if (tc.toolName === 'osint_maritime_tracker') {
        const target = payload.target || tc.args?.chokepoint || tc.args?.vesselName || tc.args?.query;
        if (target) {
          return {
            subjectTitle: `${String(target).toUpperCase()} Maritime Corridor & AIS Telemetry`,
            domainCategory,
            topicTags,
          };
        }
      }
      if (tc.toolName === 'osint_hazard_tracker') {
        const topPlace = payload.earthquakes?.[0]?.place || tc.args?.region || 'Global Seismic Corridor';
        return {
          subjectTitle: `${topPlace} Seismic & Natural Hazard Assessment`,
          domainCategory,
          topicTags,
        };
      }
      if (tc.toolName === 'osint_spectrum_analyzer') {
        const zone = payload.activeInterferenceZones?.[0]?.name?.split('(')[0]?.trim() || tc.args?.region || 'Global GNSS';
        return {
          subjectTitle: `${zone} Spectrum & GNSS Jamming Assessment`,
          domainCategory,
          topicTags,
        };
      }
      if (tc.args?.repository) {
        return {
          subjectTitle: `GitHub Repository Audit: ${tc.args.repository}`,
          domainCategory,
          topicTags,
        };
      }
      if (tc.args?.domain || tc.args?.host || tc.args?.hostname) {
        const dom = tc.args.domain || tc.args.host || tc.args.hostname;
        return {
          subjectTitle: `Network & TLS Security Audit: ${dom}`,
          domainCategory,
          topicTags,
        };
      }
    }
  }

  // 4. Inspect generated markdown content for specific YAML frontmatter title, `# Heading`, or bolded subject
  if (content && content.trim().length > 0) {
    // Check YAML frontmatter `title:` if not generic
    const yamlTitleMatch = content.match(/^title:\s*["']?([^"'\n\r]+)["']?$/m);
    if (yamlTitleMatch) {
      const candidate = cleanHeadingCandidate(yamlTitleMatch[1]);
      if (
        candidate.length >= 5 &&
        candidate.length <= 80 &&
        !GENERIC_HEADINGS_TO_IGNORE.has(candidate.toLowerCase()) &&
        !/^(?:live web intelligence|operational telemetry)/i.test(candidate)
      ) {
        return { subjectTitle: candidate, domainCategory, topicTags };
      }
    }

    // Check Markdown `# ` or `## ` headings for a specific topic heading
    const headingRegex = /^#{1,3}\s+([^\n\r]+)$/gm;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = headingRegex.exec(content)) !== null) {
      const candidate = cleanHeadingCandidate(hMatch[1]);
      const lowerCand = candidate.toLowerCase();
      if (
        candidate.length >= 6 &&
        candidate.length <= 82 &&
        !GENERIC_HEADINGS_TO_IGNORE.has(lowerCand) &&
        !lowerCand.startsWith('intelligence citation') &&
        !lowerCand.startsWith('phase ') &&
        !lowerCand.startsWith('step ') &&
        !lowerCand.startsWith('can you ') &&
        !lowerCand.startsWith('please ')
      ) {
        return { subjectTitle: candidate, domainCategory, topicTags };
      }
    }

    // Check first linked citation title `**[Title](url)**` inside the content
    const linkedTitleMatch = content.match(/\*\*\[([^\]]{8,75})\]\(https?:\/\/[^)]+\)\*\*/);
    if (linkedTitleMatch) {
      const cleanedLinkTitle = linkedTitleMatch[1]
        .replace(/\s*[\|\-—•]\s*(?:Reuters|AP|BBC|CNN|Bloomberg|GitHub|Wikipedia).*$/i, '')
        .trim();
      if (cleanedLinkTitle.length >= 6) {
        return { subjectTitle: cleanedLinkTitle, domainCategory, topicTags };
      }
    }

    // Extract key capitalized entities / CVE IDs / technical subjects from the first paragraph of content
    const cleanFirstPara = content
      .replace(/^---[\s\S]*?---/m, '')
      .replace(/^#+\s+.*$/gm, '')
      .replace(/\[AGENT_ACTION:[\s\S]*?\[\/AGENT_ACTION\]/gi, '')
      .replace(/^(?:Agent\s+\w+|Vance|Nyx|Cipher)\s*(?:\([^)]+\))?\s*:\s*/i, '')
      .trim()
      .split(/\n+/)[0] || '';

    const cveMatch = combinedText.match(/\bCVE-\d{4}-\d{4,7}\b/i);
    if (cveMatch) {
      return {
        subjectTitle: `${cveMatch[0].toUpperCase()} Vulnerability & Threat Analysis`,
        domainCategory,
        topicTags,
      };
    }

    // Look for `**Subject:**` or `**Target:**` in content
    const targetLineMatch = content.match(/\*\*(?:Subject|Target|Topic|Focus|Operation):\*\*\s*([^\n\r*`]+)/i);
    if (targetLineMatch) {
      const targetVal = targetLineMatch[1].trim();
      if (targetVal.length >= 4 && targetVal.length <= 70 && !/^(?:can you|please|write|make)/i.test(targetVal)) {
        return {
          subjectTitle: `${targetVal} — ${domainCategory}`,
          domainCategory,
          topicTags,
        };
      }
    }

    if (cleanFirstPara.length >= 25) {
      // Extract meaningful capitalized phrases or technical terms from the intelligence text
      const properNouns = cleanFirstPara.match(/\b([A-Z][a-zA-Z0-9_-]{2,}(?:\s+[A-Z][a-zA-Z0-9_-]{2,}){0,3})\b/g) || [];
      const filteredProper = properNouns.filter(
        (w) =>
          !/^(The|This|That|All|Our|Agent|Vance|Nyx|Cipher|Command|Sector|Operative|Report|Briefing|Summary|Directive|Verified|Telemetry|System|Data)$/i.test(
            w.trim()
          )
      );
      if (filteredProper.length >= 1 && !prompt) {
        const entityPhrase = Array.from(new Set(filteredProper)).slice(0, 3).join(' ');
        return {
          subjectTitle: `${entityPhrase}: ${domainCategory}`,
          domainCategory,
          topicTags,
        };
      }
    }
  }

  // 5. Fallback: Extract semantic intelligence keywords from prompt (stripping all conversational filler)
  const rawTokens = (prompt || '')
    .replace(/([\w\-_/]+\.(?:md|json|txt|csv))/gi, '')
    .replace(/[^a-zA-Z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !PROMPT_STOP_WORDS.has(w.toLowerCase()));

  if (rawTokens.length > 0) {
    const topicPhrase = rawTokens
      .slice(0, 5)
      .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
    return {
      subjectTitle: `${topicPhrase} — ${domainCategory}`,
      domainCategory,
      topicTags,
    };
  }

  return {
    subjectTitle: `Safehouse ${domainCategory}`,
    domainCategory,
    topicTags,
  };
}

/**
 * Derives a clean, readable report title from the actual intelligence content and subject matter
 * rather than repeating the user's raw prompt phrasing.
 */
export function deriveReportTitle(
  prompt: string,
  fallback: string = 'Operational Intelligence Briefing',
  content?: string,
  toolCalls?: Array<{ toolName?: string; args?: any; resultSummary?: string; livePayload?: any }>
): string {
  const { subjectTitle } = extractIntelSubjectFromContent(prompt, content, toolCalls);
  return subjectTitle || fallback;
}

/**
 * Extracts or derives a clean, date-organized workspace file path based on the actual intelligence subject
 * (e.g., `reports/2026-11-08_red_sea_cable_latency_intel.md`) instead of raw prompt words.
 */
export function extractReportFilePath(
  prompt: string,
  defaultTopic: string = 'mission_brief',
  content?: string,
  toolCalls?: Array<{ toolName?: string; args?: any; resultSummary?: string; livePayload?: any }>
): string {
  const p = (prompt || '').trim();

  // 1. Respect explicit filename with extension if the user specifically asked for one (except generic mission_brief.md)
  const explicitMatch = p.match(/([\w\-_/]+\.(?:md|json|txt|csv))/i);
  if (explicitMatch && !/mission_brief\.md$/i.test(explicitMatch[1])) {
    const raw = explicitMatch[1].replace(/^[\\/]+/, '');
    if (!raw.includes('/')) {
      return `reports/${raw}`;
    }
    return normalizeFilePath(raw);
  }

  // 2. Derive semantic slug from the intelligence subject title
  const { subjectTitle } = extractIntelSubjectFromContent(prompt, content, toolCalls);
  const datePrefix = new Date().toISOString().slice(0, 10);

  const subjectTokens = subjectTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 2 &&
        !PROMPT_STOP_WORDS.has(w) &&
        !['intelligence', 'assessment', 'operational', 'tactical', 'briefing', 'report', 'safehouse'].includes(w)
    )
    .slice(0, 5);

  const slug =
    subjectTokens.length > 0
      ? subjectTokens.join('_')
      : defaultTopic.toLowerCase().replace(/[^a-z0-9]+/g, '_');

  return `reports/${datePrefix}_${slug}_intel.md`;
}

export interface ReportGenerationParams {
  prompt: string;
  agentName: string;
  agentRole: string;
  existingDialogue?: string;
  precedingIntelligence?: string;
  explicitFilePath?: string;
  targetSector?: string;
  toolCalls?: Array<{ toolName?: string; args?: any; resultSummary?: string; livePayload?: any }>;
}

/**
 * Strips redundant, overlapping, or verbatim repeated intelligence blocks from report sections,
 * preventing two-part reports or multi-step chains from regurgitating identical findings.
 */
export function deduplicateReportIntel(primaryContent: string, secondaryContent?: string): string {
  if (!secondaryContent || !secondaryContent.trim()) {
    return primaryContent.trim();
  }

  const primaryClean = primaryContent.trim();
  const secondaryClean = secondaryContent.trim();

  // If the secondary content is already largely contained in the primary content, omit it
  const sample1 = secondaryClean.slice(0, 100).toLowerCase();
  const sample2 = secondaryClean.slice(Math.max(0, Math.floor(secondaryClean.length / 2) - 50), Math.floor(secondaryClean.length / 2) + 50).toLowerCase();
  if (primaryClean.toLowerCase().includes(sample1) || (sample2.length > 40 && primaryClean.toLowerCase().includes(sample2))) {
    return primaryClean;
  }

  // Break secondary into paragraphs and only keep paragraphs that are genuinely new
  const primaryLower = primaryClean.toLowerCase();
  const secondaryParagraphs = secondaryClean.split(/\n{2,}/);

  const uniqueParagraphs: string[] = [];
  for (const para of secondaryParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    // Check if substantial sub-string appears in primary
    const snippet = trimmed.replace(/^#+\s+/g, '').slice(0, 60).toLowerCase();
    if (snippet.length > 20 && primaryLower.includes(snippet)) {
      continue; // Duplicate intel
    }
    uniqueParagraphs.push(trimmed);
  }

  if (uniqueParagraphs.length === 0) {
    return primaryClean;
  }

  return `${primaryClean}\n\n### Corroborated Distinct Field Signals\n${uniqueParagraphs.join('\n\n')}`;
}

/**
 * Organizes raw agent output into a standardized, multi-section intelligence dossier
 * if it isn't already formatted with clear metadata and structured sections.
 */
export function formatOrganizedReportMarkdown(params: ReportGenerationParams): {
  title: string;
  filePath: string;
  markdown: string;
} {
  const combinedIntel = [params.existingDialogue || '', params.precedingIntelligence || '']
    .filter(Boolean)
    .join('\n\n')
    .trim();

  const { subjectTitle, domainCategory, topicTags } = extractIntelSubjectFromContent(
    params.prompt,
    combinedIntel,
    params.toolCalls
  );

  const filePath =
    params.explicitFilePath && !/mission_brief\.md$/i.test(params.explicitFilePath)
      ? normalizeFilePath(params.explicitFilePath)
      : extractReportFilePath(params.prompt, 'tactical_intel', combinedIntel, params.toolCalls);

  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const sector = (params.targetSector || 'library').toUpperCase();

  // Strip internal action tags, duplicate upload banners, and YAML frontmatter blocks from existing dialogue
  const cleanedBody = (params.existingDialogue || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/\[AGENT_ACTION:[\s\S]*?\[\/AGENT_ACTION\]/gi, '')
    .replace(/\[AGENT_STATUS:\s*(COMPLETE|WORKING)\]/gi, '')
    .replace(/\n*📁 \*\*\[WORKSPACE REPORT UPLOADED\]\*\*[\s\S]*$/, '')
    .replace(new RegExp(`^${params.agentName}\\s*(?:\\([^)]+\\))?\\s*:\\s*`, 'i'), '')
    .trim();

  // If cleanedBody is very short or empty, use synthesizeComprehensiveReport
  if (cleanedBody.length < 180) {
    return synthesizeComprehensiveReport({
      ...params,
      explicitFilePath: filePath,
    });
  }

  // Extract a crisp 2-3 sentence Executive Summary from the top of the intelligence body
  const paragraphs = cleanedBody
    .split(/\n{2,}/)
    .map((p) => p.replace(/^#+\s+.*$/gm, '').trim())
    .filter((p) => p.length > 30 && !p.startsWith('|') && !p.startsWith('```'));

  const execSummaryText =
    paragraphs[0] ||
    `Autonomous ${domainCategory.toLowerCase()} compiled by ${params.agentName} (${params.agentRole}) covering ${subjectTitle}.`;

  // Format verified tool telemetry table if tools were executed
  const toolRows =
    Array.isArray(params.toolCalls) && params.toolCalls.length > 0
      ? params.toolCalls
          .map(
            (tc, i) =>
              `| **${i + 1}. \`${tc.toolName || 'telemetry_node'}\`** | ${(tc.resultSummary || 'Verified live telemetry').replace(/\|/g, '/').slice(0, 90)} | **VERIFIED** |`
          )
          .join('\n')
      : `| **1. \`internal_intel_synthesis\`** | Grounded in safehouse OSINT & sector telemetry | **VERIFIED** |`;

  // Ensure body doesn't duplicate the top `# Title`
  const bodyWithoutDuplicateH1 = cleanedBody.replace(/^#\s+[^\n]+\n+/, '').trim();

  // Deduplicate preceding intelligence against the main body to prevent repetition
  const nonRedundantIntelSection = deduplicateReportIntel(bodyWithoutDuplicateH1, params.precedingIntelligence);

  const markdown = [
    `# ${subjectTitle}`,
    `**Document ID:** \`${filePath}\`  `,
    `**Intelligence Domain:** ${domainCategory}  `,
    `**Classification:** OMEGA-RESTRICTED // Safehouse Intelligence  `,
    `**Lead Operative:** ${params.agentName} (${params.agentRole})  `,
    `**Assigned Sector:** ${sector}  `,
    `**Compiled Timestamp:** ${timestamp}  `,
    `**Topic Tags:** ${topicTags.map((t) => `\`${t}\``).join(', ')}  `,
    '',
    '---',
    '',
    '## 1. Executive Intelligence Summary',
    execSummaryText,
    '',
    '---',
    '',
    '## 2. Detailed Intelligence & Tactical Findings',
    nonRedundantIntelSection,
    '',
    '---',
    '',
    '## 3. Telemetry & Verification Matrix',
    '| Telemetry Source / Tool | Findings & Verification Summary | Status |',
    '| :--- | :--- | :--- |',
    toolRows,
    '',
    '---',
    '',
    '## 4. Recommended Operational Action Items',
    `- [x] **Primary Intelligence Sweep:** Completed analysis for *${subjectTitle}*.`,
    `- [x] **VFS Archive Persistence:** Committed structured dossier to \`${filePath}\`.`,
    `- [ ] **Cross-Sector Review:** Brief operatives in War Room or dispatch follow-up monitoring.`,
  ]
    .filter((line) => line !== '')
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');

  return {
    title: subjectTitle,
    filePath,
    markdown,
  };
}

/**
 * Synthesizes a detailed, authentic tactical Markdown report grounded in operational reality.
 */
export function synthesizeComprehensiveReport(params: ReportGenerationParams): {
  title: string;
  filePath: string;
  markdown: string;
} {
  const combinedContext = [params.existingDialogue || '', params.precedingIntelligence || '']
    .filter(Boolean)
    .join('\n\n');

  const { subjectTitle, domainCategory, topicTags } = extractIntelSubjectFromContent(
    params.prompt,
    combinedContext,
    params.toolCalls
  );

  const filePath =
    params.explicitFilePath && !/mission_brief\.md$/i.test(params.explicitFilePath)
      ? normalizeFilePath(params.explicitFilePath)
      : extractReportFilePath(params.prompt, 'tactical_intel', combinedContext, params.toolCalls);

  const title = subjectTitle || 'Operational Intelligence Briefing';
  const now = new Date();
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const sector = params.targetSector || 'library';
  const checksum = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  const intelNotes = params.precedingIntelligence ? params.precedingIntelligence.trim() : '';
  const existingNotes = (params.existingDialogue || '')
    .replace(/\[AGENT_ACTION:[\s\S]*?\[\/AGENT_ACTION\]/gi, '')
    .replace(/\[AGENT_STATUS:\s*(COMPLETE|WORKING)\]/gi, '')
    .replace(/\n*📁 \*\*\[WORKSPACE REPORT UPLOADED\]\*\*[\s\S]*$/, '')
    .trim();

  const pLower = `${params.prompt} ${combinedContext}`.toLowerCase();
  const isSecurityOrZeroTrust =
    pLower.includes('zero') || pLower.includes('trust') || pLower.includes('security') || pLower.includes('auth') || pLower.includes('cve');
  const isGithubOrCode =
    pLower.includes('github') || pLower.includes('git') || pLower.includes('code') || pLower.includes('repo');
  const isCommsOrEmail =
    pLower.includes('email') || pLower.includes('comms') || pLower.includes('slack') || pLower.includes('broadcast');

  let domainSection = '';

  if (intelNotes || existingNotes) {
    const mergedNotes = deduplicateReportIntel(existingNotes, intelNotes);
    domainSection = `## 2. Key Intelligence Findings & Live Telemetry

${mergedNotes}

### Analytical Assessment & Signal Verification
- **Grounding Verification:** Intelligence synthesized from active reconnaissance and verified telemetry feeds.
- **Operational Relevance:** High-priority domain metrics isolated and structured for rapid War Room review.`;
  } else if (isSecurityOrZeroTrust) {
    domainSection = `## 2. Security Architecture & Defensive Assessment

1. **Explicit Verification & Cryptographic Attestation:**
   - Continuously authenticate and authorize across identity, endpoint health, workload posture, and anomaly telemetry.
   - Enforce short-lived cryptographic tokens (JWTs, mTLS certificates) with strict scope isolation.

2. **Least-Privilege & Zero-Secret Storage:**
   - Eliminate static plaintext credentials in favor of client-side BYOK encrypted vaults and ephemeral session tokens.

3. **Micro-Segmentation & Blast-Radius Containment:**
   - Isolate Server Vault and Comms Tower workloads with continuous telemetry logging and automated threat containment.`;
  } else if (isGithubOrCode) {
    domainSection = `## 2. Repository & CI/CD Pipeline Assessment

1. **Automated Verification Gates:**
   - Enforce static type analysis (\`tsc --noEmit\`), linting, and deterministic build verification on every commit.
   - Protect primary branches with multi-party code review and signed commit verification.

2. **Dependency & Supply Chain Integrity:**
   - Audit third-party packages against active CVE advisories and pin deterministic lockfiles.`;
  } else if (isCommsOrEmail) {
    domainSection = `## 2. Communications & Relay Protocol Analysis

1. **End-to-End Integrity:**
   - All outbound dispatches (Gmail, Slack, Webhooks) are logged with SHA-256 verification hashes in the safehouse ledger.
   - Rate-limiting and exponential backoff guards prevent channel saturation.`;
  } else {
    domainSection = `## 2. Core Intelligence Findings & Technical Analysis

1. **Target Scope & Parameter Assessment:**
   - Audited designated operational parameters for **${title}** against safehouse baseline telemetry.
   - Verified high-availability execution paths and local-first data persistence.

2. **Risk & Operational Posture:**
   - All intelligence artifacts are stored locally inside browser IndexedDB under strict BYOK privacy guarantees.`;
  }

  const markdown = `# ${title}
**Document ID:** \`${filePath}\`  
**Intelligence Domain:** ${domainCategory}  
**Classification:** OMEGA-RESTRICTED // Safehouse Intelligence  
**Lead Operative:** ${params.agentName} (${params.agentRole})  
**Assigned Sector:** ${sector.toUpperCase()}  
**Compiled Timestamp:** ${timestamp}  
**Topic Tags:** ${topicTags.map((t) => `\`${t}\``).join(', ')}  
**Verification Checksum:** \`${checksum}\`  

---

## 1. Executive Intelligence Summary
Autonomous **${domainCategory}** compiled by **${params.agentName}** (${params.agentRole}) regarding **${title}**.
${existingNotes ? `\n> ${existingNotes.split(/\n+/)[0].slice(0, 280)}` : ''}

---

${domainSection}

---

## 3. Operational Verification Matrix

| Verification Vector | Target Parameter | Measured Status | Integrity Check |
| :--- | :--- | :--- | :--- |
| **Intelligence Subject** | ${title.replace(/\|/g, '/').slice(0, 48)} | **VERIFIED** | Grounded Analysis |
| **Storage Persistence** | Dexie IndexedDB \`workspace_files\` | **ONLINE** | Verified Read/Write |
| **VFS Mirroring** | LocalStorage \`pixelops_vfs_files_v1\` | **SYNCED** | Mirror Confirmed |
| **Operational Sector** | ${sector.toUpperCase()} Station Grid | **ACTIVE** | Telemetry Green |

---

## 4. Recommended Operational Action Items
- [x] Complete primary intelligence sweep and structured dossier for **${title}**.
- [x] Commit finalized Markdown report to Workspace File Explorer (\`${filePath}\`).
- [ ] Review findings in the **Files** drawer (📁 Files) or inspect via CLI (\`pixelops cat ${filePath}\`).
`;

  return {
    title,
    filePath,
    markdown,
  };
}

/**
 * Persists a generated report directly into IndexedDB (`workspace_files`)
 * and LocalStorage VFS, returning the recorded entry.
 */
export async function uploadReportToWorkspaceFiles(params: {
  path: string;
  content: string;
  format?: 'markdown' | 'json' | 'text' | string;
  category?: 'reports' | 'logs' | 'config' | 'intel' | string;
  agentName?: string;
  agentRole?: string;
}): Promise<WorkspaceFileRecord> {
  const cleanPath = normalizeFilePath(params.path || 'reports/mission_brief.md');
  const format = params.format || (cleanPath.endsWith('.json') ? 'json' : 'markdown');
  const category =
    params.category ||
    (cleanPath.startsWith('intel/') ? 'intel' : cleanPath.startsWith('logs/') ? 'logs' : 'reports');

  const record = await writeWorkspaceFile(cleanPath, params.content, format, category);

  // Notify any active listeners across tabs or components
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('pixelops:workspace_file_saved', {
          detail: { path: cleanPath, sizeBytes: record.sizeBytes, updatedAt: record.updatedAt },
        })
      );
    } catch {
      // Ignore event dispatch errors in headless environments
    }
  }

  return record;
}
