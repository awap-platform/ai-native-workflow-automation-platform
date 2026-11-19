"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import AuthShell from "../../components/layout/AuthShell";
import { useRegisterTenant } from "../../lib/hooks/resources";
import { useI18n } from "../../lib/locale";

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useI18n();
  const register = useRegisterTenant();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      await register.mutateAsync({ slug, name, adminEmail, adminPassword, adminFullName });
      router.push("/");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("auth.registrationFailed"),
      );
    }
  }

  return (
    <AuthShell>
      <section className="awap-auth" aria-labelledby="register-heading">
        <h1 id="register-heading" className="awap-auth-title">
          {t("auth.createTenant")}
        </h1>
        <p className="awap-auth-subtitle">{t("auth.registerHint")}</p>
        <form onSubmit={handleSubmit} className="awap-form">
          <label className="awap-label">
            {t("auth.tenantSlug")}
            <input
              className="awap-input"
              type="text"
              autoComplete="organization"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.companyName")}
            <input
              className="awap-input"
              type="text"
              autoComplete="organization"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.adminFullName")}
            <input
              className="awap-input"
              type="text"
              autoComplete="name"
              value={adminFullName}
              onChange={(event) => setAdminFullName(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.adminEmail")}
            <input
              className="awap-input"
              type="email"
              autoComplete="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.adminPassword")}
            <input
              className="awap-input"
              type="password"
              autoComplete="new-password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            className="awap-button awap-button-primary"
            disabled={register.isPending}
          >
            {register.isPending ? t("auth.creating") : t("auth.createTenant")}
          </button>
        </form>
        <p className="mt-4">
          <Link href="/">{t("auth.backToSignIn")}</Link>
        </p>
        {message ? (
          <p aria-live="polite" className="awap-alert awap-alert-danger">
            {message}
          </p>
        ) : null}
      </section>
    </AuthShell>
  );
}
