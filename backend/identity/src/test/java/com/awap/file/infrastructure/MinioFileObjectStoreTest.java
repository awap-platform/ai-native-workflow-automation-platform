package com.awap.file.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.file.domain.FileStorageException;
import io.minio.ComposeObjectArgs;
import io.minio.MinioClient;
import io.minio.StatObjectArgs;
import io.minio.StatObjectResponse;
import java.util.List;
import okhttp3.Headers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Unit proof for the resumable-upload additions to the MinIO adapter (issue #372): the size probe
 * that verifies a part and the server-side compose that assembles them.
 */
class MinioFileObjectStoreTest {

  private final MinioClient client = mock(MinioClient.class);
  private MinioFileObjectStore store;

  @BeforeEach
  void setUp() {
    store = new MinioFileObjectStore(client, client);
  }

  @Test
  void statSizeReturnsTheStoredLength() throws Exception {
    StatObjectResponse response =
        new StatObjectResponse(
            new Headers.Builder()
                .add("Content-Length", "42")
                .add("Last-Modified", "Wed, 01 Jan 2025 00:00:00 GMT")
                .build(),
            "awap-quarantine",
            "us-east-1",
            "tenant/file/part-1");
    when(client.statObject(any(StatObjectArgs.class))).thenReturn(response);

    assertThat(store.statSize("awap-quarantine", "tenant/file/part-1")).isEqualTo(42);
  }

  @Test
  void statSizeWrapsStorageFailures() throws Exception {
    when(client.statObject(any(StatObjectArgs.class))).thenThrow(new RuntimeException("boom"));

    assertThatThrownBy(() -> store.statSize("awap-quarantine", "missing"))
        .isInstanceOf(FileStorageException.class)
        .hasMessageContaining("Could not stat object");
  }

  @Test
  void composeAssemblesThePartsServerSide() throws Exception {
    store.compose("awap-quarantine", "tenant/file/report.pdf", List.of("a", "b", "c"));

    verify(client).composeObject(any(ComposeObjectArgs.class));
  }

  @Test
  void composeRejectsAnEmptyPartList() {
    assertThatThrownBy(() -> store.compose("awap-quarantine", "target", List.of()))
        .isInstanceOf(FileStorageException.class)
        .hasMessageContaining("empty object list");
  }

  @Test
  void composeWrapsStorageFailures() throws Exception {
    when(client.composeObject(any(ComposeObjectArgs.class)))
        .thenThrow(new RuntimeException("boom"));

    assertThatThrownBy(() -> store.compose("awap-quarantine", "target", List.of("a")))
        .isInstanceOf(FileStorageException.class)
        .hasMessageContaining("Could not compose");
  }
}
