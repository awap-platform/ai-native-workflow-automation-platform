import type { QueryClient } from "@tanstack/react-query";
import { setActiveTenant } from "./auth";

/**
 * Switches the active tenant and clears every cached server resource.
 *
 * The pages also reload, but clearing the cache first is the enforceable contract: a slow reload
 * must never leave another tenant's rows visible, and a test can assert the clear happened before
 * the cookie changed.
 */
export function switchTenant(
  queryClient: Pick<QueryClient, "clear">,
  tenantId: string,
): void {
  queryClient.clear();
  setActiveTenant(tenantId);
}
