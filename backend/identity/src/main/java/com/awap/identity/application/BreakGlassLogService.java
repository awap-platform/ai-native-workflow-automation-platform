package com.awap.identity.application;

import com.awap.identity.interfaces.dto.BreakGlassLogResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;

/**
 * Read-only access to the committed break-glass governance log.
 *
 * <p>The log is the reviewed record in {@code settings/break-glass-log.json}. A build-time copy in
 * the backend resources makes it readable in the deployed container; a drift test keeps the copy
 * byte-identical to the reviewed source. A missing or unreadable resource reports {@code
 * available=false} so the console never implies that no exception exists.
 */
@Service
public class BreakGlassLogService {

  private final ObjectMapper objectMapper;
  private final Resource resource;

  @Autowired
  public BreakGlassLogService(ObjectMapper objectMapper) {
    this(objectMapper, new ClassPathResource("break-glass-log.json"));
  }

  BreakGlassLogService(ObjectMapper objectMapper, Resource resource) {
    this.objectMapper = objectMapper;
    this.resource = resource;
  }

  /** Reads the log; never throws, because the console renders the unavailable state itself. */
  public BreakGlassLogResponse read() {
    if (!resource.exists()) {
      return new BreakGlassLogResponse(false, null);
    }
    try (InputStream input = resource.getInputStream()) {
      return new BreakGlassLogResponse(true, objectMapper.readTree(input));
    } catch (IOException ex) {
      return new BreakGlassLogResponse(false, null);
    }
  }
}
