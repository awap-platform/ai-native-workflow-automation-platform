package com.awap.observability.log.infrastructure;

import com.awap.observability.log.application.LogShipper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Installs the shipped log path after the application context is ready (issue #286).
 *
 * <p>Logback creates the appender, Spring owns the shipper. Keeping the wiring here means the
 * appender never needs a Spring-aware constructor and a disabled shipper leaves it inert.
 */
@Component
public class LogAppenderInstaller {

  private final ObjectProvider<LogShipper> shipper;

  public LogAppenderInstaller(ObjectProvider<LogShipper> shipper) {
    this.shipper = shipper;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void install() {
    LogbackOpenSearchAppender.install(shipper.getIfAvailable());
  }
}
