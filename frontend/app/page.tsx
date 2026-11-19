"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import AuthShell from "../components/layout/AuthShell";
import { login } from "../lib/api";
import { useI18n } from "../lib/locale";

export default function Home() {
  const router = useRouter();
  const { t } = useI18n();
  const [tenantSlug, setTenantSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    try {
      await login(tenantSlug, email, password);
      router.push("/dashboard");
      router.refresh();
    } catch {
      setMessage(t("auth.loginFailed"));
    }
  }

  return (
    <AuthShell>
      <section className="awap-auth" aria-labelledby="login-heading">
        <h1 id="login-heading" className="awap-auth-title">
          {t("app.name")}
        </h1>
        <p className="awap-auth-subtitle">{t("app.description")}</p>

        <form onSubmit={handleSubmit} className="awap-form">
          <label className="awap-label">
            {t("auth.tenantSlug")}
            <input
              className="awap-input"
              type="text"
              autoComplete="organization"
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.email")}
            <input
              className="awap-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="awap-label">
            {t("auth.password")}
            <input
              className="awap-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="awap-button awap-button-primary">
            {t("auth.signIn")}
          </button>
        </form>

        <p className="mt-4">
          <Link href="/register">{t("auth.createTenant")}</Link>
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
