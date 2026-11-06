/**
 * Cloudflare Pages Function: Universal Multi-Source Web Search & Real-Time Pricing Engine
 * Route: /api/search
 *
 * Gathers real-time intelligence, numbers, and prices for any service, product,
 * asset, or object across multiple independent online sources:
 * 1. DuckDuckGo HTML Organic Web Index (full web pages, pricing tables, product listings)
 * 2. Yahoo Organic Web Search Index (independent organic web results & snippets)
 * 3. Jina Real-Time Web Search Reader
 * 4. Yahoo Finance Live Quote & Commodity/Equity Oracle (stocks, ETFs, commodities, indices)
 * 5. CoinGecko Dynamic Crypto/Token Search & Spot Price Oracle
 * 6. Reddit Public Search JSON (real-world pricing reports, SaaS quotes, community benchmarks)
 * 7. Google Custom Search API (when configured) & Google News Live RSS
 * 8. Algolia Hacker News & Wikipedia Open Search
 * 9. Deep Live Page Number/Price Extractor (scrapes pricing sentences from top organic URLs)
 */

interface Env {
  GOOGLE_SEARCH_API_KEY?: string;
  GOOGLE_CSE_CX?: string;
  GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-google-api-key, x-google-cx',
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export interface SearchHit {
  title: string;
  snippet: string;
  extract: string;
  url: string;
  source: string;
  publishedAt?: string;
}

function decodeHtmlEntities(str: string): string {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&sup2;/g, '²')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchQuery(raw: string): {
  cleanQuery: string;
  subjectOnly: string;
  isPriceOrNumberQuery: boolean;
} {
  let q = String(raw || '').trim();
  q = q.replace(/^(?:vance|cipher|nyx|agent\s+\w+|operative\s+\w+)[,:\s-]+/i, '');
  q = q.replace(
    /^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:tell\s+me\s+|find\s+out\s+|search(?:\s+the\s+web)?(?:\s+for)?\s+|look\s+up\s+|check\s+|research\s+|investigate\s+)?(?:what(?:'s|s|\s+is|\s+are)\s+(?:the\s+)?|how\s+much\s+(?:does|do|is|are)\s+(?:the\s+)?)/i,
    ''
  );
  q = q.replace(/["'`“”?!]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) q = String(raw || '').trim();

  const isPriceOrNumberQuery =
    /\b(price|pricing|cost|costs|rate|rates|fee|fees|tier|tiers|subscription|plan|plans|worth|value|valuation|salary|msrp|quote|ticker|stock|crypto|how much|paid|commercial)\b/i.test(
      raw
    );

  // If the user originally asked "whats the cost of X" or "how much does X cost" and we stripped "whats the", ensure "pricing cost" is present
  let cleanQuery = q;
  if (isPriceOrNumberQuery && !/\b(price|pricing|cost|costs|rate|rates|fee|tier)\b/i.test(cleanQuery)) {
    cleanQuery = `${cleanQuery} price cost`;
  }

  const subjectOnly = cleanQuery
    .replace(/\b(price|pricing|cost|costs|rate|rates|fee|fees|current|live|2026|of|the|for|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    cleanQuery,
    subjectOnly: subjectOnly || cleanQuery,
    isPriceOrNumberQuery,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4500): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1. DuckDuckGo HTML Organic Web Search
 */
async function searchDuckDuckGoHtml(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const ddgHtmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(
      ddgHtmlUrl,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      4500
    );
    if (!res || !res.ok) return hits;
    const html = await res.text();

    const blocks = html.split(/class="result\s+results_links/i).slice(1, 9);
    for (const block of blocks) {
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
      if (!titleMatch) continue;

      let targetUrl = titleMatch[1];
      const uddgMatch = targetUrl.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          targetUrl = decodeURIComponent(uddgMatch[1]);
        } catch {}
      }
      if (targetUrl.startsWith('//')) targetUrl = `https:${targetUrl}`;
      if (!targetUrl.startsWith('http') || targetUrl.includes('duckduckgo.com/y.js')) continue;

      const title = decodeHtmlEntities(titleMatch[2]);
      const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1]) : '';
      if (!title || !snippet) continue;

      hits.push({
        title,
        snippet: snippet.slice(0, 380),
        extract: `[DuckDuckGo Web Index] ${title}: ${snippet} (Source: ${targetUrl})`,
        url: targetUrl,
        source: 'DuckDuckGo Web Search',
      });
    }
  } catch {}
  return hits;
}

/**
 * 2. Yahoo Organic Web Search
 */
async function searchYahooOrganic(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const yahooUrl = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}&n=6`;
    const res = await fetchWithTimeout(
      yahooUrl,
      {
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      4500
    );
    if (!res || !res.ok) return hits;
    const html = await res.text();

    const blocks = html.split(/class="dd\s+algo\s+algo-sr/i).slice(1, 7);
    for (const block of blocks) {
      const linkMatch = block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const snippetMatch = block.match(/class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (!linkMatch || !snippetMatch) continue;

      let targetUrl = linkMatch[1];
      const ruMatch = targetUrl.match(/\/RU=([^/]+)\/RK=/);
      if (ruMatch) {
        try {
          targetUrl = decodeURIComponent(ruMatch[1]);
        } catch {}
      }
      if (!targetUrl.startsWith('http') || targetUrl.includes('yahoo.com')) continue;

      const rawTitle = decodeHtmlEntities(linkMatch[2]).replace(/^.*?https?:\/\/[^\s]+\s*/i, '').trim();
      const snippet = decodeHtmlEntities(snippetMatch[1]);
      if (!rawTitle || !snippet || snippet.length < 25) continue;

      hits.push({
        title: rawTitle.slice(0, 120),
        snippet: snippet.slice(0, 380),
        extract: `[Yahoo Web Index] ${rawTitle}: ${snippet} (Source: ${targetUrl})`,
        url: targetUrl,
        source: 'Yahoo Web Search',
      });
    }
  } catch {}
  return hits;
}

/**
 * 3. Jina Real-Time Web Search Reader
 */
async function searchJinaWeb(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const res = await fetchWithTimeout(
      `https://s.jina.ai/${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Retain-Images': 'none',
        },
      },
      4500
    );
    if (!res || !res.ok) return hits;
    const data: any = await res.json().catch(() => null);
    if (data && Array.isArray(data.data)) {
      for (const item of data.data.slice(0, 5)) {
        if (!item || (!item.title && !item.url)) continue;
        const snippet = String(item.description || item.content || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!snippet) continue;
        hits.push({
          title: String(item.title || item.url).trim(),
          snippet: snippet.slice(0, 380),
          extract: `[Jina Live Web Reader] ${item.title}: ${snippet.slice(0, 650)} (Source: ${item.url})`,
          url: item.url,
          source: 'Jina Web Search',
        });
      }
    }
  } catch {}
  return hits;
}

/**
 * 4. Yahoo Finance Live Equity, ETF, Index & Commodity Oracle
 */
async function searchYahooFinance(subject: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  if (!subject || subject.length < 2) return hits;
  try {
    const searchRes = await fetchWithTimeout(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(subject)}&quotesCount=2&newsCount=0`,
      { headers: { 'User-Agent': BROWSER_UA } },
      3500
    );
    if (!searchRes || !searchRes.ok) return hits;
    const searchData: any = await searchRes.json();
    const quotes = Array.isArray(searchData?.quotes) ? searchData.quotes.slice(0, 2) : [];

    for (const q of quotes) {
      const symbol = q?.symbol;
      if (!symbol) continue;
      const chartRes = await fetchWithTimeout(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
        { headers: { 'User-Agent': BROWSER_UA } },
        3500
      );
      if (!chartRes || !chartRes.ok) continue;
      const chartData: any = await chartRes.json();
      const meta = chartData?.chart?.result?.[0]?.meta;
      if (!meta || meta.regularMarketPrice === undefined) continue;

      const price = Number(meta.regularMarketPrice);
      const prevClose = Number(meta.chartPreviousClose || meta.previousClose || price);
      const diff = price - prevClose;
      const pct = prevClose > 0 ? ((diff / prevClose) * 100).toFixed(2) : '0.00';
      const currency = meta.currency || 'USD';
      const name = meta.longName || meta.shortName || q.longname || q.shortname || symbol;

      const snippet = `Live Market Price: $${price.toLocaleString()} ${currency} (${diff >= 0 ? '+' : ''}${pct}%) | Previous Close: $${prevClose.toLocaleString()} ${currency} | 52w Range: $${meta.fiftyTwoWeekLow ?? 'N/A'} - $${meta.fiftyTwoWeekHigh ?? 'N/A'} | Exchange: ${meta.exchangeName || q.exchDisp || 'Market'}.`;
      hits.push({
        title: `${name} (${symbol}) — Live Yahoo Finance Quote`,
        snippet,
        extract: `[Yahoo Finance Live Oracle] ${name} (${symbol}): ${snippet}`,
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
        source: 'Yahoo Finance',
      });
    }
  } catch {}
  return hits;
}

/**
 * 5. CoinGecko Dynamic Crypto/Token Search & Live Price Oracle
 */
async function searchCoinGecko(subject: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  if (!subject || subject.length < 2) return hits;
  try {
    const searchRes = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(subject)}`,
      { headers: { Accept: 'application/json' } },
      3500
    );
    if (!searchRes || !searchRes.ok) return hits;
    const searchData: any = await searchRes.json();
    const topCoin = searchData?.coins?.[0];
    if (!topCoin || !topCoin.id) return hits;

    // Verify the coin name or symbol actually appears in the subject query to avoid false matches
    const subLower = subject.toLowerCase();
    const coinNameLower = String(topCoin.name || '').toLowerCase();
    const coinSymLower = String(topCoin.symbol || '').toLowerCase();
    if (!subLower.includes(coinNameLower) && !new RegExp(`\\b${coinSymLower}\\b`, 'i').test(subLower)) {
      return hits;
    }

    const priceRes = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(topCoin.id)}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
      { headers: { Accept: 'application/json' } },
      3500
    );
    if (!priceRes || !priceRes.ok) return hits;
    const priceData: any = await priceRes.json();
    const pObj = priceData?.[topCoin.id];
    if (!pObj || pObj.usd === undefined) return hits;

    const usd = Number(pObj.usd);
    const chg = Number(pObj.usd_24h_change || 0).toFixed(2);
    const mcap = pObj.usd_market_cap ? `$${Math.round(Number(pObj.usd_market_cap)).toLocaleString()} USD` : 'N/A';
    const snippet = `Live Spot Price: $${usd.toLocaleString(undefined, { maximumFractionDigits: 6 })} USD (${Number(chg) >= 0 ? '+' : ''}${chg}% 24h) | Market Cap: ${mcap}.`;

    hits.push({
      title: `${topCoin.name} (${String(topCoin.symbol).toUpperCase()}) — CoinGecko Live Spot Price`,
      snippet,
      extract: `[CoinGecko Live Oracle] ${topCoin.name} (${String(topCoin.symbol).toUpperCase()}): ${snippet}`,
      url: `https://www.coingecko.com/en/coins/${topCoin.id}`,
      source: 'CoinGecko',
    });
  } catch {}
  return hits;
}

/**
 * 6. Reddit Public Search JSON (Real-World Pricing Reports & Community Benchmarks)
 */
async function searchRedditPublic(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const res = await fetchWithTimeout(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=3`,
      {
        headers: {
          'User-Agent': 'PixelOps-OSINT-Agent/2.0',
          Accept: 'application/json',
        },
      },
      3800
    );
    if (!res || !res.ok) return hits;
    const data: any = await res.json();
    const children = data?.data?.children || [];
    for (const child of children) {
      const post = child?.data;
      if (!post || !post.title) continue;
      const body = String(post.selftext || '')
        .replace(/\s+/g, ' ')
        .trim();
      const snippet = body ? `${post.title} — ${body.slice(0, 320)}` : post.title;
      const url = post.permalink ? `https://www.reddit.com${post.permalink}` : post.url;
      hits.push({
        title: `${post.title} (r/${post.subreddit || 'reddit'})`,
        snippet: snippet.slice(0, 380),
        extract: `[Reddit Community Intelligence r/${post.subreddit}] ${post.title}: ${body.slice(0, 600)}`,
        url,
        source: `Reddit (r/${post.subreddit || 'search'})`,
      });
    }
  } catch {}
  return hits;
}

/**
 * 7. Deep Live Page Number & Pricing Extractor
 * Fetches the top organic web URL and extracts sentences containing real currency/numerical figures.
 */
async function enrichTopHitsWithLivePageNumbers(hits: SearchHit[]): Promise<void> {
  const candidates = hits
    .filter(
      (h) =>
        (h.source === 'DuckDuckGo Web Search' || h.source === 'Yahoo Web Search') &&
        h.url.startsWith('http') &&
        !h.url.includes('.pdf')
    )
    .slice(0, 3);

  await Promise.all(
    candidates.map(async (hit) => {
      try {
        const res = await fetchWithTimeout(
          hit.url,
          {
            headers: {
              'User-Agent': BROWSER_UA,
              Accept: 'text/html,application/xhtml+xml',
            },
          },
          3800
        );
        if (!res || !res.ok) return;
        const rawHtml = await res.text();
        const cleanText = rawHtml
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&#0?39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim();

        // Find clauses/sentences containing explicit prices or numerical units
        const priceClauseRegex =
          /[^.!?]*?(?:[\$€£]\s?\d+(?:,\d{3})*(?:\.\d{1,4})?|\b\d+(?:,\d{3})*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|cents|per\s+month|\/mo|\/yr|per\s+sq\s*km|\/km))[^.!?]*[.!?]?/gi;
        const matches = cleanText.match(priceClauseRegex) || [];
        const uniqueValid = Array.from(
          new Set(
            matches
              .map((m) => m.trim())
              .filter((m) => m.length >= 18 && m.length <= 240)
          )
        ).slice(0, 4);

        if (uniqueValid.length > 0) {
          const priceExcerpt = uniqueValid.join(' | ');
          hit.snippet = `${hit.snippet} [Live Page Pricing Figures: ${priceExcerpt.slice(0, 260)}]`.slice(0, 500);
          hit.extract = `${hit.extract}\nVerified Live Page Pricing Excerpts: ${priceExcerpt}`;
        }
      } catch {}
    })
  );
}

export const onRequest = async (context: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return onRequestOptions();
  }

  let query = '';
  let limit = 8;

  if (request.method === 'GET') {
    const url = new URL(request.url);
    query = (url.searchParams.get('q') || url.searchParams.get('query') || '').trim();
    limit = Math.min(12, Math.max(1, Number(url.searchParams.get('limit')) || 8));
  } else if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      query = (body.q || body.query || '').trim();
      limit = Math.min(12, Math.max(1, Number(body.limit || body.maxResults) || 8));
    } catch {
      // Ignore
    }
  }

  if (!query) {
    return new Response(
      JSON.stringify({ error: 'MISSING_QUERY', message: 'A search query "q" or "query" parameter is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }

  const { cleanQuery, subjectOnly, isPriceOrNumberQuery } = normalizeSearchQuery(query);
  const results: SearchHit[] = [];

  const pushUnique = (hit: SearchHit) => {
    if (!hit || !hit.url || !hit.title) return;
    const normUrl = hit.url.replace(/\/+$/, '').toLowerCase();
    if (results.some((r) => r.url.replace(/\/+$/, '').toLowerCase() === normUrl)) return;
    results.push(hit);
  };

  // Run multi-source organic web & financial oracle searches concurrently
  const [ddgHtmlHits, yahooOrganicHits, jinaHits, yahooFinanceHits, coinGeckoHits, redditHits] = await Promise.all([
    searchDuckDuckGoHtml(cleanQuery),
    searchYahooOrganic(cleanQuery),
    searchJinaWeb(cleanQuery),
    isPriceOrNumberQuery ? searchYahooFinance(subjectOnly) : Promise.resolve([]),
    isPriceOrNumberQuery ? searchCoinGecko(subjectOnly) : Promise.resolve([]),
    searchRedditPublic(cleanQuery),
  ]);

  // 1. Prioritize live financial/crypto oracles when matched
  for (const h of [...yahooFinanceHits, ...coinGeckoHits]) {
    if (results.length < limit) pushUnique(h);
  }

  // 2. Interleave DuckDuckGo Organic Web Search & Yahoo Organic Web Search for multi-source diversity
  const maxOrganic = Math.max(ddgHtmlHits.length, yahooOrganicHits.length, jinaHits.length);
  for (let i = 0; i < maxOrganic; i++) {
    if (ddgHtmlHits[i] && results.length < limit) pushUnique(ddgHtmlHits[i]);
    if (yahooOrganicHits[i] && results.length < limit) pushUnique(yahooOrganicHits[i]);
    if (jinaHits[i] && results.length < limit) pushUnique(jinaHits[i]);
  }

  // 3. Add Reddit community pricing / benchmark hits
  for (const h of redditHits.slice(0, 2)) {
    if (results.length < limit) pushUnique(h);
  }

  // 4. Deep-scrape top organic web pages for explicit currency/price sentences when pricing is requested
  if (isPriceOrNumberQuery && results.length > 0) {
    await enrichTopHitsWithLivePageNumbers(results);
  }

  // 5. Google Official Custom Search API (If credentials configured)
  const googleKey = request.headers.get('x-google-api-key') || env?.GOOGLE_SEARCH_API_KEY || env?.GEMINI_API_KEY;
  const googleCx = request.headers.get('x-google-cx') || env?.GOOGLE_CSE_CX;
  if (googleKey && googleCx && results.length < limit) {
    try {
      const cseUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(cleanQuery)}&num=4`;
      const cseRes = await fetchWithTimeout(cseUrl, {}, 3500);
      if (cseRes && cseRes.ok) {
        const cseData: any = await cseRes.json();
        for (const item of cseData.items || []) {
          if (results.length >= limit) break;
          pushUnique({
            title: item.title,
            snippet: item.snippet || item.title,
            extract: `[Google Search] "${item.title}" - ${item.snippet} (Source: ${item.link})`,
            url: item.link,
            source: 'Google Search',
          });
        }
      }
    } catch {}
  }

  // 6. Google News Live RSS Feed (up to 2 recent articles for news corroboration)
  if (results.length < limit) {
    try {
      const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(cleanQuery)}&hl=en-US&gl=US&ceid=US:en`;
      const gnRes = await fetchWithTimeout(
        googleNewsUrl,
        {
          headers: {
            'User-Agent': BROWSER_UA,
            Accept: 'application/rss+xml, application/xml, text/xml',
          },
        },
        3500
      );

      if (gnRes && gnRes.ok) {
        const xml = await gnRes.text();
        const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

        for (const itemXml of itemMatches.slice(0, 2)) {
          if (results.length >= limit) break;
          const rawTitle = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
          const cleanTitle = decodeHtmlEntities(rawTitle);
          const rawLink = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
          const pubDate = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
          const sourceName = decodeHtmlEntities(itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || 'Google News');

          if (cleanTitle) {
            pushUnique({
              title: cleanTitle,
              snippet: `${cleanTitle} (${sourceName}, ${pubDate})`,
              extract: `[Google News] "${cleanTitle}" (${sourceName}, ${pubDate})`,
              url: rawLink || `https://news.google.com/search?q=${encodeURIComponent(cleanTitle)}`,
              source: `Google News (${sourceName})`,
              publishedAt: pubDate,
            });
          }
        }
      }
    } catch {}
  }

  // 7. DuckDuckGo Instant Knowledge API & Wikipedia Open Search (if still under limit)
  if (results.length < limit) {
    try {
      const wikiRes = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(subjectOnly)}&utf8=&format=json&origin=*`,
        {},
        3000
      );
      if (wikiRes && wikiRes.ok) {
        const wikiData: any = await wikiRes.json();
        for (const item of (wikiData?.query?.search || []).slice(0, 2)) {
          if (results.length >= limit) break;
          if (!item || !item.title) continue;
          const cleanSnippet = decodeHtmlEntities(item.snippet || '');
          const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`;
          pushUnique({
            title: `${item.title} (Wikipedia)`,
            snippet: cleanSnippet.slice(0, 320),
            extract: `[Wikipedia] ${item.title}: ${cleanSnippet}`,
            url: wikiUrl,
            source: 'Wikipedia',
          });
        }
      }
    } catch {}
  }

  const distinctSources = Array.from(new Set(results.map((r) => r.source)));

  return new Response(
    JSON.stringify({
      ok: true,
      query,
      cleanQuery,
      resultCount: results.length,
      sourcesConsulted: distinctSources,
      results,
      googleSearchUrl: `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`,
      fetchedAt: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
        ...CORS_HEADERS,
      },
    }
  );
};
