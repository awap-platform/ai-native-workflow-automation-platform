"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "../../lib/auth";
import { refreshSession } from "../../lib/api";
import { useI18n } from "../../lib/locale";
import { useSessionExpiry } from "../../lib/session";
import {
  formatRemaining,
  SESSION_WARNING_MS,
  sessionRemainingMs,
} from "../../lib/sessionTimeout";
import { Button } from "../ui/button";

/**
 * Visible session-expiry warning. It only renders once a real expiry cookie is
 * present; legacy/test sessions without one are unaffected. Refreshing keeps the
 * user on the page; a failed refresh returns to the login screen with a reason.
 */
export default function SessionTimeoutWarning() {
  const router = useRouter();
  const { t } = useI18n();
  const expiry = useSessionExpiry();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const redirecting = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (expiry && now >= expiry && !redirecting.current) {
      redirecting.current = true;
      router.replace("/?reason=expired");
    }
  }, [expiry, now, router]);

  if (!expiry) {
    return null;
  }
  const remaining = sessionRemainingMs(expiry, now);
  if (remaining <= 0 || remaining > SESSION_WARNING_MS) {
    return null;
  }

  const stay = async () => {
    setRefreshing(true);
    const refreshed = await refreshSession();
    setRefreshing(false);
    if (!refreshed) {
      router.replace("/?reason=expired");
    } else {
      setNow(Date.now());
    }
  };

  return (
    <div
      className="awap-banner awap-alert awap-alert-warning"
      role="alert"
      data-testid="session-timeout-warning"
    >
      <span>
        {t("auth.sessionExpiresIn", { time: formatRemaining(remaining) })}
      </span>
      <span className="flex items-center gap-2">
        <Button size="sm" onClick={() => void stay()} loading={refreshing}>
          {t("auth.staySignedIn")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void logout()}>
          {t("auth.signOut")}
        </Button>
      </span>
    </div>
  );
}
