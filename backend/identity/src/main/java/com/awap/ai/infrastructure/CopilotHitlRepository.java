package com.awap.ai.infrastructure;

import com.awap.ai.domain.CopilotHitl;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tenant-scoped access to persisted HITL approvals. */
public interface CopilotHitlRepository extends JpaRepository<CopilotHitl, UUID> {

  List<CopilotHitl> findBySessionIdOrderByCreatedAtAsc(UUID sessionId);

  Optional<CopilotHitl> findByIdAndTenantId(UUID id, UUID tenantId);

  void deleteBySessionIdIn(Collection<UUID> sessionIds);
}
