package com.awap.workflow.infrastructure;

import com.awap.workflow.domain.TransitionDefinition;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for workflow transition definitions. */
public interface TransitionDefinitionRepository extends JpaRepository<TransitionDefinition, UUID> {

  List<TransitionDefinition> findByWorkflowVersionIdAndFromNodeId(
      UUID workflowVersionId, String fromNodeId);

  List<TransitionDefinition> findByWorkflowVersionId(UUID workflowVersionId);

  /** Replaces the persisted graph when a draft is updated in place (issue #369). */
  void deleteByWorkflowVersionId(UUID workflowVersionId);
}
