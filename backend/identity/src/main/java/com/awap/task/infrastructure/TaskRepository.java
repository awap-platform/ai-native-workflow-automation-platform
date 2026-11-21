package com.awap.task.infrastructure;

import com.awap.task.domain.Task;
import com.awap.task.domain.TaskStatus;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Data access for tasks. */
public interface TaskRepository extends JpaRepository<Task, UUID> {

  List<Task> findByTenantIdAndDeletedFalse(UUID tenantId);

  long countByTenantIdAndDeletedFalse(UUID tenantId);

  long countByTenantIdAndStatusAndDeletedFalse(UUID tenantId, TaskStatus status);

  List<Task> findByTenantIdAndAssigneeIdAndDeletedFalse(UUID tenantId, UUID assigneeId);

  Optional<Task> findByIdAndTenantIdAndDeletedFalse(UUID id, UUID tenantId);

  Optional<Task> findFirstByTenantIdAndNodeExecutionIdAndDeletedFalse(
      UUID tenantId, UUID nodeExecutionId);

  @Query(
      """
      SELECT t FROM Task t
      WHERE t.escalateAt IS NOT NULL
        AND t.escalateAt < :now
        AND t.escalated = false
        AND t.status IN :openStatuses
        AND t.deleted = false
      """)
  List<Task> findDueForEscalation(
      @Param("now") Instant now, @Param("openStatuses") List<TaskStatus> openStatuses);
}
