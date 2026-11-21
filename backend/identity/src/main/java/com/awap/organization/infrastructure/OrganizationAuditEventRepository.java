package com.awap.organization.infrastructure;

import com.awap.organization.domain.OrganizationAuditEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Data access for the immutable organization audit trail. */
public interface OrganizationAuditEventRepository
    extends JpaRepository<OrganizationAuditEvent, UUID> {

  List<OrganizationAuditEvent> findByTenantIdOrderByCreatedAtDesc(UUID tenantId);

  /**
   * First page of the tenant audit trail. The composite index added in V61 keeps this ordered read
   * bounded regardless of how many rows the tenant has accumulated.
   */
  @Query(
      "select e from OrganizationAuditEvent e where e.tenantId = :tenantId"
          + " order by e.createdAt desc, e.id desc")
  List<OrganizationAuditEvent> firstPage(@Param("tenantId") UUID tenantId, Pageable pageable);

  /**
   * Keyset page strictly older than the supplied cursor. Offset pagination is deliberately avoided
   * so a million-row trail stays constant-time instead of scanning to the requested offset.
   */
  @Query(
      "select e from OrganizationAuditEvent e where e.tenantId = :tenantId"
          + " and (e.createdAt < :before or (e.createdAt = :before and e.id < :beforeId))"
          + " order by e.createdAt desc, e.id desc")
  List<OrganizationAuditEvent> pageBefore(
      @Param("tenantId") UUID tenantId,
      @Param("before") Instant before,
      @Param("beforeId") UUID beforeId,
      Pageable pageable);

  /** Export window query; the caller bounds the number of returned rows. */
  @Query(
      "select e from OrganizationAuditEvent e where e.tenantId = :tenantId"
          + " and e.createdAt >= :from and e.createdAt < :to"
          + " order by e.createdAt desc, e.id desc")
  List<OrganizationAuditEvent> exportWindow(
      @Param("tenantId") UUID tenantId,
      @Param("from") Instant from,
      @Param("to") Instant to,
      Pageable pageable);
}
