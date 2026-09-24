// One-time local setup: creates a correct .env from .env.example,
// asks for the LLM API key, and checks that the key works.
// Run with: npm run setup
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const EXAMPLE = '.env.example';
const TARGET = '.env';

// Windows sometimes saves ".env" as ".env.txt" — move it out of the way.
if (existsSync('.env.txt')) {
  renameSync('.env.txt', '.env.txt.old');
  console.log('Found .env.txt (wrong name) and renamed it to .env.txt.old');
}
if (existsSync(TARGET)) {
  renameSync(TARGET, '.env.backup');
  console.log('Existing .env backed up to .env.backup');
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const key = (await rl.question('Paste your Gemini API key and press Enter: ')).trim();
rl.close();

if (!key) {
  console.error('No key entered. Get one at https://aistudio.google.com/apikey and run npm run setup again.');
  process.exit(1);
}

const contents = readFileSync(EXAMPLE, 'utf8').replace(/^LLM_API_KEY=.*$/m, `LLM_API_KEY=${key}`);
// Always UTF-8: Node cannot read the UTF-16 files PowerShell's ">" produces.
writeFileSync(TARGET, contents, 'utf8');
console.log('Wrote .env');

const baseUrl = contents.match(/^LLM_BASE_URL=(.*)$/m)[1].trim();
const model = contents.match(/^LLM_MODEL=(.*)$/m)[1].trim();

process.stdout.write('Testing the key... ');
const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.log(`FAILED (HTTP ${res.status})`);
  console.log((await res.text()).slice(0, 500));
  process.exit(1);
}

const { data = [] } = await res.json();
const ids = data.map((m) => m.id.replace(/^models\//, ''));
console.log('OK');
if (ids.length && !ids.includes(model)) {
  const flash = ids.filter((id) => id.includes('flash')).slice(0, 8);
  console.log(`Warning: model "${model}" is not available to this key.`);
  console.log(`Set LLM_MODEL in .env to one of: ${flash.join(', ')}`);
} else {
  console.log(`Model "${model}" is available. You're ready: node --env-file=.env scripts/hello-llm.js`);
}
