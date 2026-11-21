package com.awap.engine.infrastructure;

import com.awap.engine.domain.WorkflowInstance;
import com.awap.engine.domain.WorkflowState;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for workflow instances. */
public interface WorkflowInstanceRepository extends JpaRepository<WorkflowInstance, UUID> {

  List<WorkflowInstance> findByTenantIdAndDeletedFalseOrderByCreatedAtDesc(UUID tenantId);

  long countByTenantIdAndDeletedFalse(UUID tenantId);

  long countByTenantIdAndStateAndDeletedFalse(UUID tenantId, WorkflowState state);

  Optional<WorkflowInstance> findByIdAndTenantIdAndDeletedFalse(UUID id, UUID tenantId);

  Optional<WorkflowInstance> findByTenantIdAndIdempotencyKey(UUID tenantId, String idempotencyKey);
}
