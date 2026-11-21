import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import FallbackNotices from "../components/layout/FallbackNotices";
import OfflineBanner from "../components/layout/OfflineBanner";
import QueryProvider from "../components/providers/QueryProvider";
import WebVitalsReporter from "../components/providers/WebVitalsReporter";
import { ToastProvider } from "../components/ui/overlays";
import { FeatureFlagProvider } from "../lib/featureFlagContext";
import { resolveFeatureFlags } from "../lib/featureFlags";
import { resolveLocale } from "../lib/i18n";
import { LocaleProvider } from "../lib/locale";
import { ThemeProvider } from "../lib/theme";
import { themeBootstrapScript } from "../lib/themeScript";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AWAP",
  description: "AI-Native Workflow Automation Platform",
};

// Cache Components blocks dynamic header reads during prerendering unless the
// route explicitly opts into blocking. The nonce policy requires every HTML
// response to be rendered per request.
export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Reading request headers opts the tree into dynamic rendering. A statically
  // prerendered page cannot carry the per-request CSP nonce, so Next.js would
  // emit nonce-less scripts and hydration would be blocked by the policy.
  const headerStore = await headers();
  const nonce = headerStore.get("x-nonce") ?? undefined;
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get("awap_locale")?.value);
  // Cache Components treats `new Date()` (the flag-expiry clock) as an unstable
  // value during prerendering, so the render is explicitly request-bound before
  // the flags are evaluated.
  await connection();
  // Runtime feature flags come from the process environment (Kubernetes
  // ConfigMap), never from a build-time NEXT_PUBLIC_ variable.
  const flags = resolveFeatureFlags(process.env);

  return (
    // The pre-paint theme script adds `.dark` before React hydrates.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <head>
        {nonce ? (
          <script
            nonce={nonce}
            dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
          />
        ) : null}
      </head>
      <body>
        <noscript>
          <div className="awap-noscript" role="alert">
            This application needs JavaScript. Enable JavaScript and reload the page. If you are
            using a restricted browser, open the application in a supported browser listed in
            COMPATIBILITY.md.
          </div>
        </noscript>
        <a href="#main-content" className="awap-skip-link">
          Skip to main content
        </a>
        <OfflineBanner />
        <FallbackNotices />
        <FeatureFlagProvider value={flags}>
          <WebVitalsReporter />
          <QueryProvider>
            <ThemeProvider>
              <LocaleProvider initialLocale={locale}>
                <ToastProvider>{children}</ToastProvider>
              </LocaleProvider>
            </ThemeProvider>
          </QueryProvider>
        </FeatureFlagProvider>
      </body>
    </html>
  );
}
