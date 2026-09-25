// A scripted stand-in for the model, so pipeline tests run offline, fast and
// deterministically. It answers each kind of request the way a real model
// roughly would, recognising the request by its system prompt.
//
// Options let a test make it misbehave:
//   firstDraftCoversOnlyFirst  the first technical draft cites only the first
//                              requirement, leaving gaps for the coverage pass
//   gapFillWorks               whether coverage-pass requests are answered
//   failOn                     request kinds that throw (e.g. ['extract'])

import http from 'node:http';

export function createFakeLlm({
  firstDraftCoversOnlyFirst = true,
  gapFillWorks = true,
  failOn = [],
} = {}) {
  const calls = [];

  function answer(system, user) {
    const kind = kindOf(system);
    calls.push(kind);
    if (failOn.includes(kind)) {
      throw Object.assign(new Error(`fake ${kind} failure`), { code: 'LLM_UNAVAILABLE' });
    }

    switch (kind) {
      case 'extract':
        return extraction(user);
      case 'brief':
        return {
          summary: 'Acme builds reusable rockets.',
          what_they_do: 'Sells launch services to satellite companies.',
          source_urls: [...user.matchAll(/url="([^"]+)"/g)].map((m) => m[1]).slice(0, 1),
          found_enough: true,
        };
      case 'hiring':
        return /take-home/i.test(user)
          ? {
              stages: [
                { name: 'Take-home exercise', type: 'take-home', description: 'A small API.' },
                { name: 'System design', type: 'system-design', description: 'Design a service.' },
              ],
              notes: [],
            }
          : { stages: [], notes: [] };
      case 'flashcards':
        return {
          flashcards: citable(user).map((r) => ({
            front: `What matters most about ${r.text}?`,
            back: 'Key points.',
            requirement_ids: [r.id],
          })),
        };
      default:
        return questions(kind, system, user);
    }
  }

  function questions(category, system, user) {
    const reqs = citable(user);
    const gapFill = /exactly one question for EACH/.test(system);
    if (gapFill && !gapFillWorks) return { questions: [] };
    if (gapFill) {
      return {
        questions: reqs.map((r) => ({
          requirement_ids: [r.id],
          prompt: `Gap question about ${r.text}?`,
          answer_outline: '- point',
          difficulty: 2,
        })),
      };
    }
    const cited =
      firstDraftCoversOnlyFirst && (category === 'technical' || category === 'system-design')
        ? reqs.slice(0, 1)
        : reqs;
    const list = cited.length
      ? cited.map((r, i) => ({
          requirement_ids: [r.id],
          prompt: `${category} question ${i + 1} about ${r.text}?`,
          answer_outline: '- point one\n- point two',
          difficulty: (i % 3) + 1,
        }))
      : [
          {
            requirement_ids: [],
            prompt: `General ${category} question?`,
            answer_outline: '- x',
            difficulty: 1,
          },
        ];
    return { questions: list };
  }

  return {
    calls,
    answer,
    async chatJson({ system, user, schema }) {
      const value = answer(system, user);
      return schema ? schema.parse(value) : value;
    },
  };
}

/** Serves the fake as an OpenAI-compatible HTTP endpoint, for end-to-end tests. */
export async function startFakeLlmServer(options) {
  const fake = createFakeLlm(options);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'models/fake' }] }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body);
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.findLast((m) => m.role === 'user')?.content ?? '';
    try {
      const content = JSON.stringify(fake.answer(system, user));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"fake outage"}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    fake,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

function kindOf(system) {
  if (/extract structured facts/i.test(system)) return 'extract';
  if (/company brief/i.test(system)) return 'brief';
  if (/interview process for a candidate/i.test(system)) return 'hiring';
  if (/flashcards/i.test(system)) return 'flashcards';
  if (/technical interview questions/i.test(system)) return 'technical';
  if (/behavioural interview questions/i.test(system)) return 'behavioural';
  if (/system design interview questions/i.test(system)) return 'system-design';
  if (/company fit/i.test(system)) return 'company-fit';
  return 'unknown';
}

// A "model" that reads bullet points and "Label: value" lines as requirements.
function extraction(user) {
  const jd = user.replace(/<\/?job_description>/g, '').trim();
  const lines = jd.split('\n').map((l) => l.trim());
  const requirements = lines
    .filter((l) => l.startsWith('- ') && !/^- (Design|Build|Own|Run)\b/.test(l))
    .map((l) => l.slice(2))
    .concat(lines.length <= 3 ? lines.slice(1).filter(Boolean) : [])
    .map((text) => ({
      text: text.replace(/\.$/, ''),
      evidence: text,
      kind: /communicat|mentor|collaborat|lead/i.test(text) ? 'behavioural' : 'technical',
      priority: 'must',
    }));
  return {
    company: null,
    title: lines[0] || null,
    seniority: /senior/i.test(lines[0]) ? 'senior' : null,
    location: null,
    responsibilities: lines
      .filter((l) => /^- (Design|Build|Own|Run)\b/.test(l))
      .map((l) => l.slice(2)),
    requirements,
  };
}

// "- r1 [must] text" lines from the "Requirements you may cite" section.
function citable(user) {
  return [...user.matchAll(/^- (r\d+) \[(must|nice)\] (.+)$/gm)].map((m) => ({
    id: m[1],
    priority: m[2],
    text: m[3],
  }));
}
