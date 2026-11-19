"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useRegisterTenant } from "../../lib/hooks/resources";

export default function RegisterPage() {
  const router = useRouter();
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
      setMessage(error instanceof Error ? error.message : "Registration failed");
    }
  }

  return (
    <main id="main-content" className="awap-auth">
      <h1 className="awap-auth-title">Create tenant</h1>
      <p className="awap-auth-subtitle">
        Every new tenant starts with an administrator who can invite the rest of the team.
      </p>
      <form onSubmit={handleSubmit} className="awap-form">
        <label className="awap-label">
          Tenant slug
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
          Company name
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
          Admin full name
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
          Admin email
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
          Admin password
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
          {register.isPending ? "Creating…" : "Create tenant"}
        </button>
      </form>
      <p className="mt-4">
        <Link href="/">Back to sign in</Link>
      </p>
      {message ? (
        <p aria-live="polite" className="awap-alert awap-alert-danger">
          {message}
        </p>
      ) : null}
    </main>
  );
}
