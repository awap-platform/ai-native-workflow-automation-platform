package com.awap.identity.infrastructure.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.identity.domain.IdempotencyRecord;
import com.awap.identity.infrastructure.IdempotencyRecordRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * Verifies idempotency-key handling: method gating, replay, payload binding and race behavior
 * (issue #283).
 */
class IdempotencyFilterTest {

  private IdempotencyRecordRepository repository;
  private IdempotencyFilter filter;
  private UUID tenantId;

  @BeforeEach
  void setUp() {
    repository = mock(IdempotencyRecordRepository.class);
    filter = new IdempotencyFilter(repository);
    tenantId = UUID.randomUUID();
    TenantContext.set(tenantId, UUID.randomUUID(), "TENANT_ADMIN");
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  void skipsNonMutatingMethods() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/tasks");
    request.addHeader("Idempotency-Key", "key-1");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    verify(repository, never()).findByTenantIdAndIdempotencyKey(any(), any());
    assertThat(chain.getRequest()).isNotNull();
  }

  @Test
  void skipsWhenKeyIsBlank() throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks");
    request.addHeader("Idempotency-Key", "   ");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    verify(repository, never()).findByTenantIdAndIdempotencyKey(any(), any());
  }

  @Test
  void replaysPreviousResponseForDuplicateKey() throws Exception {
    IdempotencyRecord existing = new IdempotencyRecord(tenantId, "key-1");
    existing.setResponse(201, "{\"created\":true}", "application/json");
    when(repository.findByTenantIdAndIdempotencyKey(tenantId, "key-1"))
        .thenReturn(Optional.of(existing));

    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks");
    request.addHeader("Idempotency-Key", "key-1");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(response.getStatus()).isEqualTo(201);
    assertThat(response.getContentAsString()).contains("created");
    assertThat(chain.getRequest()).isNull(); // downstream not invoked on replay
  }

  @Test
  void cachesResponseOnFirstRequest() throws Exception {
    when(repository.findByTenantIdAndIdempotencyKey(tenantId, "key-1"))
        .thenReturn(Optional.empty());
    when(repository.save(any(IdempotencyRecord.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));

    MockHttpServletRequest request = request("key-1", "{\"message\":\"start\"}");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(chain.getRequest()).isNotNull();
    verify(repository, times(2)).save(any(IdempotencyRecord.class));
  }

  @Test
  void storesTheRequestHashOnTheFirstRequest() throws Exception {
    Map<String, IdempotencyRecord> store = new ConcurrentHashMap<>();
    stubInMemoryRepository(store);

    perform("key-1", "{\"message\":\"start\"}", new AtomicInteger(), new MockHttpServletResponse());

    IdempotencyRecord record = store.get(tenantId + "|key-1");
    assertThat(record).isNotNull();
    assertThat(record.getRequestHash()).hasSize(64);
  }

  @Test
  void replaysWhenThePayloadIsIdentical() throws Exception {
    Map<String, IdempotencyRecord> store = new ConcurrentHashMap<>();
    stubInMemoryRepository(store);
    AtomicInteger downstream = new AtomicInteger();
    String body = "{\"message\":\"start\"}";
    MockHttpServletResponse first = new MockHttpServletResponse();
    MockHttpServletResponse second = new MockHttpServletResponse();

    perform("key-1", body, downstream, first);
    perform("key-1", body, downstream, second);

    assertThat(downstream.get()).isEqualTo(1);
    assertThat(first.getStatus()).isEqualTo(200);
    assertThat(second.getStatus()).isEqualTo(200);
    assertThat(second.getContentAsString()).isEqualTo("{\"ok\":true}");
  }

  @Test
  void rejectsReuseWithADifferentPayload() throws Exception {
    Map<String, IdempotencyRecord> store = new ConcurrentHashMap<>();
    stubInMemoryRepository(store);
    AtomicInteger downstream = new AtomicInteger();
    MockHttpServletResponse first = new MockHttpServletResponse();
    MockHttpServletResponse second = new MockHttpServletResponse();

    perform("key-1", "{\"message\":\"start leave\"}", downstream, first);
    perform("key-1", "{\"message\":\"start expense\"}", downstream, second);

    assertThat(downstream.get()).isEqualTo(1);
    assertThat(second.getStatus()).isEqualTo(409);
    assertThat(second.getContentAsString()).contains("different request payload");
  }

  @Test
  void concurrentDuplicateRequestsRunTheDownstreamOnce() throws Exception {
    Map<String, IdempotencyRecord> store = new ConcurrentHashMap<>();
    stubInMemoryRepository(store);
    AtomicInteger downstream = new AtomicInteger();
    CyclicBarrier barrier = new CyclicBarrier(2);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    MockHttpServletResponse[] responses = {
      new MockHttpServletResponse(), new MockHttpServletResponse()
    };
    try {
      Future<?> first =
          pool.submit(
              () -> {
                barrier.await(5, TimeUnit.SECONDS);
                perform("key-1", "{\"message\":\"start\"}", downstream, responses[0]);
                return null;
              });
      Future<?> second =
          pool.submit(
              () -> {
                barrier.await(5, TimeUnit.SECONDS);
                perform("key-1", "{\"message\":\"start\"}", downstream, responses[1]);
                return null;
              });
      first.get(10, TimeUnit.SECONDS);
      second.get(10, TimeUnit.SECONDS);
    } finally {
      pool.shutdownNow();
    }

    assertThat(downstream.get()).isEqualTo(1);
    assertThat(store).hasSize(1);
    assertThat(responses[0].getStatus()).isEqualTo(200);
    assertThat(responses[1].getStatus()).isIn(200, 409);
  }

  private void perform(
      String key, String body, AtomicInteger downstream, MockHttpServletResponse response)
      throws Exception {
    UUID randomUser = UUID.randomUUID();
    TenantContext.set(tenantId, randomUser, "TENANT_ADMIN");
    try {
      FilterChain chain =
          (request, res) -> {
            HttpServletResponse http = (HttpServletResponse) res;
            downstream.incrementAndGet();
            http.setStatus(200);
            http.setContentType("application/json");
            http.getWriter().write("{\"ok\":true}");
          };
      filter.doFilter(request(key, body), response, chain);
    } finally {
      TenantContext.clear();
    }
  }

  private MockHttpServletRequest request(String key, String body) {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/copilot/chat");
    request.addHeader("Idempotency-Key", key);
    request.setContent(body.getBytes(StandardCharsets.UTF_8));
    return request;
  }

  private void stubInMemoryRepository(Map<String, IdempotencyRecord> store) {
    when(repository.findByTenantIdAndIdempotencyKey(any(), any()))
        .thenAnswer(
            invocation -> {
              UUID tenant = invocation.getArgument(0);
              String key = invocation.getArgument(1);
              return Optional.ofNullable(store.get(tenant + "|" + key));
            });
    when(repository.save(any(IdempotencyRecord.class)))
        .thenAnswer(
            invocation -> {
              IdempotencyRecord record = invocation.getArgument(0);
              String mapKey = record.getTenantId() + "|" + record.getIdempotencyKey();
              IdempotencyRecord current = store.putIfAbsent(mapKey, record);
              if (current != null && current != record) {
                throw new DataIntegrityViolationException("duplicate idempotency key");
              }
              return record;
            });
  }
}
