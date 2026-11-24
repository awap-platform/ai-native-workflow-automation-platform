package com.awap.form.infrastructure;

import com.awap.form.domain.FormSchemaSnapshot;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for immutable form schema snapshots (issue #370). */
public interface FormSchemaSnapshotRepository extends JpaRepository<FormSchemaSnapshot, UUID> {

  Optional<FormSchemaSnapshot> findByFormIdAndVersionAndTenantId(
      UUID formId, int version, UUID tenantId);
}
