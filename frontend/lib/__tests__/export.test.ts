import { fetchExport, saveExport } from "../export";

function installFetch(
  implementation: (...args: unknown[]) => Promise<unknown>,
): jest.Mock {
  const mock = jest.fn(implementation);
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function fakeResponse(body: string, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([body], { type: "text/csv" }),
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
  };
}

describe("export download helper", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  it("retries once after a timeout and reports the retry (U8-06)", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "AbortError" });
    let calls = 0;
    const fetchMock = installFetch(async () => {
      calls += 1;
      if (calls === 1) {
        throw timeout;
      }
      return fakeResponse("a,b\n1,2\n", { "X-AWAP-Export-Truncated": "true" });
    });
    const onRetry = jest.fn();

    const result = await fetchExport({
      url: "http://api.test/export",
      timeoutMs: 50,
      onRetry,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1);
    expect(result.usedRetry).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("does not retry an HTTP failure", async () => {
    const fetchMock = installFetch(async () => ({
      ok: false,
      status: 500,
      blob: async () => new Blob([]),
      headers: { get: () => null },
    }));

    await expect(fetchExport({ url: "http://api.test/export" })).rejects.toThrow(
      "Export failed with status 500",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves the blob once and revokes the object URL", () => {
    const createObjectURL = jest.fn(() => "blob:test");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    saveExport(new Blob(["x"]), "awap.csv");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
