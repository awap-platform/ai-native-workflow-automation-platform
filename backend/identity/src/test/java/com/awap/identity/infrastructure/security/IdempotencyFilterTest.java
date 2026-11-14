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
import java.io.BufferedReader;
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
  void includesTheQueryStringInTheRequestHash() throws Exception {
    Map<String, IdempotencyRecord> store = new ConcurrentHashMap<>();
    stubInMemoryRepository(store);
    AtomicInteger downstream = new AtomicInteger();
    MockHttpServletResponse first = new MockHttpServletResponse();
    MockHttpServletResponse second = new MockHttpServletResponse();

    perform("key-1", "{\"message\":\"start\"}", downstream, first, "tenant=1");
    perform("key-1", "{\"message\":\"start\"}", downstream, second, "tenant=2");

    assertThat(downstream.get()).isEqualTo(1);
    assertThat(second.getStatus()).isEqualTo(409);
  }

  @Test
  void digestFailsClosedForAnUnavailableAlgorithm() {
    assertThat(
            org.assertj.core.api.Assertions.catchThrowable(
                () -> IdempotencyFilter.digest("NO-SUCH-ALGORITHM", "value")))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("not available");
  }

  @Test
  void replaysTheRacedRecordWhenItAppearsAfterTheInsertFails() throws Exception {
    IdempotencyRecord raced = new IdempotencyRecord(tenantId, "key-1");
    raced.setResponse(201, "{\"created\":true}", "application/json");
    when(repository.findByTenantIdAndIdempotencyKey(tenantId, "key-1"))
        .thenReturn(Optional.empty(), Optional.of(raced));
    when(repository.save(any(IdempotencyRecord.class)))
        .thenThrow(new DataIntegrityViolationException("duplicate"));

    MockHttpServletRequest request = request("key-1", "{\"message\":\"start\"}");
    MockHttpServletResponse response = new MockHttpServletResponse();
    AtomicInteger downstream = new AtomicInteger();

    filter.doFilter(request, response, (req, res) -> downstream.incrementAndGet());

    assertThat(downstream.get()).isZero();
    assertThat(response.getStatus()).isEqualTo(201);
    assertThat(response.getContentAsString()).contains("created");
  }

  @Test
  void rejectsAnInFlightDuplicateWith409() throws Exception {
    IdempotencyRecord inFlight = new IdempotencyRecord(tenantId, "key-1");
    when(repository.findByTenantIdAndIdempotencyKey(tenantId, "key-1"))
        .thenReturn(Optional.of(inFlight));

    MockHttpServletRequest request = request("key-1", "{\"message\":\"start\"}");
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();

    filter.doFilter(request, response, chain);

    assertThat(chain.getRequest()).isNull();
    assertThat(response.getStatus()).isEqualTo(409);
    assertThat(response.getContentAsString()).contains("already been used");
  }

  @Test
  void writesConflictWhenTheRacingRecordCannotBeRead() throws Exception {
    when(repository.findByTenantIdAndIdempotencyKey(tenantId, "key-1"))
        .thenReturn(Optional.empty());
    when(repository.save(any(IdempotencyRecord.class)))
        .thenThrow(new DataIntegrityViolationException("duplicate"));

    MockHttpServletRequest request = request("key-1", "{\"message\":\"start\"}");
    MockHttpServletResponse response = new MockHttpServletResponse();
    AtomicInteger downstream = new AtomicInteger();
    FilterChain chain = (req, res) -> downstream.incrementAndGet();

    filter.doFilter(request, response, chain);

    assertThat(downstream.get()).isZero();
    assertThat(response.getStatus()).isEqualTo(409);
    assertThat(response.getContentAsString()).contains("already been used");
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
    // One caller wins and answers 200; the other either sees the committed response (replay 200)
    // or the in-flight record (deterministic 409). Either way the downstream ran once.
    assertThat(responses[0].getStatus()).isIn(200, 409);
    assertThat(responses[1].getStatus()).isIn(200, 409);
    assertThat(java.util.Arrays.asList(responses[0].getStatus(), responses[1].getStatus()))
        .contains(200);
  }

  @Test
  void leavesTheRequestBodyReadableForTheDownstreamHandler() throws Exception {
    when(repository.findByTenantIdAndIdempotencyKey(any(), any())).thenReturn(Optional.empty());
    when(repository.save(any(IdempotencyRecord.class)))
        .thenAnswer(invocation -> invocation.getArgument(0));

    String body = "{\"message\":\"start\"}";
    MockHttpServletRequest request = request("key-1", body);
    request.setCharacterEncoding("UTF-8");
    MockHttpServletResponse response = new MockHttpServletResponse();
    String[] seen = new String[3];

    filter.doFilter(
        request,
        response,
        (req, res) -> {
          String readAgain =
              new String(req.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
          String readViaReader = new BufferedReader(req.getReader()).readLine();
          jakarta.servlet.ServletInputStream stream = req.getInputStream();
          stream.setReadListener(null);
          boolean ready = stream.isReady();
          int firstByte = stream.read();
          stream.readAllBytes();
          seen[0] = readAgain;
          seen[1] = readViaReader;
          seen[2] = Boolean.toString(ready && firstByte >= 0 && stream.isFinished());
          ((HttpServletResponse) res).setStatus(200);
        });

    assertThat(seen[0]).isEqualTo(body);
    assertThat(seen[1]).isEqualTo(body);
    assertThat(seen[2]).isEqualTo("true");
  }

  private void perform(
      String key, String body, AtomicInteger downstream, MockHttpServletResponse response)
      throws Exception {
    perform(key, body, downstream, response, null);
  }

  private void perform(
      String key,
      String body,
      AtomicInteger downstream,
      MockHttpServletResponse response,
      String query)
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
      filter.doFilter(request(key, body, query), response, chain);
    } finally {
      TenantContext.clear();
    }
  }

  private MockHttpServletRequest request(String key, String body) {
    return request(key, body, null);
  }

  private MockHttpServletRequest request(String key, String body, String query) {
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/copilot/chat");
    request.addHeader("Idempotency-Key", key);
    if (query != null) {
      request.setQueryString(query);
    }
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
