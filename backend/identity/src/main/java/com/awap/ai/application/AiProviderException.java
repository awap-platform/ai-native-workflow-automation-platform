package com.awap.ai.application;

/** Provider-neutral error. Vendor status codes and payloads never cross this boundary. */
public class AiProviderException extends RuntimeException {

  public enum Code {
    RATE_LIMITED,
    TIMEOUT,
    UNAVAILABLE,
    AUTHENTICATION,
    INVALID_REQUEST,
    MALFORMED_RESPONSE,
    EMPTY_CONTENT,
    NO_PROVIDER,
    ALL_PROVIDERS_FAILED
  }

  private final Code code;
  private final boolean retryable;

  public AiProviderException(Code code, boolean retryable, String message) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }

  public AiProviderException(Code code, boolean retryable, String message, Throwable cause) {
    super(message, cause);
    this.code = code;
    this.retryable = retryable;
  }

  public Code code() {
    return code;
  }

  public boolean retryable() {
    return retryable;
  }
}
