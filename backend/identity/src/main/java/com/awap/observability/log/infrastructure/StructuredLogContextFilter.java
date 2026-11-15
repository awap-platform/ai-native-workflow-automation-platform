package com.awap.observability.log.infrastructure;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Adds the {@code service} and {@code tenantId} MDC fields required by the log document schema
 * (issue #286). The correlation ID is owned by {@link
 * com.awap.common.correlation.CorrelationIdFilter}; this filter only enriches the same request
 * thread and always removes its entries.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class StructuredLogContextFilter extends OncePerRequestFilter {

  private final String service;

  public StructuredLogContextFilter(
      @Value("${spring.application.name:awap-identity}") String service) {
    this.service = service;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    MDC.put("service", service);
    String tenantId = request.getHeader("X-Tenant-Id");
    if (tenantId != null && !tenantId.isBlank()) {
      MDC.put(LogbackOpenSearchAppender.TENANT_MDC_KEY, tenantId);
    }
    try {
      chain.doFilter(request, response);
    } finally {
      MDC.remove("service");
      MDC.remove(LogbackOpenSearchAppender.TENANT_MDC_KEY);
    }
  }
}
