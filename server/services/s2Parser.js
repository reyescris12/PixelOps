/**
 * S2 Underground Wire Text Parser for PixelOps Agents
 * Pulls clean text dispatches and formats them into agent-ready context.
 */

export const S2_BUZZSPROUT_RSS_URL = 'https://feeds.buzzsprout.com/868255.rss';

export async function fetchS2WireFeed() {
  try {
    // Fetching from S2 Underground's clean text / Buzzsprout RSS dispatch channel
    const response = await fetch(S2_BUZZSPROUT_RSS_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 PixelOps-Intelligence/2.0',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    const xmlText = await response.text();

    return parseS2WireXml(xmlText);
  } catch (error) {
    console.error('[PixelOps Intel Error] Failed to parse S2 Wire feed:', error);
    return [];
  }
}

/**
 * Extracts and cleans up to 5 structured SITREP dispatches from S2 Wire RSS XML.
 */
export function parseS2WireXml(xmlText) {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const dispatches = [];
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null && dispatches.length < 5) {
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
      // Strip HTML entities and tags to leave clean text while preserving paragraph breaks
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

      const link = linkMatch ? linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : S2_BUZZSPROUT_RSS_URL;

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
 * Formats raw dispatches into a structured prompt context block for Agent Vance or Nyx
 */
export function buildAgentSITREPContext(dispatches) {
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
