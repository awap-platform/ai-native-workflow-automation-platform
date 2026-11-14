package com.awap.ai.interfaces.api;

import com.awap.ai.application.InternalAiToolAuth;
import com.awap.ai.domain.AutomationAudit;
import com.awap.ai.infrastructure.AutomationAuditRepository;
import com.awap.common.api.AwapException;
import com.awap.common.api.ErrorCode;
import com.awap.common.knowledge.KnowledgeSearchService;
import com.awap.engine.application.OutboxEventPublisher;
import com.awap.engine.interfaces.dto.StartWorkflowRequest;
import com.awap.engine.interfaces.dto.WorkflowInstanceResponse;
import com.awap.identity.domain.Permission;
import com.awap.identity.domain.User;
import com.awap.identity.infrastructure.UserRepository;
import com.awap.task.application.TaskService;
import com.awap.task.interfaces.dto.TaskAssignRequest;
import com.awap.task.interfaces.dto.TaskRequest;
import com.awap.task.interfaces.dto.TaskResponse;
import com.awap.workflow.application.WorkflowDefinitionService;
import com.awap.workflow.interfaces.dto.WorkflowDefinitionResponse;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Internal tool API used exclusively by the AI layer. Every route verifies the service credential
 * and the caller's role, then establishes the tenant context before touching a domain service.
 *
 * <p>The public SPA never calls these routes; it talks to {@code /api/v1/copilot/*}, which forwards
 * the authenticated user context to the AI layer.
 */
@RestController
@RequestMapping("/internal/tools")
public class InternalAiToolController {

  private final InternalAiToolAuth auth;
  private final WorkflowDefinitionService workflowDefinitionService;
  private final com.awap.engine.application.WorkflowEngineService workflowEngineService;
  private final TaskService taskService;
  private final OutboxEventPublisher outboxEventPublisher;
  private final KnowledgeSearchService knowledgeSearchService;
  private final UserRepository userRepository;
  private final AutomationAuditRepository auditRepository;
  private final ObjectMapper objectMapper;

  public InternalAiToolController(
      InternalAiToolAuth auth,
      WorkflowDefinitionService workflowDefinitionService,
      com.awap.engine.application.WorkflowEngineService workflowEngineService,
      TaskService taskService,
      OutboxEventPublisher outboxEventPublisher,
      KnowledgeSearchService knowledgeSearchService,
      UserRepository userRepository,
      AutomationAuditRepository auditRepository,
      ObjectMapper objectMapper) {
    this.auth = auth;
    this.workflowDefinitionService = workflowDefinitionService;
    this.workflowEngineService = workflowEngineService;
    this.taskService = taskService;
    this.outboxEventPublisher = outboxEventPublisher;
    this.knowledgeSearchService = knowledgeSearchService;
    this.userRepository = userRepository;
    this.auditRepository = auditRepository;
    this.objectMapper = objectMapper;
  }

  @PostMapping("/find_workflow")
  public List<Map<String, Object>> findWorkflow(
      @RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_READ);
    List<String> tokens = searchTokens(text(payload, "query"));
    return auth.inTenant(
        caller,
        () ->
            workflowDefinitionService.list(caller.tenantId()).stream()
                .filter(definition -> "PUBLISHED".equalsIgnoreCase(definition.status()))
                .filter(
                    definition -> {
                      if (tokens.isEmpty()) {
                        return true;
                      }
                      String haystack =
                          (definition.name() + " " + safe(definition.description()))
                              .toLowerCase(Locale.ROOT);
                      return tokens.stream().anyMatch(haystack::contains);
                    })
                .map(this::workflowMap)
                .toList());
  }

  @PostMapping("/create_workflow_instance")
  public Map<String, Object> createWorkflowInstance(
      @RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_MANAGE);
    UUID workflowId = uuid(payload, "workflowId");
    String context = payload.hasNonNull("context") ? payload.path("context").toString() : "{}";
    String idempotencyKey = textOrNull(payload, "idempotencyKey");
    return auth.inTenant(
        caller,
        () -> {
          WorkflowInstanceResponse instance =
              workflowEngineService.start(
                  caller.tenantId(), new StartWorkflowRequest(workflowId, idempotencyKey, context));
          Map<String, Object> result = new LinkedHashMap<>();
          result.put("id", instance.id());
          result.put("tenantId", instance.tenantId());
          result.put("workflowDefinitionId", instance.workflowDefinitionId());
          result.put("workflowVersion", instance.workflowVersion());
          result.put("state", instance.state());
          result.put("idempotencyKey", instance.idempotencyKey());
          return result;
        });
  }

  @PostMapping("/query_tasks")
  public List<Map<String, Object>> queryTasks(
      @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.TASK_MANAGE);
    boolean mine = body == null || body.path("mine").asBoolean(true);
    return auth.inTenant(
        caller,
        () -> {
          List<TaskResponse> tasks =
              mine
                  ? taskService.listMine(caller.tenantId(), caller.userId())
                  : taskService.list(caller.tenantId());
          return tasks.stream().map(this::taskMap).toList();
        });
  }

  @PostMapping("/complete_task")
  public Map<String, Object> completeTask(@RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.TASK_MANAGE);
    UUID taskId = uuid(payload, "taskId");
    String decision =
        text(payload, "decision").isBlank()
            ? "complete"
            : text(payload, "decision").toLowerCase(Locale.ROOT);
    String comment = textOrNull(payload, "comment");
    return auth.inTenant(
        caller,
        () -> {
          TaskResponse task =
              switch (decision) {
                case "approve" ->
                    taskService.approve(
                        caller.tenantId(), taskId, caller.userId(), caller.role().name(), comment);
                case "reject" ->
                    taskService.reject(
                        caller.tenantId(), taskId, caller.userId(), caller.role().name(), comment);
                case "complete" -> taskService.complete(caller.tenantId(), taskId);
                default ->
                    throw new AwapException(
                        ErrorCode.VALIDATION_FAILED,
                        HttpStatus.BAD_REQUEST,
                        "Unknown task decision: " + decision);
              };
          return taskMap(task);
        });
  }

  @PostMapping("/assign_task")
  public Map<String, Object> assignTask(@RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.TASK_MANAGE);
    UUID taskId = uuid(payload, "taskId");
    UUID assigneeId = uuid(payload, "assigneeId");
    return auth.inTenant(
        caller,
        () ->
            taskMap(
                taskService.assign(caller.tenantId(), taskId, new TaskAssignRequest(assigneeId))));
  }

  @PostMapping("/create_approval")
  public Map<String, Object> createApproval(
      @RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.TASK_MANAGE);
    UUID workflowInstanceId = uuid(payload, "workflowInstanceId");
    UUID assigneeId = optionalUuid(payload, "assigneeId");
    String title = textOrNull(payload, "title");
    String description = textOrNull(payload, "description");
    return auth.inTenant(
        caller,
        () ->
            taskMap(
                taskService.create(
                    caller.tenantId(),
                    new TaskRequest(
                        title == null ? "Copilot approval request" : title,
                        description,
                        workflowInstanceId,
                        null,
                        assigneeId))));
  }

  @PostMapping("/send_notification")
  public Map<String, Object> sendNotification(
      @RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_MANAGE);
    String recipient = text(payload, "recipient");
    if (recipient.isBlank()) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "recipient is required.");
    }
    String channel = channel(textOrNull(payload, "channel"));
    String templateKey =
        textOrNull(payload, "templateKey") == null
            ? "notification"
            : textOrNull(payload, "templateKey");
    String locale = textOrNull(payload, "locale") == null ? "en" : textOrNull(payload, "locale");
    String variables =
        payload.hasNonNull("variables") ? payload.path("variables").toString() : "{}";
    String businessKey = textOrNull(payload, "businessKey");
    String dedupeKey = textOrNull(payload, "dedupeKey");
    return auth.inTenant(
        caller,
        () -> {
          Map<String, Object> event = new LinkedHashMap<>();
          event.put("tenantId", caller.tenantId().toString());
          event.put("recipient", recipient);
          event.put("channel", channel);
          event.put("templateKey", templateKey);
          event.put("locale", locale);
          event.put("variablesJson", variables);
          event.put("dedupeKey", dedupeKey);
          event.put("businessKey", businessKey);
          event.put("eventType", "NOTIFICATION_REQUESTED");
          outboxEventPublisher.publish(
              caller.tenantId(),
              "NOTIFICATION",
              UUID.randomUUID(),
              "NOTIFICATION_REQUESTED",
              event);
          Map<String, Object> result = new LinkedHashMap<>();
          result.put("queued", true);
          result.put("recipient", recipient);
          result.put("channel", channel);
          return result;
        });
  }

  @PostMapping("/search_documents")
  public List<KnowledgeSearchService.KnowledgeHit> searchDocuments(
      @RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_READ);
    String query = text(payload, "query");
    int limit = payload.path("limit").asInt(10);
    return auth.inTenant(
        caller, () -> knowledgeSearchService.search(caller.tenantId(), query, limit));
  }

  @PostMapping("/index_document")
  public Map<String, Object> indexDocument(@RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, Permission.INSTANCE_MANAGE);
    UUID fileId = uuid(payload, "fileId");
    String title = textOrNull(payload, "title");
    String content = textOrNull(payload, "content");
    String format = textOrNull(payload, "format");
    int version = payload.path("version").asInt(1);
    return auth.inTenant(
        caller,
        () -> {
          int chunks =
              knowledgeSearchService.indexDocument(
                  caller.tenantId(),
                  fileId,
                  title == null ? fileId.toString() : title,
                  content == null ? "" : content,
                  format == null ? "" : format,
                  version);
          Map<String, Object> result = new LinkedHashMap<>();
          result.put("fileId", fileId);
          result.put("chunks", chunks);
          return result;
        });
  }

  @PostMapping("/get_user")
  public Map<String, Object> getUser(
      @RequestBody(required = false) JsonNode body, HttpServletRequest request) {
    InternalAiToolAuth.Caller caller = auth.authenticate(request, null);
    return auth.inTenant(
        caller,
        () -> {
          User user =
              userRepository
                  .findByIdAndTenantId(caller.userId(), caller.tenantId())
                  .orElseThrow(
                      () ->
                          new AwapException(
                              ErrorCode.RESOURCE_NOT_FOUND,
                              HttpStatus.NOT_FOUND,
                              "User not found."));
          Map<String, Object> result = new LinkedHashMap<>();
          result.put("id", user.getId());
          result.put("tenantId", user.getTenantId());
          result.put("email", user.getEmail());
          result.put("fullName", user.getFullName());
          result.put("role", user.getRole().name());
          return result;
        });
  }

  @PostMapping("/audit_decision")
  public Map<String, Object> auditDecision(@RequestBody JsonNode body, HttpServletRequest request) {
    JsonNode payload = requireBody(body);
    InternalAiToolAuth.Caller caller = auth.authenticate(request, null);
    String action = textOrNull(payload, "action");
    String outcome = textOrNull(payload, "outcome");
    BigDecimal confidence =
        payload.hasNonNull("confidence")
            ? BigDecimal.valueOf(payload.path("confidence").asDouble())
            : null;
    return auth.inTenant(
        caller,
        () -> {
          auditRepository.save(
              new AutomationAudit(
                  caller.tenantId(),
                  null,
                  "copilot",
                  AutomationAudit.AuditKind.AI,
                  action == null ? "COPILOT" : action,
                  "ai-layer",
                  textOrNull(payload, "model"),
                  hash(payload.toString()),
                  confidence,
                  0,
                  0,
                  outcome == null ? "SUCCESS" : outcome,
                  payload.toString()));
          Map<String, Object> result = new LinkedHashMap<>();
          result.put("recorded", true);
          return result;
        });
  }

  private Map<String, Object> workflowMap(WorkflowDefinitionResponse definition) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("id", definition.id());
    result.put("name", definition.name());
    result.put("description", definition.description());
    result.put("status", definition.status());
    result.put("currentVersion", definition.currentVersion());
    return result;
  }

  private Map<String, Object> taskMap(TaskResponse task) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("id", task.id());
    result.put("workflowInstanceId", task.workflowInstanceId());
    result.put("title", task.title());
    result.put("description", task.description());
    result.put("assigneeId", task.assigneeId());
    result.put("status", task.status());
    result.put("version", task.version());
    result.put("decisionComment", task.decisionComment());
    return result;
  }

  private String channel(String value) {
    String normalized =
        value == null || value.isBlank() ? "EMAIL" : value.trim().toUpperCase(Locale.ROOT);
    if (!java.util.Set.of("EMAIL", "SMS", "PUSH", "WEB", "WEBHOOK").contains(normalized)) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          "Unknown notification channel: " + value);
    }
    return normalized;
  }

  private static String safe(String value) {
    return value == null ? "" : value;
  }

  private static final Map<String, String> QUERY_SYNONYMS =
      Map.ofEntries(
          Map.entry("izin", "leave"),
          Map.entry("talep", "request"),
          Map.entry("görev", "task"),
          Map.entry("onay", "approval"),
          Map.entry("belge", "document"),
          Map.entry("doküman", "document"),
          Map.entry("ara", "search"),
          Map.entry("bul", "find"),
          Map.entry("başlat", "start"));

  private static final java.util.Set<String> ACTION_STOPWORDS =
      java.util.Set.of("start", "başlat", "initiate", "search", "ara", "bul", "find", "lütfen");

  /**
   * Tokenizes a natural-language query and normalizes Turkish/English synonyms. Action verbs are
   * removed so "izin talebi başlat" can score against "Leave Request" in a deterministic local
   * deployment without an LLM.
   */
  private static List<String> searchTokens(String query) {
    if (query == null || query.isBlank()) {
      return List.of();
    }
    return java.util.Arrays.stream(query.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+"))
        .filter(token -> token.length() > 2)
        .map(token -> QUERY_SYNONYMS.getOrDefault(token, token))
        .filter(token -> !ACTION_STOPWORDS.contains(token))
        .distinct()
        .toList();
  }

  private static JsonNode requireBody(JsonNode body) {
    if (body == null) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Request body is required.");
    }
    return body;
  }

  private static String text(JsonNode body, String field) {
    JsonNode value = body == null ? null : body.get(field);
    return value == null || value.isNull() ? "" : value.asText("");
  }

  private static String textOrNull(JsonNode body, String field) {
    String value = text(body, field);
    return value.isBlank() ? null : value;
  }

  private static UUID uuid(JsonNode body, String field) {
    String value = text(body, field);
    try {
      return UUID.fromString(value);
    } catch (IllegalArgumentException ex) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, field + " must be a UUID.");
    }
  }

  private static UUID optionalUuid(JsonNode body, String field) {
    String value = textOrNull(body, field);
    if (value == null) {
      return null;
    }
    try {
      return UUID.fromString(value);
    } catch (IllegalArgumentException ex) {
      throw new AwapException(
          ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, field + " must be a UUID.");
    }
  }

  private static String hash(String value) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException ex) {
      throw new IllegalStateException("SHA-256 is not available", ex);
    }
  }
}
