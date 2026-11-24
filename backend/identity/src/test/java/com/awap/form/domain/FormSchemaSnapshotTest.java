package com.awap.form.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Covers the JPA no-arg constructor and getters of the immutable schema snapshot (#370). */
class FormSchemaSnapshotTest {

  @Test
  void jpaConstructorAndGettersAreAvailable() {
    FormSchemaSnapshot empty = new FormSchemaSnapshot();
    assertThat(empty).isNotNull();

    UUID tenantId = UUID.randomUUID();
    UUID formId = UUID.randomUUID();
    FormSchemaSnapshot snapshot =
        new FormSchemaSnapshot(tenantId, formId, 3, "{\"fields\":[]}", "a".repeat(64));

    assertThat(snapshot.getTenantId()).isEqualTo(tenantId);
    assertThat(snapshot.getFormId()).isEqualTo(formId);
    assertThat(snapshot.getVersion()).isEqualTo(3);
    assertThat(snapshot.getSchemaHash()).isEqualTo("a".repeat(64));
    assertThat(snapshot.getCreatedAt()).isNotNull();
  }
}
