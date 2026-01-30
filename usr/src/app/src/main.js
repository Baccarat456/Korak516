import { Actor } from 'apify';
import { CheerioCrawler, Dataset, KeyValueStore } from 'crawlee';

// Initialize Actor runtime
await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  sitemaps = ['https://example.com/sitemap.xml'],
  maxRequestsPerCrawl = 500,
  extractMainText = true,
  followInternalOnly = true,
} = input;

// Utility: fetch sitemap XML and extract <loc> entries; handles sitemap index files.
async function fetchSitemapLocs(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();

    // quick check: if sitemap index (contains <sitemap> entries), pull nested sitemaps
    const sitemapMatches = Array.from(text.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>[\s\S]*?<\/sitemap>/gi)).map(m => m[1]);
    if (sitemapMatches.length) {
      // flatten nested sitemaps
      const results = [];
      for (const s of sitemapMatches) {
        try {
          const r = await fetchSitemapLocs(new URL(s, url).toString());
          results.push(...r);
        } catch (e) {
          // continue
        }
      }
      return results;
    }

    // Extract all <loc>...</loc> entries
    const locMatches = Array.from(text.matchAll(/<loc>(.*?)<\/loc>/gi)).map(m => m[1].trim());
    return locMatches;
  } catch (err) {
    console.warn('fetchSitemapLocs error', err.message);
    return [];
  }
}

// Normalize URL to use as KeyValueStore key
function keyFromUrl(u) {
  return `pages/${encodeURIComponent(u)}`;
}

// Main
const proxyConfiguration = await Actor.createProxyConfiguration();
const kv = await KeyValueStore.open();

const allUrlsSet = new Set();
for (const sm of sitemaps) {
  const locs = await fetchSitemapLocs(sm);
  for (const l of locs) {
    // optional hostname restriction will be applied later during enqueue or crawling
    allUrlsSet.add(JSON.stringify({ url: l, sitemap: sm }));
  }
}

const startRequests = Array.from(allUrlsSet).map(j => JSON.parse(j));

// Create CheerioCrawler to fetch pages and extract metadata
const crawler = new CheerioCrawler({
  proxyConfiguration,
  maxRequestsPerCrawl,
  async requestHandler({ request, $, enqueueLinks, log }) {
    const { url, sitemap } = request.userData;
    log.info('Processing', { url });

    // Optionally enqueue links found on the page (bounded by followInternalOnly)
    await enqueueLinks({
      globs: ['**/*'],
      transformRequestFunction: (r) => {
        if (!r.url) return null;
        if (followInternalOnly) {
          try {
            const startHost = new URL(request.userData.startHost || url).host;
            if (new URL(r.url).host !== startHost) return null;
          } catch (e) {
            return null;
          }
        }
        return r;
      },
      userData: { startHost: request.userData.startHost || new URL(url).host },
    });

    // Extract metadata
    const title = $('meta[property="og:title"]').attr('content') ||
                  $('meta[name="twitter:title"]').attr('content') ||
                  $('title').first().text().trim() || '';

    const metaDescription = $('meta[name="description"]').attr('content') ||
                            $('meta[property="og:description"]').attr('content') || '';

    // Main text snippet heuristics
    let snippet = '';
    if (extractMainText) {
      // Prefer article/main selectors
      const article = $('article, main, [role="main"]').first();
      if (article && article.length) {
        snippet = article.text().replace(/\s+/g, ' ').trim().slice(0, 800);
      } else {
        // fallback: first substantial paragraph
        const p = $('p').filter((i, el) => $(el).text().trim().length > 40).first();
        snippet = p.text().replace(/\s+/g, ' ').trim().slice(0, 800);
      }
    }

    // Save a compact record to Dataset
    await Dataset.pushData({
      title,
      url,
      sitemap: sitemap || request.userData.sitemap || '',
      meta_description: metaDescription,
      snippet,
    });

    // Save full JSON to KeyValueStore under pages/<encoded-url>
    const full = {
      url,
      sitemap: sitemap || request.userData.sitemap || '',
      title,
      meta_description: metaDescription,
      snippet,
      timestamp: new Date().toISOString(),
    };
    try {
      await kv.setValue(keyFromUrl(url), full, { contentType: 'application/json' });
    } catch (e) {
      log.warning('Failed to save KV entry', { key: keyFromUrl(url), error: e.message });
    }
  },

  requestHandlerTimeoutSecs: 60,
  // optional: customize request retries, concurrency, etc.
});

// Prepare startRequests with userData and optional host restriction
const prepared = startRequests.map(r => {
  try {
    const parsed = new URL(r.url);
    return {
      url: r.url,
      userData: { sitemap: r.sitemap, startHost: parsed.host },
    };
  } catch (e) {
    return { url: r.url, userData: { sitemap: r.sitemap } };
  }
});

// Run crawler
await crawler.run(prepared);

// Exit gracefully
await Actor.exit();
