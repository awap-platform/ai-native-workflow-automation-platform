package com.awap.observability.log.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import com.awap.common.correlation.CorrelationId;
import com.awap.observability.log.application.LogShipper;
import com.awap.observability.log.domain.LogEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.MDC;

class LogbackOpenSearchAppenderTest {

  private final LogbackOpenSearchAppender appender = new LogbackOpenSearchAppender();
  private final LogShipper shipper = mock(LogShipper.class);

  @AfterEach
  void clear() {
    LogbackOpenSearchAppender.install(null);
    MDC.clear();
  }

  private ILoggingEvent event() {
    ILoggingEvent event = mock(ILoggingEvent.class);
    when(event.getLevel()).thenReturn(Level.WARN);
    when(event.getLoggerName()).thenReturn("awap.test");
    when(event.getFormattedMessage()).thenReturn("contact ada@example.com");
    when(event.getTimeStamp()).thenReturn(1_700_000_000_000L);
    return event;
  }

  @Test
  void forwardsATenantScopedEventWithItsCorrelationAndTraceIds() {
    LogbackOpenSearchAppender.install(shipper);
    MDC.put(LogbackOpenSearchAppender.TENANT_MDC_KEY, "tenant-1");
    MDC.put("service", "awap-backend");
    MDC.put(CorrelationId.MDC_KEY, "corr-1");
    MDC.put(LogbackOpenSearchAppender.TRACE_MDC_KEY, "trace-1");

    appender.append(event());

    ArgumentCaptor<LogEvent> captor = ArgumentCaptor.forClass(LogEvent.class);
    verify(shipper).ship(captor.capture());
    LogEvent shipped = captor.getValue();
    assertThat(shipped.tenantId()).isEqualTo("tenant-1");
    assertThat(shipped.service()).isEqualTo("awap-backend");
    assertThat(shipped.level()).isEqualTo("WARN");
    assertThat(shipped.correlationId()).isEqualTo("corr-1");
    assertThat(shipped.traceId()).isEqualTo("trace-1");
  }

  @Test
  void staysInertWithoutAShipperOrTenant() {
    appender.append(event());
    verify(shipper, never()).ship(org.mockito.ArgumentMatchers.any());

    LogbackOpenSearchAppender.install(shipper);
    appender.append(event());
    verify(shipper, never()).ship(org.mockito.ArgumentMatchers.any());

    appender.append(null);
    assertThat(LogbackOpenSearchAppender.installedShipper()).isSameAs(shipper);
  }
}
