import {
  formatRemaining,
  SESSION_WARNING_MS,
  sessionRemainingMs,
  shouldWarn,
} from "../sessionTimeout";

describe("session timeout", () => {
  it("computes remaining time without going negative", () => {
    expect(sessionRemainingMs(1_000, 0)).toBe(1_000);
    expect(sessionRemainingMs(1_000, 2_000)).toBe(0);
  });

  it("warns only inside the warning window", () => {
    const now = 10_000;
    expect(shouldWarn(now + SESSION_WARNING_MS + 1, now)).toBe(false);
    expect(shouldWarn(now + 30_000, now)).toBe(true);
    expect(shouldWarn(now - 1, now)).toBe(false);
  });

  it("formats the countdown", () => {
    expect(formatRemaining(90_000)).toBe("1:30");
    expect(formatRemaining(5_000)).toBe("0:05");
    expect(formatRemaining(-10)).toBe("0:00");
  });
});
