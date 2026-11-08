/**
 * S2 Underground Wire Text Parser for PixelOps Agents (Client & Worker Service)
 * Pulls clean text dispatches from https://feeds.buzzsprout.com/868255.rss
 * (formatted with clear headers like //The Wire//, //BLUF://, and //END REPORT//)
 * and formats them into agent-ready SITREP context.
 */

export const S2_WIRE_FEED_URL = 'https://feeds.buzzsprout.com/868255.rss';

export interface S2WireDispatch {
  title: string;
  content: string;
  timestamp: string;
  link?: string;
}

/**
 * Parses raw XML string from https://feeds.buzzsprout.com/868255.rss into clean text dispatches.
 */
export function parseS2WireXml(xmlText: string, maxItems = 5): S2WireDispatch[] {
  if (!xmlText || typeof xmlText !== 'string') return [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const dispatches: S2WireDispatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xmlText)) !== null && dispatches.length < maxItems) {
    const itemContent = match[1];
    const titleMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/);
    const descMatch =
      itemContent.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/) ||
      itemContent.match(/<description>([\s\S]*?)<\/description>/);
    const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const linkMatch =
      itemContent.match(/<link>([\s\S]*?)<\/link>/) ||
      itemContent.match(/<enclosure[^>]+url="([^"]+)"/);

    if (titleMatch && descMatch) {
      // Strip HTML entities and tags to leave clean text while preserving SITREP line structure
      const cleanDesc = descMatch[1]
        // Remove CDATA tags if present
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        // Preserve line breaks for <br>, </p>, </div>, </li> before stripping tags
        .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n')
        // Strip standard HTML tags
        .replace(/<\/?[^>]+(>|$)/g, '')
        // Clean up HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const cleanTitle = titleMatch[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<\/?[^>]+(>|$)/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      let parsedTimestamp = new Date().toISOString();
      if (pubDateMatch && pubDateMatch[1]) {
        const dt = new Date(pubDateMatch[1].trim());
        if (!isNaN(dt.getTime())) {
          parsedTimestamp = dt.toISOString();
        }
      }

      const link = linkMatch
        ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
        : S2_WIRE_FEED_URL;

      dispatches.push({
        title: cleanTitle,
        content: cleanDesc,
        timestamp: parsedTimestamp,
        link,
      });
    }
  }

  return dispatches;
}

/**
 * Pulls clean text dispatches from S2 Underground's Buzzsprout RSS feed.
 * Uses direct fetch in server/worker environments and falls back to `/api/intel/classified-feed`
 * or `/api/fetch` proxy in browser environments if CORS blocks direct RSS reading.
 */
export async function fetchS2WireFeed(): Promise<S2WireDispatch[]> {
  // 1. In browser context, try the server/Cloudflare route `/api/intel/classified-feed` first
  if (typeof window !== 'undefined') {
    try {
      const apiRes = await fetch('/api/intel/classified-feed');
      if (apiRes.ok) {
        const payload = await apiRes.json();
        if (Array.isArray(payload?.dispatches) && payload.dispatches.length > 0) {
          return payload.dispatches;
        }
        if (Array.isArray(payload?.entries) && payload.entries.length > 0) {
          return payload.entries.map((e: any) => ({
            title: e.title,
            content: e.content || e.transcript || e.description || '',
            timestamp: e.timestamp || e.published || new Date().toISOString(),
            link: e.link,
          }));
        }
      }
    } catch {
      // Fall through to direct fetch or proxy
    }
  }

  // 2. Direct fetch from https://feeds.buzzsprout.com/868255.rss
  try {
    const response = await fetch(S2_WIRE_FEED_URL);
    if (response.ok) {
      const xmlText = await response.text();
      const parsed = parseS2WireXml(xmlText);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    // Fall through to proxy fetch
  }

  // 3. Browser proxy fallback via `/api/fetch`
  if (typeof window !== 'undefined') {
    try {
      const proxyRes = await fetch(`/api/fetch?url=${encodeURIComponent(S2_WIRE_FEED_URL)}`);
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        const xmlText = proxyData?.text || proxyData?.data || '';
        const parsed = parseS2WireXml(xmlText);
        if (parsed.length > 0) return parsed;
      }
    } catch (error) {
      console.error('[PixelOps Intel Error] Failed to parse S2 Wire feed:', error);
    }
  }

  return [];
}

/**
 * Formats raw dispatches into a structured prompt context block for Agent Vance or Nyx
 */
export function buildAgentSITREPContext(dispatches: S2WireDispatch[]): string {
  if (!dispatches || !dispatches.length) return 'No active intelligence dispatches available.';

  return dispatches
    .map(
      (dispatch, index) => `
[INTEL REPORT 0${index + 1}]
TITLE: ${dispatch.title}
TIMESTAMP: ${dispatch.timestamp}
CONTENT:
${dispatch.content}
----------------------------------------
  `
    )
    .join('\n');
}

/**
 * Builds the SITREP system and user prompt payload for an autonomous agent recon sweep.
 */
export async function buildAgentReconMissionPrompts(agentName: string): Promise<{
  dispatches: S2WireDispatch[];
  sitrepContext: string;
  systemPrompt: string;
  userPrompt: string;
}> {
  const rawDispatches = await fetchS2WireFeed();
  const sitrepContext = buildAgentSITREPContext(rawDispatches);

  const systemPrompt = `You are Agent ${agentName}, an autonomous intelligence operative inside PixelOps. 
Analyze the following text-based situational reports (SITREPs). Extract macro anomalies, infrastructure risks, and actionable intelligence points. Compile a structured dossier for the Director-tier operator.`;

  const userPrompt = `Here is the latest intelligence stream:\n\n${sitrepContext}\n\nGenerate a prioritized threat matrix report.`;

  return {
    dispatches: rawDispatches,
    sitrepContext,
    systemPrompt,
    userPrompt,
  };
}
