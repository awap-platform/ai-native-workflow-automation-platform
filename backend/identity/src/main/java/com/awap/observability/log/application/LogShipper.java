package com.awap.observability.log.application;

import com.awap.observability.log.domain.LogEvent;

/** Bounded, asynchronous transport for structured operational logs (issue #286). */
public interface LogShipper {

  void ship(LogEvent event);

  int queueDepth();
}
