"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { acceptInvitation, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/locale";
import { assessPassword, firstPasswordProblem } from "../../lib/passwordPolicy";
import { isValidFullName } from "../../lib/validation";
import { Button } from "../ui/button";
import { FormField, Input, RadioGroup } from "../ui/form-controls";

export default function InvitationAcceptCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const token = searchParams.get("token") ?? "";

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assessment = assessPassword(password);
  const updateCaps = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.("CapsLock") ?? false);
  };

  async function submit() {
    if (submitting) {
      return;
    }
    setError(null);
    if (!token) {
      setError(t("invitation.tokenMissing"));
      return;
    }
    if (mode === "new") {
      if (!isValidFullName(fullName)) {
        setError(t("invitation.errorFullName"));
        return;
      }
      if (!assessment.valid) {
        setError(
          t("invitation.errorPassword", {
            rule: t(`register.rule.${firstPasswordProblem(password) ?? "length"}`),
          }),
        );
        return;
      }
      if (password !== confirmation) {
        setError(t("invitation.errorPasswordMismatch"));
        return;
      }
    }

    setSubmitting(true);
    try {
      const tenant = await acceptInvitation(
        token,
        mode === "new" ? { fullName: fullName.trim(), password } : {},
      );
      router.replace(`/?invited=1&tenant=${encodeURIComponent(tenant.slug)}`);
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiError) {
        if (cause.status === 429) {
          setError(
            t("invitation.rateLimited", { seconds: cause.retryAfterSeconds ?? 60 }),
          );
        } else if (cause.status === 409) {
          setError(t("invitation.expired"));
        } else if (cause.status === 400) {
          setError(
            cause.message.toLowerCase().includes("password")
              ? t("invitation.passwordRequired")
              : t("invitation.invalidToken"),
          );
        } else {
          setError(cause.message);
        }
      } else {
        setError(t("invitation.genericError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="awap-card mx-auto w-full max-w-lg" data-testid="invitation-card">
      <h1 className="awap-auth-title">{t("invitation.title")}</h1>
      <p className="awap-auth-subtitle">{t("invitation.subtitle")}</p>

      {!token ? (
        <div className="awap-error" role="alert" data-testid="invitation-missing-token">
          <p>{t("invitation.tokenMissing")}</p>
          <p className="mt-2">
            <Link href="/">{t("invitation.requestNew")}</Link>
          </p>
        </div>
      ) : (
        <>
          <RadioGroup
            legend={t("invitation.modeLegend")}
            name="invitation-mode"
            value={mode}
            onValueChange={(value) => setMode(value as "new" | "existing")}
            options={[
              {
                value: "new",
                label: t("invitation.newUser"),
                description: t("invitation.newHint"),
              },
              {
                value: "existing",
                label: t("invitation.existingUser"),
                description: t("invitation.existingHint"),
              },
            ]}
          />

          <div className="mt-4 grid gap-3">
            {mode === "new" ? (
              <>
                <FormField id="invitation-name" label={t("invitation.fullName")}>
                  <Input
                    id="invitation-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    autoComplete="name"
                  />
                </FormField>
                <FormField
                  id="invitation-password"
                  label={t("invitation.password")}
                  hint={t("register.passwordHint")}
                >
                  <span className="relative block">
                    <Input
                      id="invitation-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyDown={updateCaps}
                      onKeyUp={updateCaps}
                      autoComplete="new-password"
                      className="pr-12"
                      aria-describedby="invitation-password-hint"
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
                <p className="text-xs awap-muted" aria-live="polite">
                  {t("register.strength", {
                    strength: t(`register.strength.${assessment.strength}`),
                  })}
                </p>
                <FormField id="invitation-confirm" label={t("invitation.confirmPassword")}>
                  <Input
                    id="invitation-confirm"
                    type={showPassword ? "text" : "password"}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                  />
                </FormField>
                {capsLock ? (
                  <p role="status" className="text-xs awap-alert awap-alert-warning">
                    {t("auth.capsLock")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm awap-muted">{t("invitation.existingNote")}</p>
            )}
          </div>

          {error ? (
            <p role="alert" data-testid="invitation-error" className="awap-error mt-3">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void submit()} loading={submitting}>
              {submitting ? t("invitation.accepting") : t("invitation.accept")}
            </Button>
            <Link href="/" className="awap-button">
              {t("invitation.requestNew")}
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
