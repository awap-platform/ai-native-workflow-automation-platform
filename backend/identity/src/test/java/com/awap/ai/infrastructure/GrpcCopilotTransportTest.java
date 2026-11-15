package com.awap.ai.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import com.awap.ai.grpc.v1.CopilotRequest;
import com.awap.ai.grpc.v1.CopilotResponse;
import com.awap.ai.grpc.v1.CopilotServiceGrpc;
import com.awap.ai.grpc.v1.ToolCall;
import com.awap.common.correlation.CorrelationId;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.NullValue;
import com.google.protobuf.Struct;
import com.google.protobuf.Value;
import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Deadline;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.ServerInterceptors;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The gRPC transport must preserve every request field, metadata item and response type. */
class GrpcCopilotTransportTest {

  private final ObjectMapper mapper = new ObjectMapper();
  private final UUID tenantId = UUID.randomUUID();
  private final UUID userId = UUID.randomUUID();
  private final TenantContext.Context context =
      new TenantContext.Context(tenantId, userId, "TENANT_ADMIN");

  private Server server;
  private ManagedChannel channel;
  private final AtomicReference<CopilotRequest> capturedRequest = new AtomicReference<>();
  private final AtomicReference<Metadata> capturedMetadata = new AtomicReference<>();
  private final AtomicReference<Deadline> capturedDeadline = new AtomicReference<>();

  @AfterEach
  void tearDown() throws Exception {
    TenantContext.clear();
    CorrelationId.clear();
    if (channel != null) {
      channel.shutdownNow();
    }
    if (server != null) {
      server.shutdownNow();
      server.awaitTermination(1, TimeUnit.SECONDS);
    }
  }

  private GrpcCopilotTransport transport(String serviceToken) throws Exception {
    String name = InProcessServerBuilder.generateName();
    CopilotServiceGrpc.CopilotServiceImplBase service =
        new CopilotServiceGrpc.CopilotServiceImplBase() {
          @Override
          public void chat(CopilotRequest request, StreamObserver<CopilotResponse> observer) {
            capturedRequest.set(request);
            capturedDeadline.set(Context.current().getDeadline());
            observer.onNext(response());
            observer.onCompleted();
          }
        };
    ServerInterceptor capture =
        new ServerInterceptor() {
          @Override
          public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
              ServerCall<ReqT, RespT> call, Metadata headers, ServerCallHandler<ReqT, RespT> next) {
            capturedMetadata.set(headers);
            return Contexts.interceptCall(Context.current(), call, headers, next);
          }
        };
    server =
        InProcessServerBuilder.forName(name)
            .directExecutor()
            .addService(ServerInterceptors.intercept(service, capture))
            .build()
            .start();
    channel = InProcessChannelBuilder.forName(name).directExecutor().build();
    return new GrpcCopilotTransport(channel, mapper, 5_000, serviceToken);
  }

  private CopilotResponse response() {
    Struct result =
        Struct.newBuilder()
            .putFields("fullName", Value.newBuilder().setStringValue("Ada").build())
            .build();
    return CopilotResponse.newBuilder()
        .setAnswer("done")
        .setAction("chat")
        .setConfidence(0.9)
        .setPromptKey("chat")
        .setPromptVersion("v1")
        .setPromptHash("a".repeat(64))
        .setCorrelationId("corr-grpc")
        .setIdempotencyKey("idem-42")
        .setModelTier("standard")
        .setCacheHit(true)
        .addToolCalls(
            ToolCall.newBuilder()
                .setName("get_user")
                .setOk(true)
                .setResult(Value.newBuilder().setStructValue(result).build())
                .build())
        .build();
  }

  @Test
  void chatSendsTheTypedRequestMetadataAndDeadline() throws Exception {
    TenantContext.set(tenantId, userId, "TENANT_ADMIN");
    CorrelationId.set("corr-42");
    GrpcCopilotTransport transport = transport("secret");
    JsonNode body =
        mapper.readTree(
            "{\"message\":\"hello\",\"action\":\"chat\",\"context\":{\"team\":\"ops\"}}");

    JsonNode result =
        transport.chat(
            body, context, Role.TENANT_ADMIN, "INSTANCE_READ,INSTANCE_MANAGE", "idem-42");

    CopilotRequest sent = capturedRequest.get();
    assertThat(sent.getMessage()).isEqualTo("hello");
    assertThat(sent.getAction()).isEqualTo("chat");
    assertThat(sent.getContext().getFieldsOrThrow("team").getStringValue()).isEqualTo("ops");
    assertThat(sent.getSecurity().getTenantId()).isEqualTo(tenantId.toString());
    assertThat(sent.getSecurity().getUserId()).isEqualTo(userId.toString());
    assertThat(sent.getSecurity().getRole()).isEqualTo("TENANT_ADMIN");
    assertThat(sent.getSecurity().getPermissionsList())
        .containsExactly("INSTANCE_READ", "INSTANCE_MANAGE");
    assertThat(sent.getSecurity().getCorrelationId()).isEqualTo("corr-42");
    assertThat(sent.getDeadlineMs()).isEqualTo(5_000L);
    assertThat(sent.getIdempotencyKey()).isEqualTo("idem-42");

    Metadata headers = capturedMetadata.get();
    assertThat(headers.get(GrpcCopilotTransport.TENANT_KEY)).isEqualTo(tenantId.toString());
    assertThat(headers.get(GrpcCopilotTransport.USER_KEY)).isEqualTo(userId.toString());
    assertThat(headers.get(GrpcCopilotTransport.ROLE_KEY)).isEqualTo("TENANT_ADMIN");
    assertThat(headers.get(GrpcCopilotTransport.PERMISSIONS_KEY))
        .isEqualTo("INSTANCE_READ,INSTANCE_MANAGE");
    assertThat(headers.get(GrpcCopilotTransport.SERVICE_TOKEN_KEY)).isEqualTo("secret");
    assertThat(headers.get(GrpcCopilotTransport.CORRELATION_KEY)).isEqualTo("corr-42");
    assertThat(headers.get(GrpcCopilotTransport.IDEMPOTENCY_KEY)).isEqualTo("idem-42");
    assertThat(capturedDeadline.get()).isNotNull();
    assertThat(capturedDeadline.get().timeRemaining(TimeUnit.MILLISECONDS)).isPositive();

    assertThat(result.path("answer").asText()).isEqualTo("done");
    assertThat(result.path("model_tier").asText()).isEqualTo("standard");
    assertThat(result.path("cache_hit").asBoolean()).isTrue();
    assertThat(result.path("prompt_hash").asText()).hasSize(64);
    assertThat(result.path("tool_calls").path(0).path("name").asText()).isEqualTo("get_user");
    assertThat(result.path("tool_calls").path(0).path("result").path("fullName").asText())
        .isEqualTo("Ada");

    transport.close();
    assertThat(channel.isShutdown()).isTrue();
  }

  @Test
  void minimalRequestsOmitOptionalFieldsAndTheServiceToken() throws Exception {
    GrpcCopilotTransport transport = transport("  ");

    transport.chat(mapper.readTree("{\"message\":\"hello\"}"), context, Role.EMPLOYEE, "", null);

    CopilotRequest sent = capturedRequest.get();
    assertThat(sent.hasAction()).isFalse();
    assertThat(sent.hasContext()).isFalse();
    assertThat(sent.hasIdempotencyKey()).isFalse();
    assertThat(sent.getSecurity().getPermissionsList()).isEmpty();
    assertThat(capturedMetadata.get().get(GrpcCopilotTransport.SERVICE_TOKEN_KEY)).isNull();
    assertThat(capturedMetadata.get().get(GrpcCopilotTransport.IDEMPOTENCY_KEY)).isNull();
  }

  @Test
  void everyJsonValueTypeMapsToTheMatchingProtoValue() throws Exception {
    JsonNode json =
        mapper.readTree(
            "{\"s\":\"x\",\"b\":true,\"n\":1.5,\"o\":{\"k\":\"v\"},\"a\":[1,\"two\"],\"z\":null}");

    Struct struct = GrpcCopilotTransport.toStruct(json);

    assertThat(struct.getFieldsOrThrow("s").getStringValue()).isEqualTo("x");
    assertThat(struct.getFieldsOrThrow("b").getBoolValue()).isTrue();
    assertThat(struct.getFieldsOrThrow("n").getNumberValue()).isEqualTo(1.5);
    assertThat(struct.getFieldsOrThrow("o").getStructValue().getFieldsOrThrow("k").getStringValue())
        .isEqualTo("v");
    assertThat(struct.getFieldsOrThrow("a").getListValue().getValuesCount()).isEqualTo(2);
    assertThat(struct.getFieldsOrThrow("a").getListValue().getValues(0).getNumberValue())
        .isEqualTo(1.0);
    assertThat(struct.getFieldsOrThrow("z").getNullValue()).isEqualTo(NullValue.NULL_VALUE);
    assertThat(GrpcCopilotTransport.toValue(null).getNullValue()).isEqualTo(NullValue.NULL_VALUE);
    assertThat(GrpcCopilotTransport.toValue(mapper.nullNode()).getNullValue())
        .isEqualTo(NullValue.NULL_VALUE);
  }

  @Test
  void theSpringConstructorCreatesACloseableChannel() {
    GrpcCopilotTransport transport = new GrpcCopilotTransport("127.0.0.1", 1, 1_000, "", mapper);

    transport.close();
  }
}
