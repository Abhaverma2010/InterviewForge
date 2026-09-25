// Runs the research steps on one job description and prints what they found:
// requirement extraction, the company crawl and the public-discussion search.
// Usage: npm run research -- examples/posthog-product-engineer.txt https://posthog.com
import './load-env.js';
import { readFileSync } from 'node:fs';
import {
  crawlCompany,
  createCrawlerDeps,
  createLLMClientFromEnv,
  extractRequirements,
  guessCompanyName,
  searchPublicDiscussion,
} from '@interviewforge/core';

const [jdPath, companyUrl] = process.argv.slice(2);
if (!jdPath || !companyUrl) {
  console.error('Usage: npm run research -- <job-description.txt> <company-url>');
  process.exitCode = 1;
} else {
  const jd = readFileSync(jdPath, 'utf8');
  const deps = createCrawlerDeps({ allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true' });

  console.log('1. Extracting requirements...');
  const role = await extractRequirements(jd, { llm: createLLMClientFromEnv() });
  console.log(`   ${role.title ?? '(no title)'} at ${role.company ?? '(company not named)'}`);
  console.log(`   seniority: ${role.seniority ?? '-'}, location: ${role.location ?? '-'}`);
  for (const r of role.requirements) {
    console.log(
      `   ${r.id} [${r.priority}/${r.kind}] ${r.text}   (priority from ${r.priority_source})`,
    );
  }
  for (const d of role.dropped) console.log(`   dropped: ${d.text} — ${d.reason}`);
  for (const n of role.notes) console.log(`   note: ${n}`);

  console.log('\n2. Crawling the company site...');
  const crawl = await crawlCompany(companyUrl, deps);
  console.log(`   reachable: ${crawl.reachable}, hiring page: ${crawl.hiringPage ?? 'none'}`);

  const home = crawl.pages[0];
  const company = guessCompanyName({
    fromJd: role.company,
    siteName: home?.siteName,
    title: home?.title,
    url: companyUrl,
  });

  console.log(`\n3. Searching public discussion for "${company}"...`);
  const discussion = await searchPublicDiscussion(company, deps);
  if (discussion.error) console.log(`   search failed: ${discussion.error.code}`);
  if (!discussion.results.length) console.log('   nothing found');
  for (const d of discussion.results)
    console.log(`   - ${d.title}\n     ${d.url}\n     ${d.excerpt.slice(0, 160)}`);
}
