// Crawls one or more company sites and prints what was found.
// Usage: npm run crawl -- https://posthog.com https://about.gitlab.com
import { createCrawlerDeps, crawlCompany } from '@interviewforge/core';

const urls = process.argv.slice(2);
if (!urls.length) {
  console.error('Usage: npm run crawl -- <company-url> [more urls...]');
  process.exitCode = 1;
}

const deps = createCrawlerDeps({ allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true' });
for (const url of urls) {
  const result = await crawlCompany(url, deps, {
    onEvent: (e) => e.type === 'fetch' && console.log(`  fetching ${e.url}`),
  });
  console.log(`\n${url}`);
  console.log(`  reachable: ${result.reachable}${result.error ? ` (${result.error.code})` : ''}`);
  console.log(`  hiring page: ${result.hiringPage ?? 'none found'}`);
  console.log(`  about page:  ${result.aboutPage ?? 'none found'}`);
  for (const p of result.pages) {
    const notes = [`${p.text.length} chars`, `${p.hiringSignals} hiring signals`];
    if (p.truncated) notes.push('truncated');
    console.log(`  [${p.kind}] ${p.url} — ${notes.join(', ')}`);
  }
  for (const s of result.skipped) console.log(`  skipped ${s.code}: ${s.url}`);
}
