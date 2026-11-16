package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.awap.ai.application.AiBudgetStore;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Proves the durable AI budget ledger against real PostgreSQL (issue #301). */
@Testcontainers(disabledWithoutDocker = true)
class AiBudgetPostgresTest {

  @Container
  static final PostgreSQLContainer<?> POSTGRES =
      new PostgreSQLContainer<>("postgres:16-alpine")
          .withDatabaseName("awap")
          .withCommand("postgres", "-c", "max_connections=200");

  private static final LocalDate PERIOD = LocalDate.of(2026, 3, 1);

  @BeforeAll
  static void migrate() {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .locations("classpath:db/migration")
        .load()
        .migrate();
  }

  @Test
  void aRecreatedStoreReadsTheSameDurableLedger() throws Exception {
    UUID tenant = UUID.randomUUID();
    try (Connection app = app()) {
      setTenant(app, tenant);
      SingleConnectionDataSource ds = new SingleConnectionDataSource(app, true);
      JdbcAiBudgetStore first = new JdbcAiBudgetStore(new JdbcTemplate(ds));

      AiBudgetStore.ReservationResult reserved =
          first.reserve("restart-1", tenant, PERIOD, 60, 100);
      assertThat(reserved.outcome()).isEqualTo(AiBudgetStore.ReservationOutcome.RESERVED);

      JdbcAiBudgetStore second = new JdbcAiBudgetStore(new JdbcTemplate(ds));
      assertThat(second.snapshot(tenant, PERIOD, 100).usedTokens()).isEqualTo(60);
      assertThat(second.reserve("restart-2", tenant, PERIOD, 40, 100).outcome())
          .isEqualTo(AiBudgetStore.ReservationOutcome.RESERVED);
      assertThat(second.reserve("restart-3", tenant, PERIOD, 1, 100).outcome())
          .isEqualTo(AiBudgetStore.ReservationOutcome.EXCEEDED);
      assertThat(second.snapshot(UUID.randomUUID(), PERIOD, 100).usedTokens()).isZero();

      second.reset(tenant, PERIOD);
      assertThat(second.snapshot(tenant, PERIOD, 100).usedTokens()).isZero();
    }
  }

  @Test
  void duplicateEventKeyAndRefundReconciliationAreIdempotent() throws Exception {
    UUID tenant = UUID.randomUUID();
    try (Connection app = app()) {
      setTenant(app, tenant);
      JdbcAiBudgetStore store =
          new JdbcAiBudgetStore(new JdbcTemplate(new SingleConnectionDataSource(app, true)));

      assertThat(store.reserve("dup", tenant, PERIOD, 100, 200).outcome())
          .isEqualTo(AiBudgetStore.ReservationOutcome.RESERVED);
      assertThat(store.reserve("dup", tenant, PERIOD, 100, 200).outcome())
          .isEqualTo(AiBudgetStore.ReservationOutcome.DUPLICATE);
      assertThat(store.snapshot(tenant, PERIOD, 200).usedTokens()).isEqualTo(100);

      assertThat(store.refund("refund-1", tenant, PERIOD, 30)).isEqualTo(70);
      assertThat(store.refund("refund-1", tenant, PERIOD, 30)).isEqualTo(70);
      assertThat(store.reconcile(tenant, PERIOD, 100, 40)).isEqualTo(10);
    }
  }

  @Test
  void concurrentReplicasAtTheBoundaryAllowExactlyTheLimit() throws Exception {
    UUID tenant = UUID.randomUUID();
    int attempts = 40;
    long limit = 10;
    ExecutorService pool = Executors.newFixedThreadPool(attempts);
    CountDownLatch start = new CountDownLatch(1);
    ConcurrentLinkedQueue<Long> results = new ConcurrentLinkedQueue<>();

    try {
      for (int index = 0; index < attempts; index++) {
        String key = "concurrent-" + index;
        pool.submit(
            () -> {
              try (Connection app = app()) {
                setTenant(app, tenant);
                start.await(30, TimeUnit.SECONDS);
                results.add(reserve(app, key, tenant, 1, limit));
              } catch (Exception ex) {
                throw new IllegalStateException(ex);
              }
            });
      }
      start.countDown();
      pool.shutdown();
      assertThat(pool.awaitTermination(120, TimeUnit.SECONDS)).isTrue();
    } finally {
      pool.shutdownNow();
    }

    assertThat(results).hasSize(attempts);
    assertThat(results.stream().filter(value -> value > 0).count()).isEqualTo(limit);
    assertThat(results.stream().filter(value -> value == -1L).count()).isEqualTo(attempts - limit);
  }

  @Test
  void rlsHidesAnotherTenantsLedger() throws Exception {
    UUID tenantA = UUID.randomUUID();
    UUID tenantB = UUID.randomUUID();
    try (Connection app = app()) {
      setTenant(app, tenantA);
      reserve(app, "rls-a", tenantA, 50, 100);
    }
    try (Connection app = app()) {
      setTenant(app, tenantB);
      try (PreparedStatement ps =
          app.prepareStatement("SELECT count(*) FROM ai_budget_usage WHERE tenant_id = ?")) {
        ps.setObject(1, tenantA);
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          assertThat(rs.getLong(1)).isZero();
        }
      }
    }
  }

  private static Connection app() throws SQLException {
    return DriverManager.getConnection(POSTGRES.getJdbcUrl(), "awap_app", "awap_app");
  }

  private static void setTenant(Connection connection, UUID tenant) throws SQLException {
    try (Statement stmt = connection.createStatement()) {
      stmt.execute("SET awap.tenant_id = '" + tenant + "'");
    }
  }

  private static long reserve(
      Connection connection, String eventKey, UUID tenant, long tokens, long limit)
      throws SQLException {
    try (PreparedStatement ps =
        connection.prepareStatement("SELECT awap_ai_budget_reserve(?, ?, ?, ?, ?)")) {
      ps.setString(1, eventKey);
      ps.setObject(2, tenant);
      ps.setObject(3, PERIOD);
      ps.setLong(4, tokens);
      ps.setLong(5, limit);
      try (ResultSet rs = ps.executeQuery()) {
        rs.next();
        return rs.getLong(1);
      }
    }
  }
}
