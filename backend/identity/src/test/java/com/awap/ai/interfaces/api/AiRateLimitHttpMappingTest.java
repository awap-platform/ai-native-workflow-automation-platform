package com.awap.ai.interfaces.api;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.common.api.GlobalExceptionHandler;
import com.awap.common.correlation.CorrelationIdFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * C4 HTTP contract: an AI rate-limit rejection is a 429 Problem Details response with a stable
 * error code and the correlation ID echoed back to the client.
 */
class AiRateLimitHttpMappingTest {

  @RestController
  private static final class RateLimitedController {

    @GetMapping("/api/v1/copilot/chat")
    String chat() {
      throw new AwapException(
          ErrorCode.QUOTA_EXCEEDED,
          HttpStatus.TOO_MANY_REQUESTS,
          "AI request rate limit exceeded for this tenant. Retry after the current window.");
    }
  }

  @Test
  void aiRateLimitMapsTo429WithStableCodeAndCorrelationId() throws Exception {
    MockMvc mockMvc =
        MockMvcBuilders.standaloneSetup(new RateLimitedController())
            .setControllerAdvice(new GlobalExceptionHandler())
            .addFilters(new CorrelationIdFilter())
            .build();

    mockMvc
        .perform(get("/api/v1/copilot/chat").header("X-Correlation-Id", "corr-429"))
        .andExpect(status().isTooManyRequests())
        .andExpect(header().string("X-Correlation-Id", "corr-429"))
        .andExpect(jsonPath("$.status").value(429))
        .andExpect(jsonPath("$.code").value(ErrorCode.QUOTA_EXCEEDED.code()))
        .andExpect(jsonPath("$.detail").value(containsString("rate limit")))
        .andExpect(jsonPath("$.detail").value(containsString("Retry")));
  }
}
