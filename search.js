const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function extractDuckDuckGoUrl(href) {
  if (!href) {
    throw new Error('Missing result href');
  }

  const absolute = href.startsWith('http')
    ? href
    : `https://duckduckgo.com${href.startsWith('/') ? '' : '/'}${href}`;

  try {
    const parsed = new URL(absolute);
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    if (parsed.hostname !== 'duckduckgo.com' && parsed.hostname !== 'html.duckduckgo.com') {
      return parsed.toString();
    }
  } catch {
    throw new Error(`Invalid result URL: ${href}`);
  }

  throw new Error(`Could not resolve result URL from ${href}`);
}

function parseDuckDuckGoHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('Empty DuckDuckGo HTML response');
  }

  const results = [];
  const blockRegex =
    /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;

  let match = blockRegex.exec(html);
  while (match && results.length < SEARCH_RESULT_LIMIT) {
    const href = decodeHtmlEntities(match[1]);
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3] || match[4] || '');

    try {
      const url = extractDuckDuckGoUrl(href);
      if (title && url) {
        results.push({ title, url, snippet });
      }
    } catch {
      // Skip malformed result rows; fail later if none remain.
    }

    match = blockRegex.exec(html);
  }

  return results;
}

async function searchDuckDuckGo(selectionText) {
  const query = buildSearchQuery(selectionText);
  const body = new URLSearchParams({ q: query, kl: 'wt-wt' });

  const response = await fetch(DUCKDUCKGO_HTML_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = parseDuckDuckGoHtml(html);

  if (results.length === 0) {
    throw new Error('DuckDuckGo returned no parseable results');
  }

  return results;
}
