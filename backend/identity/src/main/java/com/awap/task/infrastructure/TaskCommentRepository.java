package com.awap.task.infrastructure;

import com.awap.task.domain.TaskComment;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for task comments. */
public interface TaskCommentRepository extends JpaRepository<TaskComment, UUID> {

  List<TaskComment> findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
      UUID tenantId, UUID taskId);

  Optional<TaskComment> findByIdAndTenantIdAndDeletedFalse(UUID id, UUID tenantId);
}
