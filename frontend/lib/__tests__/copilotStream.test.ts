import { parseSseFrames, readCopilotStream, reduceStream } from "../copilotStream";

function encode(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

function frame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  // jsdom does not expose ReadableStream; the reader only needs read() and releaseLock().
  const queue = chunks.map(encode);
  return {
    getReader() {
      return {
        read: async () =>
          queue.length > 0
            ? { value: queue.shift() as Uint8Array, done: false }
            : { value: undefined, done: true },
        releaseLock: () => undefined,
      };
    },
  } as unknown as ReadableStream<Uint8Array>;
}

describe("parseSseFrames", () => {
  it("parses every event type of the versioned contract", () => {
    const buffer = [
      frame({ v: 1, type: "token", seq: 1, delta: "he" }),
      frame({ v: 1, type: "token", seq: 2, delta: "llo" }),
      frame({ v: 1, type: "tool", seq: 3, call: { name: "search" } }),
      frame({ v: 1, type: "citation", seq: 4, citation: { documentId: "doc-1" } }),
      frame({ v: 1, type: "usage", seq: 5, model: "heuristic", budget: {} }),
      frame({ v: 1, type: "done", seq: 6, response: { answer: "hello" } }),
    ].join("");

    const parsed = parseSseFrames(buffer);

    expect(parsed.events.map((event) => event.type)).toEqual([
      "token",
      "token",
      "tool",
      "citation",
      "usage",
      "done",
    ]);
    expect(parsed.rest).toBe("");
  });

  it("keeps an incomplete trailing frame for the next chunk", () => {
    const parsed = parseSseFrames(frame({ v: 1, type: "token", seq: 1, delta: "a" }).slice(0, 20));

    expect(parsed.events).toHaveLength(0);
    expect(parsed.rest.length).toBeGreaterThan(0);
  });

  it("drops a malformed frame instead of failing the answer", () => {
    const parsed = parseSseFrames("data: not-json\n\n" + frame({ v: 1, type: "token", seq: 1 }));

    expect(parsed.events).toHaveLength(1);
  });

  it("tolerates CRLF terminators and non-data lines", () => {
    const parsed = parseSseFrames(': keep-alive\r\ndata:{"v":1,"type":"token","seq":1}\r\n\r\n');

    expect(parsed.events).toHaveLength(1);
  });
});

describe("reduceStream", () => {
  const initial = { text: "", lastSeq: 0, done: null, error: null, outOfOrder: false };

  it("concatenates exactly the deltas it received", () => {
    const afterFirst = reduceStream(initial, { v: 1, type: "token", seq: 1, delta: "le" });
    const afterSecond = reduceStream(afterFirst, { v: 1, type: "token", seq: 2, delta: "ave" });

    expect(afterSecond.text).toBe("leave");
  });

  it("captures the authoritative response from the done event", () => {
    const state = reduceStream(initial, {
      v: 1,
      type: "done",
      seq: 2,
      response: { answer: "leave" } as never,
    });

    expect(state.done).toEqual({ answer: "leave" });
  });

  it("records an error frame", () => {
    const state = reduceStream(initial, {
      v: 1,
      type: "error",
      seq: 2,
      message: "provider dropped",
    });

    expect(state.error).toBe("provider dropped");
  });

  it("flags an out-of-order frame and keeps the earlier text", () => {
    const afterFirst = reduceStream(initial, { v: 1, type: "token", seq: 2, delta: "a" });
    const stale = reduceStream(afterFirst, { v: 1, type: "token", seq: 1, delta: "b" });

    expect(stale.outOfOrder).toBe(true);
    expect(stale.text).toBe("a");
  });
});

describe("readCopilotStream", () => {
  it("reports the first delta once and the full text at the end", async () => {
    const seen: string[] = [];
    let firstDelta = 0;
    const body = streamOf([
      frame({ v: 1, type: "token", seq: 1, delta: "Hel" }),
      frame({ v: 1, type: "token", seq: 2, delta: "lo" }),
      frame({ v: 1, type: "done", seq: 3, response: { answer: "Hello" } }),
    ]);

    const result = await readCopilotStream(body, {
      onFirstDelta: () => {
        firstDelta += 1;
      },
      onText: (text) => seen.push(text),
    });

    expect(firstDelta).toBe(1);
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(result.text).toBe("Hello");
    expect(result.response).toEqual({ answer: "Hello" });
  });

  it("surfaces a mid-stream error without pretending the answer is complete", async () => {
    const body = streamOf([
      frame({ v: 1, type: "token", seq: 1, delta: "partial" }),
      frame({ v: 1, type: "error", seq: 2, message: "provider dropped" }),
    ]);

    const result = await readCopilotStream(body, {});

    expect(result.text).toBe("partial");
    expect(result.response).toBeNull();
    expect(result.error).toBe("provider dropped");
  });

  it("stops reading when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = streamOf([frame({ v: 1, type: "token", seq: 1, delta: "x" })]);

    const result = await readCopilotStream(body, { signal: controller.signal });

    expect(result.text).toBe("x");
  });

  it("flags out-of-order frames and never duplicates text", async () => {
    const body = streamOf([
      frame({ v: 1, type: "token", seq: 2, delta: "second" }),
      frame({ v: 1, type: "token", seq: 1, delta: "first" }),
    ]);

    const result = await readCopilotStream(body, {});

    expect(result.text).toBe("second");
    expect(result.outOfOrder).toBe(true);
  });
});
