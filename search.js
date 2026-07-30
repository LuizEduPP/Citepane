const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/';
const DUCKDUCKGO_LITE_URL = 'https://lite.duckduckgo.com/lite/';
const DUCKDUCKGO_IA_URL = 'https://api.duckduckgo.com/';

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

function isDuckDuckGoChallenge(html, status) {
  if (status === 403 || status === 202) {
    return true;
  }
  if (typeof html !== 'string') {
    return false;
  }
  return /anomaly-modal|bots use DuckDuckGo|challenge-form/i.test(html);
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

function parseDuckDuckGoLiteHtml(html) {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('Empty DuckDuckGo lite HTML response');
  }

  const results = [];
  const linkRegex =
    /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>)?/gi;

  let match = linkRegex.exec(html);
  while (match && results.length < SEARCH_RESULT_LIMIT) {
    const href = decodeHtmlEntities(match[1]);
    const title = stripTags(match[2]);
    const snippet = stripTags(match[3] || '');
    try {
      const url = extractDuckDuckGoUrl(href);
      if (title && url) {
        results.push({ title, url, snippet });
      }
    } catch {
      // skip
    }
    match = linkRegex.exec(html);
  }

  if (results.length === 0) {
    // Fallback shape used by some lite responses.
    const altRegex =
      /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let alt = altRegex.exec(html);
    while (alt && results.length < SEARCH_RESULT_LIMIT) {
      try {
        const url = extractDuckDuckGoUrl(decodeHtmlEntities(alt[1]));
        const title = stripTags(alt[2]);
        if (title && url) {
          results.push({ title, url, snippet: '' });
        }
      } catch {
        // skip
      }
      alt = altRegex.exec(html);
    }
  }

  return results;
}

function pushEvidence(results, title, url, snippet) {
  if (!title || !url || results.length >= SEARCH_RESULT_LIMIT) {
    return;
  }
  if (results.some((item) => item.url === url)) {
    return;
  }
  results.push({
    title: String(title).trim(),
    url: String(url).trim(),
    snippet: typeof snippet === 'string' ? snippet.trim() : '',
  });
}

function collectInstantAnswerTopics(nodes, results) {
  if (!Array.isArray(nodes)) {
    return;
  }

  for (const node of nodes) {
    if (results.length >= SEARCH_RESULT_LIMIT) {
      return;
    }
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (typeof node.FirstURL === 'string' && typeof node.Text === 'string') {
      const title = node.Text.split(' - ')[0] || node.Text;
      pushEvidence(results, title, node.FirstURL, node.Text);
      continue;
    }
    if (Array.isArray(node.Topics)) {
      collectInstantAnswerTopics(node.Topics, results);
    }
  }
}

function parseInstantAnswer(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid Instant Answer payload');
  }

  const results = [];

  if (payload.AbstractText && payload.AbstractURL) {
    pushEvidence(
      results,
      payload.Heading || payload.AbstractURL,
      payload.AbstractURL,
      payload.AbstractText,
    );
  }

  if (Array.isArray(payload.Results)) {
    for (const item of payload.Results) {
      if (item?.FirstURL && item?.Text) {
        pushEvidence(results, item.Text.split(' - ')[0] || item.Text, item.FirstURL, item.Text);
      }
    }
  }

  collectInstantAnswerTopics(payload.RelatedTopics, results);
  return results;
}

async function searchDuckDuckGoHtml(query) {
  const body = new URLSearchParams({ q: query, kl: 'wt-wt' });
  const response = await fetch(DUCKDUCKGO_HTML_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
    },
    body: body.toString(),
  });

  const html = await response.text();
  if (!response.ok || isDuckDuckGoChallenge(html, response.status)) {
    throw new Error(`DuckDuckGo HTML blocked (HTTP ${response.status})`);
  }

  const results = parseDuckDuckGoHtml(html);
  if (results.length === 0) {
    throw new Error('DuckDuckGo HTML returned no parseable results');
  }
  return results;
}

async function searchDuckDuckGoLite(query) {
  const url = new URL(DUCKDUCKGO_LITE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('kl', 'wt-wt');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });
  const html = await response.text();
  if (!response.ok || isDuckDuckGoChallenge(html, response.status)) {
    throw new Error(`DuckDuckGo lite blocked (HTTP ${response.status})`);
  }

  const results = parseDuckDuckGoLiteHtml(html);
  if (results.length === 0) {
    throw new Error('DuckDuckGo lite returned no parseable results');
  }
  return results;
}

async function searchDuckDuckGoInstantAnswer(query) {
  const url = new URL(DUCKDUCKGO_IA_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_redirect', '1');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo Instant Answer HTTP ${response.status}`);
  }

  const payload = await response.json();
  const results = parseInstantAnswer(payload);
  if (results.length === 0) {
    throw new Error('DuckDuckGo Instant Answer returned no results');
  }
  return results;
}

async function searchDuckDuckGo(selectionText) {
  const query = buildSearchQuery(selectionText);
  const errors = [];

  for (const attempt of [
    () => searchDuckDuckGoHtml(query),
    () => searchDuckDuckGoLite(query),
    () => searchDuckDuckGoInstantAnswer(query),
  ]) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(' | ') || 'DuckDuckGo search failed');
}

async function fetchDuckDuckGoVqd(query) {
  const url = new URL('https://duckduckgo.com/');
  url.searchParams.set('q', query);
  const response = await fetch(url.toString(), {
    headers: { Accept: 'text/html' },
  });
  const html = await response.text();
  if (!response.ok || isDuckDuckGoChallenge(html, response.status)) {
    throw new Error(`DuckDuckGo vqd blocked (HTTP ${response.status})`);
  }

  const patterns = [
    /vqd=["']([^"']+)["']/,
    /"vqd"\s*:\s*"([^"]+)"/,
    /vqd=([^&"']+)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error('DuckDuckGo vqd token not found');
}

function pushMediaEvidence(results, item) {
  if (!item?.url || results.length >= MEDIA_SEARCH_RESULT_LIMIT) {
    return;
  }
  if (
    results.some(
      (entry) =>
        entry.url === item.url || (item.imageUrl && entry.imageUrl === item.imageUrl),
    )
  ) {
    return;
  }
  results.push(item);
}

async function searchDuckDuckGoImages(selectionText) {
  const query = buildSearchQuery(selectionText);
  const vqd = await fetchDuckDuckGoVqd(query);
  const url = new URL('https://duckduckgo.com/i.js');
  url.searchParams.set('l', 'wt-wt');
  url.searchParams.set('o', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('vqd', vqd);
  url.searchParams.set('f', ',,,');
  url.searchParams.set('p', '1');

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo images HTTP ${response.status}`);
  }

  const payload = await response.json();
  const results = [];
  for (const row of payload?.results || []) {
    const imageUrl = typeof row.image === 'string' ? row.image : '';
    const pageUrl = typeof row.url === 'string' ? row.url : imageUrl;
    const title = stripTags(String(row.title || row.source || 'Image'));
    if (!pageUrl && !imageUrl) {
      continue;
    }
    pushMediaEvidence(results, {
      title,
      url: pageUrl || imageUrl,
      imageUrl: imageUrl || pageUrl,
      thumbnail: typeof row.thumbnail === 'string' ? row.thumbnail : imageUrl,
      snippet: typeof row.source === 'string' ? row.source : '',
      kind: 'image',
    });
  }

  if (results.length === 0) {
    throw new Error('DuckDuckGo images returned no results');
  }
  return results;
}

async function searchDuckDuckGoVideos(selectionText) {
  const query = buildSearchQuery(selectionText);
  const vqd = await fetchDuckDuckGoVqd(query);
  const url = new URL('https://duckduckgo.com/v.js');
  url.searchParams.set('l', 'wt-wt');
  url.searchParams.set('o', 'json');
  url.searchParams.set('q', query);
  url.searchParams.set('vqd', vqd);
  url.searchParams.set('f', ',,,');

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo videos HTTP ${response.status}`);
  }

  const payload = await response.json();
  const results = [];
  for (const row of payload?.results || []) {
    const pageUrl =
      typeof row.content === 'string'
        ? row.content
        : typeof row.url === 'string'
          ? row.url
          : '';
    const title = stripTags(String(row.title || 'Video'));
    if (!pageUrl) {
      continue;
    }
    const duration = row.duration ? String(row.duration) : '';
    const publisher = row.publisher ? String(row.publisher) : '';
    const snippetParts = [publisher, duration].filter(Boolean);
    pushMediaEvidence(results, {
      title,
      url: pageUrl,
      thumbnail:
        typeof row.images?.medium === 'string'
          ? row.images.medium
          : typeof row.thumbnail === 'string'
            ? row.thumbnail
            : '',
      snippet: snippetParts.join(' · '),
      kind: 'video',
    });
  }

  if (results.length === 0) {
    throw new Error('DuckDuckGo videos returned no results');
  }
  return results;
}

async function searchEvidence(selectionText, searchKind = 'web') {
  if (searchKind === 'images') {
    return searchDuckDuckGoImages(selectionText);
  }
  if (searchKind === 'videos') {
    return searchDuckDuckGoVideos(selectionText);
  }
  return searchDuckDuckGo(selectionText);
}
