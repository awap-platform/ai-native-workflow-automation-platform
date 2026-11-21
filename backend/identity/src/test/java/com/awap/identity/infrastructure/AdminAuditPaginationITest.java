package com.awap.identity.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * T8-08: a million-row audit trail still pages in under a second.
 *
 * <p>The production query is keyset pagination on an immutable {@code (created_at, id)} cursor. The
 * test inserts 1,000,000 rows for one tenant, resolves a cursor in the middle of the trail with an
 * offset once, and then measures the exact keyset page the API serves. A deep OFFSET page would
 * scan half the table; the composite index added in V61 keeps the keyset page constant-time.
 */
@Testcontainers(disabledWithoutDocker = true)
class AdminAuditPaginationITest {

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine").withDatabaseName("awap");

  private static final int ROWS = 1_000_000;

  @BeforeAll
  static void migrateAndSeed() {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .locations("classpath:db/migration")
        .load()
        .migrate();
  }

  @Test
  void oneMillionAuditRowsPageUnderOneSecond() throws Exception {
    UUID tenant = UUID.randomUUID();
    try (Connection connection = connection()) {
      try (PreparedStatement insert =
          connection.prepareStatement(
              "INSERT INTO organization_audit_events"
                  + " (id, tenant_id, entity_type, entity_id, action, created_at)"
                  + " SELECT gen_random_uuid(), ?, 'USER', gen_random_uuid(), 'ROLE_CHANGED',"
                  + " TIMESTAMPTZ '2026-01-01 00:00:00+00' + (g || ' seconds')::interval"
                  + " FROM generate_series(1, "
                  + ROWS
                  + ") AS g")) {
        insert.setObject(1, tenant);
        insert.executeUpdate();
      }
      try (var statement = connection.createStatement()) {
        statement.execute("ANALYZE organization_audit_events");
      }

      Cursor cursor = readCursorAt(connection, tenant, 500_000);

      long firstPageStart = System.nanoTime();
      int firstPageRows = countPage(connection, tenant, null, null, 26);
      long firstPageMs = Duration.ofNanos(System.nanoTime() - firstPageStart).toMillis();

      long deepPageStart = System.nanoTime();
      int deepPageRows = countPage(connection, tenant, cursor.createdAt(), cursor.id(), 26);
      long deepPageMs = Duration.ofNanos(System.nanoTime() - deepPageStart).toMillis();

      assertThat(firstPageRows).isEqualTo(26);
      assertThat(deepPageRows).isEqualTo(26);
      assertThat(firstPageMs)
          .as("first audit page must render under 1s with 1M rows")
          .isLessThan(1_000);
      assertThat(deepPageMs)
          .as("a mid-trail audit keyset page must render under 1s with 1M rows")
          .isLessThan(1_000);
    }
  }

  private static int countPage(
      Connection connection, UUID tenant, Instant before, UUID beforeId, int limit)
      throws Exception {
    String sql =
        before == null
            ? "SELECT id FROM organization_audit_events WHERE tenant_id = ?"
                + " ORDER BY created_at DESC, id DESC LIMIT ?"
            : "SELECT id FROM organization_audit_events WHERE tenant_id = ?"
                + " AND (created_at < ? OR (created_at = ? AND id < ?))"
                + " ORDER BY created_at DESC, id DESC LIMIT ?";
    try (PreparedStatement query = connection.prepareStatement(sql)) {
      int index = 1;
      query.setObject(index++, tenant);
      if (before != null) {
        Timestamp timestamp = Timestamp.from(before);
        query.setTimestamp(index++, timestamp);
        query.setTimestamp(index++, timestamp);
        query.setObject(index++, beforeId);
      }
      query.setInt(index, limit);
      int count = 0;
      try (ResultSet rows = query.executeQuery()) {
        while (rows.next()) {
          count++;
        }
      }
      return count;
    }
  }

  private static Cursor readCursorAt(Connection connection, UUID tenant, int offset)
      throws Exception {
    try (PreparedStatement query =
        connection.prepareStatement(
            "SELECT created_at, id FROM organization_audit_events WHERE tenant_id = ?"
                + " ORDER BY created_at DESC, id DESC OFFSET ? LIMIT 1")) {
      query.setObject(1, tenant);
      query.setInt(2, offset);
      try (ResultSet row = query.executeQuery()) {
        assertThat(row.next()).isTrue();
        return new Cursor(
            row.getTimestamp("created_at").toInstant(), row.getObject("id", UUID.class));
      }
    }
  }

  private static Connection connection() throws Exception {
    return DriverManager.getConnection(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
  }

  private record Cursor(Instant createdAt, UUID id) {}
}
