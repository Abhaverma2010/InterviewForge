// 1. The job description we want the AI to read
const jd = `Frontend Developer
Required: 3+ years of React. Strong CSS skills.
Bonus: experience with Next.js.`;

// 2. Send it to Gemini. fetch() is how JavaScript makes a web request.
const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.LLM_API_KEY}`, // your key = your ID card
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: process.env.LLM_MODEL,
    temperature: 0.2,                          // low = less random, more consistent
    response_format: { type: 'json_object' },  // "please answer in JSON"
    messages: [
      // "system" = the rules we give the AI
      { role: 'system', content:
        'List the requirements in this job description as JSON: ' +
        '{"requirements":[{"text":"","priority":"must or nice","evidence":"exact quote from the text"}]}. ' +
        'Only include things the text actually says.' },
      // "user" = the actual input
      { role: 'user', content: jd },
    ],
  }),
});

// 3. If something went wrong, show why and stop
if (!res.ok) {
  console.log('Error', res.status, await res.text());
  process.exit(1);
}

// 4. Dig out the AI's answer and print it nicely
const data = await res.json();
const answer = JSON.parse(data.choices[0].message.content);
console.log(JSON.stringify(answer, null, 2));