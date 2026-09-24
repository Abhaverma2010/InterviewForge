// Sliding-window limiter: at most `requestsPerMinute` calls to acquire() may
// return within any 60-second window. Callers queue up in order.
export function createRateLimiter({ requestsPerMinute, sleep, now = Date.now }) {
  const windowMs = 60_000;
  const recent = []; // timestamps of the calls inside the current window
  let queue = Promise.resolve();

  function acquire() {
    // Chain onto the queue so concurrent callers take turns.
    const turn = queue.then(async () => {
      for (;;) {
        const t = now();
        while (recent.length && t - recent[0] >= windowMs) recent.shift();
        if (recent.length < requestsPerMinute) {
          recent.push(t);
          return;
        }
        await sleep(windowMs - (t - recent[0]));
      }
    });
    queue = turn.catch(() => {});
    return turn;
  }

  return { acquire };
}
