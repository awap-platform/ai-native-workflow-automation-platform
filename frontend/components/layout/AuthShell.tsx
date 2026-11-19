"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import LocaleSwitcher from "./LocaleSwitcher";
import ThemeToggle from "./ThemeToggle";

/**
 * Shared shell for unauthenticated screens (sign in, register, tenant picker).
 * It keeps the theme/locale controls and the skip-link target consistent without
 * exposing the authenticated sidebar.
 */
export default function AuthShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="awap-auth-shell">
      <header className="awap-auth-toolbar">
        <Link href="/" className="awap-brand">
          AWAP
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" className={wide ? "awap-main" : "awap-auth-main"} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
