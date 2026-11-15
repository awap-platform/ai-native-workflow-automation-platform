package com.awap.observability.log.application;

import com.awap.observability.log.domain.LogEvent;
import java.util.List;

/** Explicit availability signal plus tenant-scoped log entries. */
public record LogSearchResult(boolean available, long total, List<LogEvent> logs) {

  public static LogSearchResult unavailable() {
    return new LogSearchResult(false, 0, List.of());
  }
}
