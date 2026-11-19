import {
  SESSION_EXPIRY_COOKIE,
  clearSessionExpiry,
  getSessionExpiry,
  setSessionExpiry,
} from "../auth";

describe("session expiry cookie", () => {
  beforeEach(() => {
    document.cookie = `${SESSION_EXPIRY_COOKIE}=; path=/; max-age=0`;
  });

  it("stores an absolute expiry and clears it", () => {
    const before = Date.now();
    setSessionExpiry(60);
    const expiry = getSessionExpiry();
    expect(expiry).not.toBeNull();
    expect(expiry ?? 0).toBeGreaterThanOrEqual(before + 59_000);

    clearSessionExpiry();
    expect(getSessionExpiry()).toBeNull();
  });

  it("clears immediately for a non-positive expiry", () => {
    setSessionExpiry(60);
    setSessionExpiry(0);
    expect(getSessionExpiry()).toBeNull();
  });
});
