// End-to-end test of the batch entry point: runs `node scripts/evaluate.js` as a
// separate process against a fake model server and fake company sites, and
// checks the output file against Appendix B.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateKit } from '@interviewforge/core';
import { startFakeLlmServer } from '../packages/core/test/helpers/fake-llm.js';
import { page, startSite } from '../packages/core/test/helpers/site-server.js';

const run = promisify(execFile);
let llm;
let site;
let dir;

before(async () => {
  llm = await startFakeLlmServer();
  site = await startSite({
    '/acme/': page(
      'Acme',
      '<main><p>Acme builds rockets for satellite firms worldwide.</p><a href="jobs/">Jobs</a></main>',
    ),
    '/acme/jobs/': page(
      'Jobs',
      '<main><p>Our hiring process: a take-home, then a technical interview.</p></main>',
    ),
    '/search': { type: 'application/json', body: '{"hits":[]}' },
  });
  dir = await mkdtemp(join(tmpdir(), 'evaluate-'));
});
after(async () => {
  await llm.close();
  await site.close();
  await rm(dir, { recursive: true, force: true });
});

test('npm run evaluate writes one Appendix B entry per case and survives failures', async () => {
  const cases = [
    {
      id: 'case-01',
      jd: 'Senior Backend Engineer\n\nRequirements\n- 5+ years with Go\n- Strong SQL skills\n- Clear written communication',
      company_url: `${site.origin}/acme/`,
      days: 5,
    },
    {
      id: 'case-02',
      jd: 'Frontend developer needed.\nReact.',
      company_url: `${site.origin}/nothing-here/`,
      days: 1,
    },
    { id: 'case-03', jd: 'Backend Engineer\n- Go', company_url: 'http://127.0.0.1:1/', days: 60 },
    { id: 'case-04', jd: 'Engineer\n- Go', company_url: `${site.origin}/acme/`, days: 0 },
  ];
  const input = join(dir, 'cases.json');
  const output = join(dir, 'kits.json');
  await writeFile(input, JSON.stringify(cases));

  await run('node', ['scripts/evaluate.js', '--input', input, '--output', output], {
    env: {
      ...process.env,
      LLM_BASE_URL: llm.baseUrl,
      LLM_API_KEY: 'test',
      LLM_MODEL: 'fake',
      LLM_REQUESTS_PER_MINUTE: '1000',
      DISCUSSION_SEARCH_URL: `${site.origin}/search`,
    },
    timeout: 120_000,
  });

  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.version, '1.0');
  assert.match(result.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  const byId = Object.fromEntries(result.kits.map((k) => [k.id, k]));
  assert.deepEqual(Object.keys(byId).sort(), ['case-01', 'case-02', 'case-03', 'case-04']);

  // Researched normally.
  assert.equal(byId['case-01'].status, 'ok');
  assert.equal(byId['case-01'].error, null);
  assert.deepEqual(validateKit(byId['case-01'].kit), { ok: true });
  assert.equal(byId['case-01'].kit.schedule.days.length, 5);
  assert.equal(byId['case-01'].kit.company_brief.hiring_process.found, true);

  // Partially researched cases are still ok, with the gaps recorded.
  assert.equal(byId['case-02'].status, 'ok');
  assert.equal(byId['case-02'].kit.role.thin, true);
  assert.equal(byId['case-02'].kit.schedule.days.length, 1);
  assert.equal(byId['case-03'].status, 'ok');
  assert.equal(byId['case-03'].kit.company_brief.found, false);
  assert.equal(byId['case-03'].kit.schedule.days.length, 60);

  // A case we cannot build a kit for is failed, and the run carried on.
  assert.equal(byId['case-04'].status, 'failed');
  assert.equal(byId['case-04'].kit, null);
  assert.equal(byId['case-04'].error.code, 'INVALID_INPUT');
});
