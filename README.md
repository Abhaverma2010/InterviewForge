# InterviewForge

Paste a job description, give the company's website and the number of days
until the interview. InterviewForge researches the company, extracts the
role's requirements and builds a prep kit: company brief, role breakdown,
question bank, flashcards and a day-by-day study schedule. You can edit
the kit and practise against it.

> Work in progress. The sections below will be filled in as the project is built.

## Tech stack

| Layer    | Choice                                      |
|----------|---------------------------------------------|
| Frontend | Next.js + Tailwind CSS                      |
| Backend  | Node.js + Express                           |
| Database | MongoDB                                     |
| Language | JavaScript (ES modules)                     |
| LLM      | Google Gemini Flash (free tier) via its OpenAI-compatible endpoint |

## Repository layout

```
packages/core   pipeline: retrieval, extraction, generation, scheduling, validation
apps/api        Express API (auth, kits, generation jobs)
apps/web        Next.js frontend
scripts/        batch entry point (npm run evaluate)
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in LLM_API_KEY
npm run dev:api
```
