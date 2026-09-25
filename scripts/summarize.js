// Prints a readable summary of an evaluate output file, to check kit quality
// at a glance. Usage: npm run summarize -- kits.json
import { readFile } from 'node:fs/promises';
import { validateKit } from '@interviewforge/core';

const file = process.argv[2] ?? 'kits.json';
const { kits } = JSON.parse(await readFile(file, 'utf8'));

for (const entry of kits) {
  console.log(`\n━━ ${entry.id}: ${entry.status.toUpperCase()}`);
  if (entry.status !== 'ok') {
    console.log(`   ${entry.error.code}: ${entry.error.message}`);
    continue;
  }
  const kit = entry.kit;
  const check = validateKit(kit);
  console.log(`   valid Appendix A kit: ${check.ok ? 'yes' : `NO, ${check.errors[0]}`}`);
  console.log(`   ${kit.role.title} at ${kit.source.company} (${kit.role.seniority})`);

  const brief = kit.company_brief;
  console.log(`\n   Company brief (${brief.found ? 'from the site' : 'nothing found'}):`);
  console.log(`   ${brief.summary}`);
  const hp = brief.hiring_process;
  console.log(`   Hiring page: ${brief.research.hiring_page ?? 'none found'}`);
  console.log(
    `   Interview stages: ${hp.found ? hp.stages.map((s) => s.name).join(' → ') : 'none found'}`,
  );
  console.log(`   Public discussion: ${brief.research.discussion.results.length} thread(s)`);

  console.log(`\n   Requirements${kit.role.thin ? ' (THIN posting)' : ''}:`);
  for (const r of kit.role.requirements) {
    const count = kit.questions.filter((q) => q.requirement_ids.includes(r.id)).length;
    console.log(`   ${r.id.padEnd(4)}[${r.priority}/${r.kind}] ${r.text} — ${count} question(s)`);
  }
  for (const d of kit.role.dropped_requirements) console.log(`   dropped: ${d.text}`);

  const byCategory = {};
  for (const q of kit.questions) byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
  console.log(
    `\n   Questions: ${kit.questions.length} (${Object.entries(byCategory)
      .map(([c, n]) => `${c} ${n}`)
      .join(', ')})`,
  );
  const templates = kit.questions.filter((q) => q.origin === 'template').length;
  console.log(
    `   Coverage: ${kit.coverage.passes} pass(es), uncovered [${kit.coverage.uncovered_requirement_ids.join(', ')}]` +
      (templates ? `, ${templates} template question(s)` : ''),
  );
  for (const h of kit.coverage.history) {
    console.log(`     pass ${h.pass}: uncovered [${h.uncovered_requirement_ids.join(', ')}]`);
  }
  console.log(`   Flashcards: ${kit.flashcards.length}`);
  const minutes = kit.schedule.days.reduce((t, d) => t + d.minutes, 0);
  console.log(`   Schedule: ${kit.schedule.days.length} day(s), ${minutes} minutes in total`);
  for (const d of kit.schedule.days.slice(0, 3)) {
    console.log(
      `     day ${d.day}: ${d.focus} — ${d.question_ids.length} question(s), ${d.minutes} min`,
    );
  }
  if (kit.meta.warnings.length)
    console.log(`\n   Warnings:\n${kit.meta.warnings.map((w) => `   - ${w}`).join('\n')}`);
  const sample = kit.questions[0];
  if (sample)
    console.log(
      `\n   Sample question (${sample.category}, difficulty ${sample.difficulty}):\n   "${sample.prompt}"`,
    );
}
