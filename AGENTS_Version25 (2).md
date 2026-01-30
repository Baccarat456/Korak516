# Sitemap-to-api scraper — AGENTS

This Actor fetches sitemap.xml(s), extracts URLs, crawls pages, and stores structured outputs in the default dataset and Key-Value store for API consumption.

Do:
- Use the Actor input to provide sitemap URLs.
- Respect robots.txt and site Terms of Service.
- Use proxies and reasonable concurrency for production runs.

Next steps you might want:
- Add article/main-text extraction library (readability) for higher-quality content extraction.
- Add rate-limiting and per-domain concurrency controls.
- Add pagination or schedule incremental runs that only crawl updated sitemap entries (uses sitemap <lastmod>).
- Add an API endpoint wrapper that serves Key-Value JSON objects (deploy a small webserver inside the Actor run).

If you'd like, I can implement any of those next steps now.