import { ApiError, login, parseRetryAfter } from "../api";

function fakeResponse(status: number, headers: Record<string, string> = {}, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe("login security", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps 401/403/404 to the same enumeration-safe message", async () => {
    for (const status of [401, 403, 404]) {
      global.fetch = jest.fn(async () =>
        fakeResponse(status, { "x-correlation-id": "corr-1" }),
      ) as unknown as typeof fetch;
      await expect(login("acme", "ada@acme.com", "wrong")).rejects.toMatchObject({
        status,
        message: "Email or password is incorrect.",
        correlationId: "corr-1",
      });
    }
  });

  it("keeps Retry-After on a 429 response", async () => {
    global.fetch = jest.fn(async () =>
      fakeResponse(429, { "retry-after": "12" }),
    ) as unknown as typeof fetch;
    await expect(login("acme", "ada@acme.com", "wrong")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 12,
    });
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter(fakeResponse(429, { "retry-after": "7" }))).toBe(7);
    const future = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(fakeResponse(429, { "retry-after": future }))).toBeGreaterThan(0);
    expect(parseRetryAfter(fakeResponse(429))).toBeUndefined();
  });

  it("carries the retry hint on ApiError", () => {
    const error = new ApiError(429, "slow down", "corr", 5);
    expect(error.retryAfterSeconds).toBe(5);
  });
});
