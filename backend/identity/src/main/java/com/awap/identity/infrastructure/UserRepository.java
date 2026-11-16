package com.awap.identity.infrastructure;

import com.awap.identity.domain.Role;
import com.awap.identity.domain.User;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

  Optional<User> findByTenantIdAndEmail(UUID tenantId, String email);

  long countByTenantIdAndDeletedFalse(UUID tenantId);

  Optional<User> findByIdAndTenantId(UUID id, UUID tenantId);

  Optional<User> findFirstByTenantIdAndRole(UUID tenantId, Role role);

  /**
   * Tenant-scoped user resolution for the Copilot assign/notify actions (issue #297). The query is
   * deliberately tenant-scoped and never returns a user from another tenant. Callers must treat a
   * multi-match result as ambiguous and ask for an explicit id instead of guessing.
   */
  @Query(
      "SELECT u FROM User u WHERE u.tenantId = :tenantId AND u.deleted = false "
          + "AND (LOWER(u.email) LIKE LOWER(CONCAT('%', :query, '%')) "
          + "OR LOWER(u.fullName) LIKE LOWER(CONCAT('%', :query, '%'))) "
          + "ORDER BY u.fullName")
  List<User> searchByTenantId(@Param("tenantId") UUID tenantId, @Param("query") String query);

  @org.springframework.data.jpa.repository.Query(
      value = "SELECT * FROM awap_find_user_by_email(:tenantId, :email)",
      nativeQuery = true)
  Optional<User> findByTenantIdAndEmailRls(UUID tenantId, String email);

  @org.springframework.data.jpa.repository.Query(
      value = "SELECT awap_count_tenant_users(:tenantId)",
      nativeQuery = true)
  long countByTenantIdAndDeletedFalseRls(UUID tenantId);

  /** Records a failed login via the SECURITY DEFINER helper (RLS-bypassing write). */
  @org.springframework.data.jpa.repository.Query(
      value = "SELECT awap_record_failed_login(:userId)",
      nativeQuery = true)
  void recordFailedLogin(UUID userId);

  /** Resets the failed-login counter via the SECURITY DEFINER helper. */
  @org.springframework.data.jpa.repository.Query(
      value = "SELECT awap_reset_failed_login(:userId)",
      nativeQuery = true)
  void resetFailedLogin(UUID userId);
}
