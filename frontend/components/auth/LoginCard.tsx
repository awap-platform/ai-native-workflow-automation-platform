"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { login, ApiError, correlationIdOf } from "../../lib/api";
import { useI18n } from "../../lib/locale";
import { safeReturnTo } from "../../lib/redirect";
import { Button } from "../ui/button";

function CapsLockHint({ visible, label }: { visible: boolean; label: string }) {
  if (!visible) {
    return null;
  }
  return (
    <p id="login-caps" role="status" className="text-xs awap-alert awap-alert-warning mt-1">
      {label}
    </p>
  );
}

export default function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();

  const tenantParam = searchParams.get("tenant") ?? "";
  const reason = searchParams.get("reason");
  const registered = searchParams.get("registered") === "1";
  const invited = searchParams.get("invited") === "1";
  const returnTo = safeReturnTo(searchParams.get("returnTo"), "/dashboard");

  const [tenantSlug, setTenantSlug] = useState(tenantParam);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const submittingRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const retrySeconds = lockUntil > now ? Math.ceil((lockUntil - now) / 1000) : 0;
  const notice = reason === "expired"
    ? t("auth.sessionExpired")
    : registered
      ? t("auth.tenantCreated")
      : invited
        ? t("auth.invitationAccepted")
        : null;

  const updateCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || retrySeconds > 0) {
      return;
    }
    submittingRef.current = true;
    setError(null);

    if (!tenantSlug.trim()) {
      setError(t("auth.errorTenantRequired"));
      return;
    }
    if (!email.trim()) {
      setError(t("auth.errorEmailRequired"));
      return;
    }
    if (!password) {
      setError(t("auth.errorPasswordRequired"));
      return;
    }

    setSubmitting(true);
    try {
      await login(tenantSlug.trim(), email.trim(), password);
      router.replace(returnTo);
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 429) {
          const seconds = cause.retryAfterSeconds ?? 60;
          setLockUntil(Date.now() + seconds * 1000);
          setError(t("auth.rateLimited"));
        } else if (cause.status === 401 || cause.status === 403 || cause.status === 404) {
          setError(t("auth.invalidCredentials"));
        } else if (cause.status === 503) {
          setError(t("auth.unavailable"));
        } else {
          const correlation = correlationIdOf(cause);
          setError(
            correlation
              ? `${cause.message} (${t("auth.reference")}: ${correlation})`
              : cause.message,
          );
        }
      } else {
        setError(t("auth.unavailable"));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_420px] lg:items-center">
      <section className="awap-card hidden gap-4 lg:grid" aria-labelledby="login-brand-heading">
        <p className="awap-brand">{t("app.name")}</p>
        <h1 id="login-brand-heading" className="text-3xl font-bold">
          {t("auth.signInTitle")}
        </h1>
        <p className="awap-muted">{t("auth.signInSubtitle")}</p>
        <ul className="awap-list">
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{t("auth.value1")}</span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{t("auth.value2")}</span>
          </li>
          <li className="flex items-start gap-2">
            <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{t("auth.value3")}</span>
          </li>
        </ul>
      </section>

      <section className="awap-card" aria-labelledby="login-heading" data-testid="login-card">
        <h1 id="login-heading" className="awap-auth-title">
          {t("auth.signIn")}
        </h1>
        <p className="awap-auth-subtitle">{t("app.description")}</p>

        {notice ? (
          <p
            className="awap-alert mb-4"
            role="status"
            data-testid="login-notice"
            aria-live="polite"
          >
            {notice}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="awap-form" noValidate>
          <label className="awap-label" htmlFor="login-tenant">
            {t("auth.tenantSlug")}
            <input
              id="login-tenant"
              name="tenantSlug"
              className="awap-input"
              type="text"
              autoComplete="organization"
              autoCapitalize="none"
              spellCheck={false}
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              aria-invalid={error ? "true" : undefined}
            />
          </label>

          <label className="awap-label" htmlFor="login-email">
            {t("auth.email")}
            <input
              id="login-email"
              name="email"
              className="awap-input"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? "true" : undefined}
            />
          </label>

          <div className="grid gap-1">
            <label className="awap-label" htmlFor="login-password">
              {t("auth.password")}
            </label>
            <span className="relative block">
              <input
                id="login-password"
                name="password"
                className="awap-input pr-12"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={updateCaps}
                onKeyUp={updateCaps}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={capsLock ? "login-caps" : undefined}
              />
              <button
                type="button"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-2 awap-muted hover:bg-muted"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
                aria-pressed={showPassword}
                data-testid="password-toggle"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </span>
          </div>
          <CapsLockHint visible={capsLock} label={t("auth.capsLock")} />

          {error ? (
            <p role="alert" data-testid="login-error" className="awap-error">
              {error}
              {retrySeconds > 0
                ? ` ${t("auth.retryIn", { seconds: retrySeconds })}`
                : ""}
            </p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            loading={submitting}
            disabled={retrySeconds > 0}
          >
            {submitting ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>

        <div className="mt-4 grid gap-2">
          <div className="flex items-center gap-2">
            <Button variant="outline" className="flex-1" disabled>
              {t("auth.ssoGoogle")}
            </Button>
            <Button variant="outline" className="flex-1" disabled>
              {t("auth.ssoMicrosoft")}
            </Button>
          </div>
          <p className="text-xs awap-muted" data-testid="sso-placeholder">
            {t("auth.ssoNote")}
          </p>
        </div>

        <p className="mt-4 text-sm">
          <Link href="/register">{t("auth.createTenant")}</Link>
        </p>
        <p className="mt-2 text-xs awap-muted">{t("auth.passwordManagerHint")}</p>
      </section>
    </div>
  );
}
