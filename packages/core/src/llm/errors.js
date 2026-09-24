// A failure talking to the model. `code` is stable and machine-readable so the
// API and the batch evaluator can report it; `message` is for humans.
export class LLMError extends Error {
  constructor(code, message, { status, body, cause } = {}) {
    super(message, { cause });
    this.name = 'LLMError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}
