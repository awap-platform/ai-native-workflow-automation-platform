package com.awap.observability.log.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class StructuredLogContextFilterTest {

  private final StructuredLogContextFilter filter = new StructuredLogContextFilter("awap-identity");

  @Test
  void addsAndRemovesTheServiceAndTenantFields() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader("X-Tenant-Id", "tenant-1");
    filter.doFilter(
        request,
        new MockHttpServletResponse(),
        (servletRequest, servletResponse) -> {
          assertThat(MDC.get("service")).isEqualTo("awap-identity");
          assertThat(MDC.get(LogbackOpenSearchAppender.TENANT_MDC_KEY)).isEqualTo("tenant-1");
        });
    assertThat(MDC.get("service")).isNull();
    assertThat(MDC.get(LogbackOpenSearchAppender.TENANT_MDC_KEY)).isNull();
  }

  @Test
  void leavesTheTenantUnsetWhenTheHeaderIsAbsent() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, new MockHttpServletResponse(), chain);

    assertThat(MDC.get(LogbackOpenSearchAppender.TENANT_MDC_KEY)).isNull();
  }
}
