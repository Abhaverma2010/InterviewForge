// Public entry point of the pipeline. Both the Express API and
// scripts/evaluate.js import from here, so there is one implementation.
export { createLLMClient, createLLMClientFromEnv } from './llm/client.js';
export { LLMError } from './llm/errors.js';
export * from './retrieval/index.js';
export { extractRequirements } from './extraction/requirements.js';
export { buildSchedule } from './scheduling/schedule.js';
export { findCoverageGaps } from './coverage/coverage.js';
export { kitSchema, validateKit } from './validation/kit-schema.js';
export {
  PipelineError,
  planCategories,
  runPipeline,
  validatePipelineInput,
} from './pipeline/run-pipeline.js';
