"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { ApiError, correlationIdOf } from "../../lib/api";
import { useRegisterTenant } from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";
import {
  assessPassword,
  firstPasswordProblem,
  type PasswordStrength,
} from "../../lib/passwordPolicy";
import { isValidEmail, isValidFullName, isValidTenantName, isValidTenantSlug } from "../../lib/validation";
import { Button } from "../ui/button";
import { Checkbox, FormField, Input } from "../ui/form-controls";
import { Stepper } from "../ui/data-display";

const STEP_KEYS = [
  "register.stepWorkspace",
  "register.stepAdmin",
  "register.stepSecurity",
  "register.stepSummary",
] as const;

const STRENGTH_WIDTH: Record<PasswordStrength, string> = {
  weak: "w-1/4",
  fair: "w-2/4",
  good: "w-3/4",
  strong: "w-full",
};

const STRENGTH_TONE: Record<PasswordStrength, string> = {
  weak: "bg-[var(--awap-danger)]",
  fair: "bg-[var(--awap-warning)]",
  good: "bg-[var(--awap-primary)]",
  strong: "bg-[var(--awap-success)]",
};

export default function RegisterWizard() {
  const router = useRouter();
  const { t } = useI18n();
  const register = useRegisterTenant();

  const [step, setStep] = useState(0);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const assessment = assessPassword(adminPassword);
  const steps = STEP_KEYS.map((key) => ({ label: t(key) }));

  const focus = (id: string) => {
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  const updateCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  };

  function validate(current: number): { message: string; field: string } | null {
    if (current === 0) {
      if (!isValidTenantSlug(slug)) {
        return { message: t("register.errorSlug"), field: "register-slug" };
      }
      if (!isValidTenantName(name)) {
        return { message: t("register.errorName"), field: "register-name" };
      }
      return null;
    }
    if (current === 1) {
      if (!isValidFullName(adminFullName)) {
        return { message: t("register.errorFullName"), field: "register-admin-name" };
      }
      if (!isValidEmail(adminEmail)) {
        return { message: t("register.errorEmail"), field: "register-admin-email" };
      }
      return null;
    }
    if (current === 2) {
      if (!assessment.valid) {
        const problem = firstPasswordProblem(adminPassword);
        return {
          message: t("register.errorPassword", {
            rule: t(`register.rule.${problem ?? "length"}`),
          }),
          field: "register-password",
        };
      }
      if (adminPassword !== confirmPassword) {
        return { message: t("register.errorPasswordMismatch"), field: "register-confirm" };
      }
      if (!consent) {
        return { message: t("register.errorConsent"), field: "register-consent" };
      }
      return null;
    }
    return null;
  }

  const next = () => {
    setServerError(null);
    const problem = validate(step);
    if (problem) {
      setStepError(problem.message);
      focus(problem.field);
      return;
    }
    setStepError(null);
    setStep((value) => Math.min(value + 1, 3));
  };

  const back = () => {
    setStepError(null);
    setServerError(null);
    setStep((value) => Math.max(value - 1, 0));
  };

  async function submit() {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setServerError(null);
    for (const index of [0, 1, 2]) {
      const problem = validate(index);
      if (problem) {
        setStep(index);
        setStepError(problem.message);
        focus(problem.field);
        return;
      }
    }
    setSubmitting(true);
    try {
      await register.mutateAsync({
        slug: slug.trim(),
        name: name.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        adminFullName: adminFullName.trim(),
      });
      router.replace(
        `/?registered=1&tenant=${encodeURIComponent(slug.trim())}`,
      );
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setStep(0);
        setServerError(t("register.slugTaken"));
        focus("register-slug");
      } else if (cause instanceof ApiError) {
        const correlation = correlationIdOf(cause);
        setServerError(
          correlation ? `${cause.message} (${t("auth.reference")}: ${correlation})` : cause.message,
        );
      } else {
        setServerError(t("register.errorGeneric"));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const reviewRows = [
    { key: "workspace", label: t("register.stepWorkspace"), value: `${name} (${slug})`, step: 0 },
    { key: "admin", label: t("register.adminAccount"), value: `${adminFullName} · ${adminEmail}`, step: 1 },
    { key: "security", label: t("register.stepSecurity"), value: t("register.reviewSecurity"), step: 2 },
  ];

  return (
    <section className="awap-card mx-auto w-full max-w-2xl" data-testid="register-wizard">
      <header className="grid gap-2">
        <h1 className="awap-auth-title">{t("auth.createTenant")}</h1>
        <p className="awap-auth-subtitle">{t("register.subtitle")}</p>
      </header>

      <div className="my-4">
        <Stepper steps={steps} current={step} ariaLabel={t("register.progress")} />
      </div>

      {serverError ? (
        <p role="alert" data-testid="register-server-error" className="awap-error mb-3">
          {serverError}
        </p>
      ) : null}
      {stepError ? (
        <p role="alert" data-testid="register-error" className="awap-alert awap-alert-danger mb-3">
          {stepError}
        </p>
      ) : null}

      <div data-testid={`register-step-${step}`} className="grid gap-3">
        {step === 0 ? (
          <>
            <FormField
              id="register-slug"
              label={t("auth.tenantSlug")}
              hint={t("register.slugHint")}
            >
              <Input
                id="register-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                autoComplete="organization"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="register-slug-hint"
              />
            </FormField>
            <p className="text-sm awap-muted" data-testid="slug-preview">
              {t("register.slugPreview", { slug: slug || "acme" })}
            </p>
            <FormField id="register-name" label={t("auth.companyName")}>
              <Input
                id="register-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="organization"
              />
            </FormField>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <FormField id="register-admin-name" label={t("auth.adminFullName")}>
              <Input
                id="register-admin-name"
                value={adminFullName}
                onChange={(event) => setAdminFullName(event.target.value)}
                autoComplete="name"
              />
            </FormField>
            <FormField id="register-admin-email" label={t("auth.adminEmail")} hint={t("register.emailHint")}>
              <Input
                id="register-admin-email"
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                aria-describedby="register-admin-email-hint"
              />
            </FormField>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <FormField
              id="register-password"
              label={t("auth.adminPassword")}
              hint={t("register.passwordHint")}
            >
              <span className="relative block">
                <Input
                  id="register-password"
                  type={showPassword ? "text" : "password"}
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  onKeyDown={updateCaps}
                  onKeyUp={updateCaps}
                  autoComplete="new-password"
                  className="pr-12"
                  aria-describedby="register-password-hint register-password-strength"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 awap-muted hover:bg-muted"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </span>
            </FormField>

            <div id="register-password-strength" aria-live="polite">
              <div className="h-2 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
                <div className={`h-2 ${STRENGTH_WIDTH[assessment.strength]} ${STRENGTH_TONE[assessment.strength]}`} />
              </div>
              <p className="mt-1 text-xs awap-muted">
                {t("register.strength", {
                  strength: t(`register.strength.${assessment.strength}`),
                })}
              </p>
              <ul className="awap-list mt-2 text-xs">
                {(["length", "upper", "lower", "digit", "symbol"] as const).map((rule) => (
                  <li key={rule} className="flex items-center gap-2">
                    {assessment.checks[rule] ? (
                      <Check className="size-3.5 text-[var(--awap-success)]" aria-hidden="true" />
                    ) : (
                      <X className="size-3.5 text-[var(--awap-danger)]" aria-hidden="true" />
                    )}
                    <span>{t(`register.rule.${rule}`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {capsLock ? (
              <p role="status" className="text-xs awap-alert awap-alert-warning">
                {t("auth.capsLock")}
              </p>
            ) : null}

            <FormField id="register-confirm" label={t("register.confirmPassword")}>
              <Input
                id="register-confirm"
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </FormField>

            <Checkbox
              id="register-consent"
              label={t("register.consent")}
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
          </>
        ) : null}

        {step === 3 ? (
          <div data-testid="register-summary" className="grid gap-3">
            <dl className="awap-list">
              {reviewRows.map((row) => (
                <div key={row.key} className="awap-list-row">
                  <div>
                    <dt className="text-xs awap-muted">{row.label}</dt>
                    <dd className="font-semibold">{row.value}</dd>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStep(row.step);
                      setStepError(null);
                    }}
                    aria-label={`${t("register.edit")} ${row.label}`}
                  >
                    {t("register.edit")}
                  </Button>
                </div>
              ))}
            </dl>
            <p className="text-sm awap-muted">{t("register.verificationNote")}</p>
            <Button
              type="button"
              onClick={() => void submit()}
              loading={submitting}
              data-testid="register-submit"
            >
              {submitting ? t("register.creating") : t("register.create")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={back}
          disabled={step === 0 || submitting}
          data-testid="register-back"
        >
          {t("register.back")}
        </Button>
        {step < 3 ? (
          <Button type="button" onClick={next} data-testid="register-next">
            {t("register.next")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
