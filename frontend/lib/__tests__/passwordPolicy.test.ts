import {
  assessPassword,
  firstPasswordProblem,
  passwordIsAcceptable,
  PASSWORD_MIN_LENGTH,
} from "../passwordPolicy";

describe("password policy", () => {
  it("accepts a strong, matching password", () => {
    const password = "Str0ng-Passw0rd!";
    const assessment = assessPassword(password);
    expect(assessment.valid).toBe(true);
    expect(assessment.strength).toBe("strong");
    expect(assessment.checks.length).toBe(true);
    expect(passwordIsAcceptable(password, password)).toBe(true);
  });

  it("rejects short, one-class and mismatched passwords", () => {
    expect(assessPassword("short").valid).toBe(false);
    expect(assessPassword("alllowercase12!").valid).toBe(false);
    expect(passwordIsAcceptable("Str0ng-Passw0rd!", "Other-Passw0rd!")).toBe(false);
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it("reports the first unmet requirement", () => {
    expect(firstPasswordProblem("abc")).toBe("length");
    expect(firstPasswordProblem("abcdefghijkl")).toBe("upper");
    expect(firstPasswordProblem("Abcdefghijkl")).toBe("digit");
    expect(firstPasswordProblem("Abcdefghijk1")).toBe("symbol");
    expect(firstPasswordProblem("Abcdefghij1!")).toBeNull();
  });
});
