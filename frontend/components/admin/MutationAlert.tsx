import { errorStatus } from "../../lib/api";

/**
 * Maps a mutation failure to an actionable message.
 *
 * The backend distinguishes a self-escalation (403), the last administrator (409) and an exhausted
 * quota (429). The UI keeps the server's detailed RFC 7807 message when it is available and never
 * claims success after a failure.
 */
export function MutationAlert({
  error,
  action,
}: {
  error: unknown;
  action: string;
}) {
  if (!error) {
    return null;
  }
  const status = errorStatus(error);
  const detail = error instanceof Error ? error.message : "";
  let message: string;
  switch (status) {
    case 403:
      message = detail || "You do not have permission to perform this action.";
      break;
    case 409:
      message = detail || "The change conflicts with the current state.";
      break;
    case 429:
      message = detail || "The tenant quota is exhausted. No change was made.";
      break;
    default:
      message = detail || `${action} failed. No change was made.`;
  }
  return (
    <p role="alert" className="awap-alert awap-alert-danger" data-testid="mutation-error">
      {message}
    </p>
  );
}
