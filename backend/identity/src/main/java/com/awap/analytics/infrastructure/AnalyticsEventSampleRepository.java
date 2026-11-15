package com.awap.analytics.infrastructure;

import com.awap.analytics.domain.AnalyticsEventSample;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tenant-scoped access to the bounded raw analytics event samples (issue #285). */
public interface AnalyticsEventSampleRepository extends JpaRepository<AnalyticsEventSample, UUID> {

  List<AnalyticsEventSample>
      findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
          UUID tenantId, Instant fromInclusive, Instant toExclusive);

  long deleteByOccurredAtBefore(Instant cutoff);
}
