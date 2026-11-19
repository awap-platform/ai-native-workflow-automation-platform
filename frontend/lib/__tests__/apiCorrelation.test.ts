import { ApiError, correlationHeader, correlationIdOf, errorStatus } from "../api";

describe("API correlation IDs", () => {
  it("carries a correlation ID on ApiError", () => {
    const error = new ApiError(500, "boom", "corr-123");
    expect(error.status).toBe(500);
    expect(error.correlationId).toBe("corr-123");
    expect(correlationIdOf(error)).toBe("corr-123");
    expect(errorStatus(error)).toBe(500);
  });

  it("returns undefined for non-API errors", () => {
    expect(correlationIdOf(new Error("boom"))).toBeUndefined();
    expect(correlationIdOf(null)).toBeUndefined();
  });

  it("reads the response header case-insensitively", () => {
    const response = {
      headers: {
        get: (name: string) => (name.toLowerCase() === "x-correlation-id" ? "corr-456" : null),
      },
    } as unknown as Response;
    expect(correlationHeader(response)).toBe("corr-456");
    const empty = {
      headers: { get: () => null },
    } as unknown as Response;
    expect(correlationHeader(empty)).toBeUndefined();
  });
});
