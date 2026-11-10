/** Reads a server-sent event stream and yields each JSON `data:` payload. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // skip malformed lines
      }
    }
  }
}

/**
 * Blackthorn delivers text in large sealed blocks a few seconds apart. This
 * reveals the reply at the measured generation speed instead of block by block.
 */
export function createReveal(signal: AbortSignal, onShow: (text: string) => void) {
  const startedAt = performance.now();
  let received = "";
  let shown = 0;
  let rate = 0; // characters per second
  let finished = false;
  let done: () => void = () => {};
  const drained = new Promise<void>((resolve) => (done = resolve));

  let last = performance.now();
  let carry = 0;
  // A timer rather than animation frames, so a background tab still finishes.
  const timer = setInterval(() => {
    const now = performance.now();
    const backlog = received.length - shown;
    if (signal.aborted || (finished && backlog === 0)) {
      clearInterval(timer);
      return done();
    }
    if (backlog > 0) {
      carry += rate * ((now - last) / 1000);
      const step = Math.min(backlog, Math.floor(carry));
      if (step > 0) {
        carry -= step;
        shown += step;
        onShow(received.slice(0, shown));
      }
    } else {
      carry = 0;
    }
    last = now;
  }, 30);

  return {
    push(delta: string) {
      received += delta;
      const seconds = (performance.now() - startedAt) / 1000;
      rate = Math.min(2000, Math.max(40, received.length / seconds));
    },
    /** Everything has arrived: speed up a little, but keep the flow even. */
    finish() {
      rate = Math.max(rate, Math.min((received.length - shown) / 1.5, rate * 1.6));
      finished = true;
      return drained;
    },
    received: () => received,
    shown: () => received.slice(0, shown),
  };
}
