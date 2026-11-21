package com.awap.analytics.infrastructure;

import com.awap.analytics.domain.AnalyticsEventSample;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Tenant-scoped access to the bounded raw analytics event samples (issue #285). */
public interface AnalyticsEventSampleRepository extends JpaRepository<AnalyticsEventSample, UUID> {

  List<AnalyticsEventSample>
      findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThanOrderByOccurredAtAsc(
          UUID tenantId, Instant fromInclusive, Instant toExclusive);

  Page<AnalyticsEventSample> findByTenantIdAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
      UUID tenantId, Instant fromInclusive, Instant toExclusive, Pageable pageable);

  Page<AnalyticsEventSample>
      findByTenantIdAndEventTypeAndOccurredAtGreaterThanEqualAndOccurredAtLessThan(
          UUID tenantId,
          String eventType,
          Instant fromInclusive,
          Instant toExclusive,
          Pageable pageable);

  long deleteByOccurredAtBefore(Instant cutoff);
}
