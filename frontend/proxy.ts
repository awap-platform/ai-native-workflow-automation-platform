import { NextResponse, type NextRequest } from "next/server";
import {
  buildCsp,
  CSP_REPORT_TO,
  CSP_REPORTING_ENDPOINTS,
  cspHeaderName,
  generateNonce,
} from "./lib/csp";

const apiOrigins =
  process.env.API_ORIGINS ?? "http://localhost:8080 http://127.0.0.1:8080";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/workflows",
  "/tasks",
  "/instances",
  "/organizations",
  "/forms",
  "/documents",
  "/analytics",
  "/notifications",
  "/notification-templates",
  "/admin",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function withCspRequestHeaders(
  headers: Headers,
  headerName: string,
  csp: string,
  nonce: string,
): Headers {
  const requestHeaders = new Headers(headers);
  // Next.js reads the CSP header from the incoming request and applies the
  // nonce to its own bootstrap scripts. `x-nonce` is available to application
  // code that needs to render an inline script or style tag.
  requestHeaders.set(headerName, csp);
  requestHeaders.set("x-nonce", nonce);
  return requestHeaders;
}

function applyCspHeaders(response: NextResponse, headerName: string, csp: string): void {
  response.headers.set(headerName, csp);
  response.headers.set("Report-To", CSP_REPORT_TO);
  response.headers.set("Reporting-Endpoints", CSP_REPORTING_ENDPOINTS);
}

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const reportOnly = process.env.CSP_REPORT_ONLY === "true";
  const headerName = cspHeaderName(reportOnly);
  // React Flow applies dynamic node/edge geometry as inline style attributes. That is the one
  // reviewed exception, scoped to the designer route; every other route keeps style-src-attr 'none'.
  const designerRoute = request.nextUrl.pathname.startsWith("/workflows/designer");
  const csp = buildCsp({
    nonce,
    apiOrigins,
    styleAttr: designerRoute ? "unsafe-inline" : "none",
    upgradeInsecureRequests: process.env.NODE_ENV === "production",
  });

  const session = request.cookies.get("awap_session")?.value;
  const redirect = isProtected(request.nextUrl.pathname) && session !== "1";

  const response = redirect
    ? NextResponse.redirect(new URL("/", request.url))
    : NextResponse.next({
        request: {
          headers: withCspRequestHeaders(request.headers, headerName, csp, nonce),
        },
      });

  applyCspHeaders(response, headerName, csp);
  return response;
}

export const config = {
  matcher: [
    // Every page and route handler, excluding static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
