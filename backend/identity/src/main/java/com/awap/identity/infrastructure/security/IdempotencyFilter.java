package com.awap.identity.infrastructure.security;

import com.awap.identity.domain.IdempotencyRecord;
import com.awap.identity.infrastructure.IdempotencyRecordRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Replays a previous response for a duplicate Idempotency-Key; otherwise caches the response.
 *
 * <p>The key is bound to a hash of the HTTP method, path, query and body. Reusing a key with a
 * different payload is a deterministic {@code 409} instead of silently returning the previous
 * intent's result (issue #283). Uniqueness is tenant-scoped by the database constraint, and the
 * insert race is handled explicitly.
 */
@Component
public class IdempotencyFilter extends OncePerRequestFilter {

  private static final Set<String> MUTATING_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
  private static final String IDEMPOTENCY_HEADER = "Idempotency-Key";
  private static final int BODY_CACHE_LIMIT = 64 * 1024;

  private final IdempotencyRecordRepository idempotencyRecordRepository;

  public IdempotencyFilter(IdempotencyRecordRepository idempotencyRecordRepository) {
    this.idempotencyRecordRepository = idempotencyRecordRepository;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    String key = request.getHeader(IDEMPOTENCY_HEADER);
    return !MUTATING_METHODS.contains(request.getMethod())
        || key == null
        || key.isBlank()
        || TenantContext.current().isEmpty();
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String key = request.getHeader(IDEMPOTENCY_HEADER);
    UUID tenantId = TenantContext.current().get().tenantId();
    ContentCachingRequestWrapper requestWrapper =
        new ContentCachingRequestWrapper(request, BODY_CACHE_LIMIT);
    String requestHash = requestHash(requestWrapper);

    Optional<IdempotencyRecord> existing =
        idempotencyRecordRepository.findByTenantIdAndIdempotencyKey(tenantId, key);
    if (existing.isPresent()) {
      replayOrConflict(existing.get(), requestHash, response);
      return;
    }

    IdempotencyRecord record = new IdempotencyRecord(tenantId, key, requestHash);
    try {
      idempotencyRecordRepository.save(record);
    } catch (DataIntegrityViolationException ex) {
      // Another request inserted the same (tenant, key) first. Re-read it and either replay the
      // committed result or reject an in-flight duplicate deterministically.
      Optional<IdempotencyRecord> raced =
          idempotencyRecordRepository.findByTenantIdAndIdempotencyKey(tenantId, key);
      if (raced.isPresent()) {
        replayOrConflict(raced.get(), requestHash, response);
      } else {
        writeConflict(response, "Idempotency-Key has already been used.");
      }
      return;
    }

    ContentCachingResponseWrapper wrapper = new ContentCachingResponseWrapper(response);
    try {
      filterChain.doFilter(requestWrapper, wrapper);
    } finally {
      byte[] body = wrapper.getContentAsByteArray();
      record.setResponse(
          wrapper.getStatus(), new String(body, StandardCharsets.UTF_8), wrapper.getContentType());
      idempotencyRecordRepository.save(record);
      wrapper.copyBodyToResponse();
    }
  }

  private void replayOrConflict(
      IdempotencyRecord record, String requestHash, HttpServletResponse response)
      throws IOException {
    if (record.getRequestHash() != null && !record.getRequestHash().equals(requestHash)) {
      writeConflict(response, "Idempotency-Key was reused with a different request payload.");
      return;
    }
    replay(record, response);
  }

  private void replay(IdempotencyRecord record, HttpServletResponse response) throws IOException {
    if (record.getResponseStatus() == 0) {
      writeConflict(response, "Idempotency-Key has already been used.");
      return;
    }
    response.setStatus(record.getResponseStatus());
    if (record.getResponseContentType() != null) {
      response.setContentType(record.getResponseContentType());
    }
    if (record.getResponseBody() != null) {
      response.getWriter().write(record.getResponseBody());
    }
  }

  private void writeConflict(HttpServletResponse response, String detail) throws IOException {
    response.setStatus(409);
    response.setContentType("application/problem+json");
    response
        .getWriter()
        .write(
            "{\"title\":\"Conflict\",\"status\":409,\"detail\":\""
                + detail.replace("\"", "'")
                + "\"}");
  }

  /**
   * SHA-256 of the method, path, query and body. Reading the body through the caching wrapper
   * leaves it readable for the downstream controller.
   */
  private static String requestHash(HttpServletRequest request) throws IOException {
    byte[] body = request.getInputStream().readAllBytes();
    String query = request.getQueryString();
    String canonical =
        request.getMethod()
            + "\n"
            + request.getRequestURI()
            + "\n"
            + (query == null ? "" : query)
            + "\n"
            + new String(body, StandardCharsets.UTF_8);
    return digest("SHA-256", canonical);
  }

  /**
   * Digest with a parameterized algorithm so the defensive branch (a JVM without the requested
   * digest) is exercised by a test instead of staying unreachable.
   */
  static String digest(String algorithm, String value) {
    try {
      MessageDigest messageDigest = MessageDigest.getInstance(algorithm);
      return HexFormat.of().formatHex(messageDigest.digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException(algorithm + " is not available", ex);
    }
  }
}
