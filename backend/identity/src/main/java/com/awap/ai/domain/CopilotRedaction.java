package com.awap.ai.domain;

import java.util.regex.Pattern;

/**
 * Redacts credential-shaped strings before a turn is persisted (issue #373). The store is for
 * conversation evidence, not for secrets, so a pasted token becomes {@code [redacted]} instead of a
 * durable copy.
 */
public final class CopilotRedaction {

  static final String MASK = "[redacted]";

  private static final Pattern BEARER =
      Pattern.compile("(?i)\\b(bearer|basic)\\s+[A-Za-z0-9._~+/=-]{8,}");
  private static final Pattern API_KEY =
      Pattern.compile("\\b(?:sk|pk|rk|api)[-_][A-Za-z0-9_-]{16,}\\b");
  private static final Pattern AWS_KEY = Pattern.compile("\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b");
  private static final Pattern PASSWORD =
      Pattern.compile("(?i)\\b(password|passwd|secret|token)\\s*[:=]\\s*\\S+");

  private CopilotRedaction() {}

  /** Returns the text with credential-shaped tokens masked; null and blank input pass through. */
  public static String redact(String text) {
    if (text == null || text.isBlank()) {
      return text;
    }
    String redacted = BEARER.matcher(text).replaceAll("$1 " + MASK);
    redacted = API_KEY.matcher(redacted).replaceAll(MASK);
    redacted = AWS_KEY.matcher(redacted).replaceAll(MASK);
    redacted = PASSWORD.matcher(redacted).replaceAll("$1: " + MASK);
    return redacted;
  }
}
