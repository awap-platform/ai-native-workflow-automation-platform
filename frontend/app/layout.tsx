import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import OfflineBanner from "../components/layout/OfflineBanner";
import QueryProvider from "../components/providers/QueryProvider";
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
  await headers();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <a href="#main-content" className="awap-skip-link">
          Skip to main content
        </a>
        <OfflineBanner />
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
