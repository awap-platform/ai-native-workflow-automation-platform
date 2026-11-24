package com.awap.task.infrastructure;

import com.awap.task.domain.TaskAttachment;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for task attachment links. */
public interface TaskAttachmentRepository extends JpaRepository<TaskAttachment, UUID> {

  List<TaskAttachment> findByTenantIdAndTaskIdAndDeletedFalseOrderByCreatedAtAsc(
      UUID tenantId, UUID taskId);
}
