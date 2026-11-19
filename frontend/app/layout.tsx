import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import OfflineBanner from "../components/layout/OfflineBanner";
import QueryProvider from "../components/providers/QueryProvider";
import { ToastProvider } from "../components/ui/overlays";
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
        <a href="#main-content" className="awap-skip-link">
          Skip to main content
        </a>
        <OfflineBanner />
        <QueryProvider>
          <ThemeProvider>
            <LocaleProvider initialLocale={locale}>
              <ToastProvider>{children}</ToastProvider>
            </LocaleProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
