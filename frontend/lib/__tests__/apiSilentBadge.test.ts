import { fetchUnreadNotificationCountSilent } from "../api";

describe("fetchUnreadNotificationCountSilent", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the count without touching the auth pipeline", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ count: 4 }),
    })) as unknown as typeof fetch;
    await expect(fetchUnreadNotificationCountSilent()).resolves.toEqual({ count: 4 });
  });

  it("returns null on a 401 instead of refreshing or redirecting", async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(fetchUnreadNotificationCountSilent()).resolves.toBeNull();
  });

  it("returns null on a network failure", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(fetchUnreadNotificationCountSilent()).resolves.toBeNull();
  });
});
