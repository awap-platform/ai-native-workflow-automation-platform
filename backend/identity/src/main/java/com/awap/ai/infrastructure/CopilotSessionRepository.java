package com.awap.ai.infrastructure;

import com.awap.ai.domain.CopilotSession;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tenant-scoped access to persisted Copilot sessions (issue #373). */
public interface CopilotSessionRepository extends JpaRepository<CopilotSession, UUID> {

  Optional<CopilotSession> findByIdAndTenantId(UUID id, UUID tenantId);

  Page<CopilotSession> findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(
      UUID tenantId, Pageable pageable);

  List<CopilotSession> findByTenantIdAndArchivedFalseOrderByUpdatedAtDesc(UUID tenantId);

  List<CopilotSession> findByExpiresAtBefore(Instant cutoff);

  void deleteByIdIn(Collection<UUID> ids);
}
