package com.awap.ai.infrastructure;

import com.awap.ai.grpc.v1.CopilotRequest;
import com.awap.ai.grpc.v1.CopilotResponse;
import com.awap.ai.grpc.v1.CopilotServiceGrpc;
import com.awap.ai.grpc.v1.SecurityContext;
import com.awap.common.correlation.CorrelationId;
import com.awap.identity.domain.Role;
import com.awap.identity.infrastructure.security.TenantContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.protobuf.ListValue;
import com.google.protobuf.NullValue;
import com.google.protobuf.Struct;
import com.google.protobuf.util.JsonFormat;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;
import java.io.IOException;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Typed gRPC client for the AI layer (issue #291).
 *
 * <p>The protobuf contract lives in {@code contracts/proto/ai/v1/copilot.proto}. Responses are
 * rendered back to JSON with proto field names preserved, which is exactly the REST envelope, so
 * the SPA contract does not change with the transport.
 */
@Component
@ConditionalOnProperty(name = "awap.ai.copilot.transport", havingValue = "grpc")
public class GrpcCopilotTransport implements AutoCloseable {

  static final Metadata.Key<String> TENANT_KEY =
      Metadata.Key.of("x-tenant-id", Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> USER_KEY =
      Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> ROLE_KEY =
      Metadata.Key.of("x-user-role", Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> PERMISSIONS_KEY =
      Metadata.Key.of("x-user-permissions", Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> SERVICE_TOKEN_KEY =
      Metadata.Key.of("x-ai-service-token", Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> CORRELATION_KEY =
      Metadata.Key.of(
          CorrelationId.HEADER.toLowerCase(java.util.Locale.ROOT),
          Metadata.ASCII_STRING_MARSHALLER);
  static final Metadata.Key<String> IDEMPOTENCY_KEY =
      Metadata.Key.of("idempotency-key", Metadata.ASCII_STRING_MARSHALLER);

  private final ManagedChannel channel;
  private final CopilotServiceGrpc.CopilotServiceBlockingStub stub;
  private final ObjectMapper objectMapper;
  private final long deadlineMs;
  private final String serviceToken;

  @Autowired
  public GrpcCopilotTransport(
      @Value("${awap.ai.copilot.grpc.host:localhost}") String host,
      @Value("${awap.ai.copilot.grpc.port:50051}") int port,
      @Value("${awap.ai.copilot.timeout-ms:10000}") long deadlineMs,
      @Value("${awap.ai.internal-token:}") String serviceToken,
      ObjectMapper objectMapper) {
    this(
        ManagedChannelBuilder.forAddress(host, port).usePlaintext().build(),
        objectMapper,
        deadlineMs,
        serviceToken);
  }

  public GrpcCopilotTransport(
      ManagedChannel channel, ObjectMapper objectMapper, long deadlineMs, String serviceToken) {
    this.channel = channel;
    this.stub = CopilotServiceGrpc.newBlockingStub(channel);
    this.objectMapper = objectMapper;
    this.deadlineMs = Math.max(1L, deadlineMs);
    this.serviceToken = serviceToken;
  }

  /** Sends one Chat RPC and returns the response rendered as the REST JSON envelope. */
  public JsonNode chat(
      JsonNode body,
      TenantContext.Context context,
      Role role,
      String permissions,
      String idempotencyKey)
      throws IOException {
    Metadata headers = new Metadata();
    headers.put(TENANT_KEY, context.tenantId().toString());
    headers.put(USER_KEY, context.userId().toString());
    headers.put(ROLE_KEY, role.name());
    headers.put(PERMISSIONS_KEY, permissions == null ? "" : permissions);
    headers.put(CORRELATION_KEY, CorrelationId.currentOrDefault());
    if (serviceToken != null && !serviceToken.isBlank()) {
      headers.put(SERVICE_TOKEN_KEY, serviceToken);
    }
    if (idempotencyKey != null && !idempotencyKey.isBlank()) {
      headers.put(IDEMPOTENCY_KEY, idempotencyKey);
    }
    CopilotResponse response =
        stub.withDeadlineAfter(deadlineMs, TimeUnit.MILLISECONDS)
            .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers))
            .chat(toRequest(body, context, role, permissions, idempotencyKey, deadlineMs));
    String json =
        JsonFormat.printer()
            .preservingProtoFieldNames()
            .omittingInsignificantWhitespace()
            .print(response);
    return objectMapper.readTree(json);
  }

  static CopilotRequest toRequest(
      JsonNode body,
      TenantContext.Context context,
      Role role,
      String permissions,
      String idempotencyKey,
      long deadlineMs) {
    CopilotRequest.Builder builder =
        CopilotRequest.newBuilder()
            .setMessage(body.path("message").asText(""))
            .setConfirmHighRisk(body.path("confirm_high_risk").asBoolean(false))
            .setDeadlineMs(deadlineMs)
            .setSecurity(
                SecurityContext.newBuilder()
                    .setTenantId(context.tenantId().toString())
                    .setUserId(context.userId().toString())
                    .setRole(role.name())
                    .addAllPermissions(splitPermissions(permissions))
                    .setCorrelationId(CorrelationId.currentOrDefault())
                    .build());
    if (body.hasNonNull("action")) {
      builder.setAction(body.get("action").asText());
    }
    JsonNode requestContext = body.get("context");
    if (requestContext != null && requestContext.isObject()) {
      builder.setContext(toStruct(requestContext));
    }
    if (idempotencyKey != null && !idempotencyKey.isBlank()) {
      builder.setIdempotencyKey(idempotencyKey);
    }
    return builder.build();
  }

  static List<String> splitPermissions(String permissions) {
    if (permissions == null || permissions.isBlank()) {
      return List.of();
    }
    return Arrays.stream(permissions.split(","))
        .map(String::trim)
        .filter(value -> !value.isEmpty())
        .toList();
  }

  static Struct toStruct(JsonNode node) {
    Struct.Builder builder = Struct.newBuilder();
    Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
    while (fields.hasNext()) {
      Map.Entry<String, JsonNode> field = fields.next();
      builder.putFields(field.getKey(), toValue(field.getValue()));
    }
    return builder.build();
  }

  /** Converts a JSON value into a protobuf Value, preserving objects, arrays and scalar types. */
  static com.google.protobuf.Value toValue(JsonNode node) {
    com.google.protobuf.Value.Builder builder = com.google.protobuf.Value.newBuilder();
    if (node == null || node.isNull()) {
      return builder.setNullValue(NullValue.NULL_VALUE).build();
    }
    if (node.isObject()) {
      return builder.setStructValue(toStruct(node)).build();
    }
    if (node.isArray()) {
      ListValue.Builder list = ListValue.newBuilder();
      node.forEach(element -> list.addValues(toValue(element)));
      return builder.setListValue(list).build();
    }
    if (node.isBoolean()) {
      return builder.setBoolValue(node.asBoolean()).build();
    }
    if (node.isNumber()) {
      return builder.setNumberValue(node.asDouble()).build();
    }
    return builder.setStringValue(node.asText()).build();
  }

  @Override
  public void close() {
    channel.shutdownNow();
  }
}
