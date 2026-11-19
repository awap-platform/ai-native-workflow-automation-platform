/**
 * Client-side password policy (UI/UX phase 2).
 *
 * The backend requires at least 8 characters; the product UI asks for 12 and a
 * mix of character classes so account creation is strong by default. This module
 * is pure and shared by the register wizard and invitation acceptance.
 */
export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordChecks {
  length: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
}

export type PasswordStrength = "weak" | "fair" | "good" | "strong";

export interface PasswordAssessment {
  valid: boolean;
  score: number;
  strength: PasswordStrength;
  checks: PasswordChecks;
}

const SYMBOL_PATTERN = /[^A-Za-z0-9]/;

export function assessPassword(password: string): PasswordAssessment {
  const checks: PasswordChecks = {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: SYMBOL_PATTERN.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const strength: PasswordStrength =
    score <= 2 ? "weak" : score === 3 ? "fair" : score === 4 ? "good" : "strong";
  return { valid: score === 5, score, strength, checks };
}

/** Returns the first unmet password requirement key, if any. */
export function firstPasswordProblem(password: string): keyof PasswordChecks | null {
  const { checks } = assessPassword(password);
  const order: Array<keyof PasswordChecks> = ["length", "upper", "lower", "digit", "symbol"];
  return order.find((key) => !checks[key]) ?? null;
}

/** True when the password confirmation matches and the policy is satisfied. */
export function passwordIsAcceptable(password: string, confirmation: string): boolean {
  return assessPassword(password).valid && password === confirmation;
}
