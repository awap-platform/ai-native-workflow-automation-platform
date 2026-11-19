"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { getActiveTenant, isAuthenticated } from "../../lib/auth";

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/");
      return;
    }
    if (pathname !== "/select-tenant" && !getActiveTenant()) {
      const returnTo = encodeURIComponent(`${pathname}${window.location.search}`);
      router.replace(`/select-tenant?returnTo=${returnTo}`);
    }
  }, [pathname, router]);

  return <>{children}</>;
}
