package com.awap.ai.infrastructure;

import com.awap.ai.domain.CopilotTurn;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Append-only access to Copilot turns. */
public interface CopilotTurnRepository extends JpaRepository<CopilotTurn, UUID> {

  List<CopilotTurn> findBySessionIdOrderBySequenceAsc(UUID sessionId);

  Optional<CopilotTurn> findFirstBySessionIdOrderBySequenceDesc(UUID sessionId);

  Optional<CopilotTurn> findBySessionIdAndIdempotencyKey(UUID sessionId, String idempotencyKey);

  void deleteBySessionIdIn(Collection<UUID> sessionIds);
}
