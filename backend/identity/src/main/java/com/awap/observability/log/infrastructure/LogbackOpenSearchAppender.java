package com.awap.observability.log.infrastructure;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.awap.common.correlation.CorrelationId;
import com.awap.observability.log.application.LogShipper;
import com.awap.observability.log.domain.LogEvent;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.MDC;

/**
 * Logback bridge that forwards JSON log events to the bounded OpenSearch shipper (issue #286).
 *
 * <p>The appender is always attached to the root logger but stays a no-op until Spring installs a
 * shipper, so a deployment with log shipping disabled keeps the console-only behaviour. An event
 * without a tenant is never indexed: tenant-scoped search must not contain unscoped rows.
 */
public class LogbackOpenSearchAppender extends AppenderBase<ILoggingEvent> {

  /** MDC key written by {@link StructuredLogContextFilter}. */
  public static final String TENANT_MDC_KEY = "tenantId";

  public static final String TRACE_MDC_KEY = "traceId";

  private static final AtomicReference<LogShipper> SHIPPER = new AtomicReference<>();

  public static void install(LogShipper shipper) {
    SHIPPER.set(shipper);
  }

  public static LogShipper installedShipper() {
    return SHIPPER.get();
  }

  @Override
  protected void append(ILoggingEvent event) {
    LogShipper shipper = SHIPPER.get();
    if (shipper == null || event == null) {
      return;
    }
    String tenantId = MDC.get(TENANT_MDC_KEY);
    if (tenantId == null || tenantId.isBlank()) {
      return;
    }
    shipper.ship(
        new LogEvent(
            tenantId,
            MDC.get("service"),
            event.getLevel().toString(),
            event.getLoggerName(),
            event.getFormattedMessage(),
            MDC.get(CorrelationId.MDC_KEY),
            MDC.get(TRACE_MDC_KEY),
            Instant.ofEpochMilli(event.getTimeStamp())));
  }
}
