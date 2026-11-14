import { newIdempotencyKey, resolveIntentKey } from "../copilotIdempotency";

describe("copilot idempotency keys", () => {
  it("reuses the key when the same intent is retried", () => {
    const first = resolveIntentKey(null, "start leave", () => "key-1");
    const retry = resolveIntentKey(first, "start leave", () => "key-2");

    expect(retry).toBe(first);
    expect(retry.key).toBe("key-1");
  });

  it("rotates the key when the request text changes", () => {
    const first = resolveIntentKey(null, "start leave", () => "key-1");
    const next = resolveIntentKey(first, "start expense", () => "key-2");

    expect(next.key).toBe("key-2");
    expect(next.message).toBe("start expense");
  });

  it("generates a fresh key for the first intent", () => {
    const intent = resolveIntentKey(null, "hello", () => "key-1");
    expect(intent).toEqual({ message: "hello", key: "key-1" });
  });

  it("generates a stable, non-empty key by default", () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
