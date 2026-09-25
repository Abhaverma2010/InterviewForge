// Lists the chat models your API key can use, to pick LLM_MODEL and
// LLM_FALLBACK_MODEL. Usage: npm run models
import './load-env.js';

const { LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey } = process.env;
if (!baseUrl || !apiKey) {
  console.error('Set LLM_BASE_URL and LLM_API_KEY in .env first (npm run setup).');
  process.exitCode = 1;
} else {
  const res = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exitCode = 1;
  } else {
    const { data = [] } = await res.json();
    const ids = data.map((m) => m.id.replace(/^models\//, '')).sort();
    const chat = ids.filter(
      (id) =>
        /flash|pro|gpt|llama|qwen|mistral/i.test(id) && !/embed|tts|image|audio|live/i.test(id),
    );
    console.log(`Current LLM_MODEL: ${process.env.LLM_MODEL}`);
    console.log(`Current LLM_FALLBACK_MODEL: ${process.env.LLM_FALLBACK_MODEL || '(none)'}\n`);
    console.log('Chat models available to this key:');
    for (const id of chat) console.log(`  ${id}`);
  }
}
