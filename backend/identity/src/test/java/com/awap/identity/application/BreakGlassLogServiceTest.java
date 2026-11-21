package com.awap.identity.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;

class BreakGlassLogServiceTest {

  private final ObjectMapper objectMapper = new ObjectMapper();

  @Test
  void readsTheCommitResource() {
    BreakGlassLogService service =
        new BreakGlassLogService(objectMapper, new ClassPathResource("break-glass-log.json"));

    var response = service.read();

    assertThat(response.available()).isTrue();
    assertThat(response.log().get("incident").asInt()).isEqualTo(257);
    assertThat(response.log().get("merges").isArray()).isTrue();
  }

  @Test
  void reportsAMissingResourceAsUnavailable() {
    BreakGlassLogService service =
        new BreakGlassLogService(objectMapper, new ClassPathResource("missing-break-glass.json"));

    var response = service.read();

    assertThat(response.available()).isFalse();
    assertThat(response.log()).isNull();
  }

  @Test
  void reportsAnUnreadableResourceAsUnavailable() throws IOException {
    Resource resource = mock(Resource.class);
    when(resource.exists()).thenReturn(true);
    when(resource.getInputStream()).thenThrow(new IOException("disk error"));

    var response = new BreakGlassLogService(objectMapper, resource).read();

    assertThat(response.available()).isFalse();
  }

  @Test
  void theBackendCopyMatchesTheCommittedGovernanceLog() throws IOException {
    Path root = Path.of(System.getProperty("user.dir")).toAbsolutePath();
    Path settings = null;
    for (int depth = 0; depth < 5 && settings == null; depth++) {
      Path candidate = root.resolve("settings/break-glass-log.json");
      if (Files.exists(candidate)) {
        settings = candidate;
      } else {
        root = root.getParent();
        if (root == null) {
          break;
        }
      }
    }
    assertThat(settings).as("settings/break-glass-log.json must be reachable").isNotNull();

    try (InputStream backend = new ClassPathResource("break-glass-log.json").getInputStream()) {
      assertThat(backend.readAllBytes())
          .as("the container copy must match the reviewed settings/break-glass-log.json")
          .isEqualTo(Files.readAllBytes(settings));
    }
  }
}
