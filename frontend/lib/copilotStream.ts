import type { CopilotResponseDto } from "./api";

/** Schema version of the streamed answer frames (issue #374). */
export const STREAM_SCHEMA_VERSION = 1;

export type StreamEventType = "token" | "tool" | "citation" | "usage" | "done" | "error";

export interface StreamEvent {
  v: number;
  type: StreamEventType;
  seq: number;
  delta?: string;
  call?: unknown;
  citation?: unknown;
  model?: string | null;
  budget?: unknown;
  response?: CopilotResponseDto;
  message?: string;
}

export interface ParsedFrames {
  events: StreamEvent[];
  /** Incomplete trailing frame, kept for the next chunk. */
  rest: string;
}

/** Splits the buffer into complete `data:` frames and keeps the partial tail. */
export function parseSseFrames(buffer: string): ParsedFrames {
  const events: StreamEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const payload = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!payload) {
      continue;
    }
    try {
      const event = JSON.parse(payload) as StreamEvent;
      if (typeof event?.type === "string" && typeof event?.seq === "number") {
        events.push(event);
      }
    } catch {
      // A malformed frame is dropped instead of breaking the whole answer.
    }
  }
  return { events, rest };
}

export interface StreamState {
  text: string;
  lastSeq: number;
  done: CopilotResponseDto | null;
  error: string | null;
  outOfOrder: boolean;
}

/** Folds one frame into the stream state; sequence numbers must increase. */
export function reduceStream(state: StreamState, event: StreamEvent): StreamState {
  if (event.seq <= state.lastSeq) {
    return { ...state, outOfOrder: true };
  }
  const base: StreamState = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case "token":
      return { ...base, text: state.text + (event.delta ?? "") };
    case "done":
      return { ...base, done: event.response ?? null };
    case "error":
      return { ...base, error: event.message ?? "The answer stream was interrupted." };
    default:
      return base;
  }
}

/**
 * UTF-8 decoder with a byte-wise fallback, so the loop also runs in environments without
 * `TextDecoder` (older test harnesses). Browsers always take the first branch.
 */
function createDecoder(): (chunk: Uint8Array) => string {
  if (typeof TextDecoder !== "undefined") {
    const decoder = new TextDecoder();
    return (chunk) => decoder.decode(chunk, { stream: true });
  }
  return (chunk) => Array.from(chunk, (byte) => String.fromCharCode(byte)).join("");
}

export interface StreamLoopResult {
  text: string;
  response: CopilotResponseDto | null;
  error: string | null;
  outOfOrder: boolean;
}

/**
 * Reads the body of an open SSE response and folds it into one answer.
 *
 * <p>The first delta is reported through {@link onFirstDelta} so the caller can record the real
 * time-to-first-token instead of measuring an animation tick. Aborting the signal stops the read,
 * which closes the connection and cancels the provider request.
 */
export async function readCopilotStream(
  body: ReadableStream<Uint8Array>,
  options: {
    onFirstDelta?: () => void;
    onText?: (text: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<StreamLoopResult> {
  const reader = body.getReader();
  const decode = createDecoder();
  let state: StreamState = { text: "", lastSeq: 0, done: null, error: null, outOfOrder: false };
  let buffer = "";
  let sawDelta = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decode(value);
      const parsed = parseSseFrames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        const next = reduceStream(state, event);
        if (next.outOfOrder) {
          // Sequence numbers are the ordering contract; an out-of-order frame is ignored.
          state = { ...state, outOfOrder: true };
          continue;
        }
        const grew = next.text.length > state.text.length;
        state = next;
        if (grew) {
          if (!sawDelta) {
            sawDelta = true;
            options.onFirstDelta?.();
          }
          options.onText?.(state.text);
        }
      }
      if (options.signal?.aborted) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: state.text,
    response: state.done,
    error: state.error,
    outOfOrder: state.outOfOrder,
  };
}
