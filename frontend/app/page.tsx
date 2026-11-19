"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { login } from "../lib/api";

export default function Home() {
  const router = useRouter();
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
      setMessage("Login failed");
    }
  }

  return (
    <main id="main-content" className="awap-auth">
      <h1 className="awap-auth-title">AWAP</h1>
      <p className="awap-auth-subtitle">AI-Native Workflow Automation Platform</p>

      <form onSubmit={handleSubmit} className="awap-form">
        <label className="awap-label">
          Tenant slug
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
          Email
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
          Password
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
          Sign in
        </button>
      </form>

      <p className="mt-4">
        <Link href="/register">Create a tenant</Link>
      </p>

      {message ? (
        <p aria-live="polite" className="awap-alert awap-alert-danger">
          {message}
        </p>
      ) : null}
    </main>
  );
}
