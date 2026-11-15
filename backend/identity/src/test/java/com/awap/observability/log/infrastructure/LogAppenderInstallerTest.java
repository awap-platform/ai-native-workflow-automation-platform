package com.awap.observability.log.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.awap.observability.log.application.LogShipper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class LogAppenderInstallerTest {

  @AfterEach
  void clear() {
    LogbackOpenSearchAppender.install(null);
  }

  @Test
  void installsTheAvailableShipper() {
    LogShipper shipper = mock(LogShipper.class);
    @SuppressWarnings("unchecked")
    ObjectProvider<LogShipper> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(shipper);

    new LogAppenderInstaller(provider).install();

    assertThat(LogbackOpenSearchAppender.installedShipper()).isSameAs(shipper);
  }

  @Test
  void installsNullWhenShippingIsDisabled() {
    @SuppressWarnings("unchecked")
    ObjectProvider<LogShipper> provider = mock(ObjectProvider.class);
    when(provider.getIfAvailable()).thenReturn(null);

    new LogAppenderInstaller(provider).install();

    assertThat(LogbackOpenSearchAppender.installedShipper()).isNull();
  }
}
