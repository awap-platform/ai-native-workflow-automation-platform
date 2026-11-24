package com.awap.workflow.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.awap.common.api.AwapException;
import com.awap.identity.application.QuotaService;
import com.awap.workflow.domain.NodeDefinition;
import com.awap.workflow.domain.NodeType;
import com.awap.workflow.domain.WorkflowDefinition;
import com.awap.workflow.domain.WorkflowStatus;
import com.awap.workflow.domain.WorkflowVersion;
import com.awap.workflow.infrastructure.NodeDefinitionRepository;
import com.awap.workflow.infrastructure.TransitionDefinitionRepository;
import com.awap.workflow.infrastructure.WorkflowDefinitionRepository;
import com.awap.workflow.infrastructure.WorkflowVariableRepository;
import com.awap.workflow.infrastructure.WorkflowVersionRepository;
import com.awap.workflow.interfaces.dto.WorkflowDefinitionRequest;
import com.awap.workflow.interfaces.dto.WorkflowDefinitionUpdateRequest;
import com.awap.workflow.interfaces.dto.WorkflowMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Happy-path coverage for the workflow definition lifecycle use cases. */
class WorkflowDefinitionServiceTest {

  private WorkflowDefinitionService service;
  private WorkflowDefinitionRepository definitionRepository;
  private WorkflowVersionRepository versionRepository;
  private NodeDefinitionRepository nodeDefinitionRepository;
  private TransitionDefinitionRepository transitionDefinitionRepository;
  private WorkflowMapper workflowMapper;
  private final UUID tenantId = UUID.randomUUID();

  private static final String VALID_GRAPH =
      "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
          + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\"}],"
          + "\"variables\":[{\"name\":\"amount\",\"type\":\"NUMBER\"}]}";

  @BeforeEach
  void setUp() {
    definitionRepository = mock(WorkflowDefinitionRepository.class);
    versionRepository = mock(WorkflowVersionRepository.class);
    nodeDefinitionRepository = mock(NodeDefinitionRepository.class);
    transitionDefinitionRepository = mock(TransitionDefinitionRepository.class);
    workflowMapper = mock(WorkflowMapper.class);
    service =
        new WorkflowDefinitionService(
            definitionRepository,
            versionRepository,
            nodeDefinitionRepository,
            transitionDefinitionRepository,
            mock(WorkflowVariableRepository.class),
            new ObjectMapper(),
            new SpelExpressionService(),
            mock(QuotaService.class),
            workflowMapper);
  }

  @Test
  void createPersistsDefinitionVersionAndGraph() {
    when(definitionRepository.save(any(WorkflowDefinition.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(versionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));

    service.create(tenantId, new WorkflowDefinitionRequest("Approval", null, VALID_GRAPH));

    verify(definitionRepository).save(any(WorkflowDefinition.class));
    verify(versionRepository).save(any(WorkflowVersion.class));
    verify(nodeDefinitionRepository, times(2)).save(any(NodeDefinition.class));
    verify(transitionDefinitionRepository)
        .save(any(com.awap.workflow.domain.TransitionDefinition.class));
  }

  @Test
  void listReturnsAllDefinitions() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    when(definitionRepository.findByTenantIdAndDeletedFalse(tenantId))
        .thenReturn(List.of(definition));

    List<?> result = service.list(tenantId);

    assertThat(result).hasSize(1);
    verify(workflowMapper).toResponse(definition);
  }

  @Test
  void getReturnsDefinition() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));

    service.get(tenantId, definition.getId());

    verify(workflowMapper).toResponse(definition);
  }

  @Test
  void getRejectsMissingDefinition() {
    UUID id = UUID.randomUUID();
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId))
        .thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.get(tenantId, id)).isInstanceOf(AwapException.class);
  }

  @Test
  void publishPublishesLatestVersion() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    WorkflowVersion version =
        new WorkflowVersion(tenantId, definition.getId(), 1, VALID_GRAPH, WorkflowStatus.DRAFT);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findTopByWorkflowIdOrderByVersionDesc(definition.getId()))
        .thenReturn(Optional.of(version));

    service.publish(tenantId, definition.getId());

    assertThat(definition.getStatus()).isEqualTo(WorkflowStatus.PUBLISHED);
    assertThat(definition.getCurrentVersion()).isEqualTo(1);
    assertThat(version.getStatus()).isEqualTo(WorkflowStatus.PUBLISHED);
  }

  @Test
  void rollbackRestoresTargetVersion() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    WorkflowVersion target =
        new WorkflowVersion(tenantId, definition.getId(), 2, VALID_GRAPH, WorkflowStatus.DRAFT);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findByWorkflowIdAndVersion(definition.getId(), 2))
        .thenReturn(Optional.of(target));

    service.rollback(tenantId, definition.getId(), 2);

    assertThat(definition.getCurrentVersion()).isEqualTo(2);
    assertThat(target.getStatus()).isEqualTo(WorkflowStatus.PUBLISHED);
  }

  @Test
  void nodesOfResolvesVersionAndListsNodes() {
    UUID definitionId = UUID.randomUUID();
    WorkflowVersion version =
        new WorkflowVersion(tenantId, definitionId, 1, VALID_GRAPH, WorkflowStatus.PUBLISHED);
    NodeDefinition node =
        new NodeDefinition(tenantId, version.getId(), "start", NodeType.START, "Start", null, 0);
    when(versionRepository.findByWorkflowIdAndVersion(definitionId, 1))
        .thenReturn(Optional.of(version));
    when(nodeDefinitionRepository.findByWorkflowVersionIdOrderByOrderIndexAsc(version.getId()))
        .thenReturn(List.of(node));

    List<NodeDefinition> nodes = service.nodesOf(definitionId, 1);

    assertThat(nodes).containsExactly(node);
  }

  @Test
  void archiveVersionMarksTargetDeleted() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    WorkflowVersion target =
        new WorkflowVersion(tenantId, definition.getId(), 1, VALID_GRAPH, WorkflowStatus.DRAFT);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findByWorkflowIdAndVersion(definition.getId(), 1))
        .thenReturn(Optional.of(target));

    service.archiveVersion(tenantId, definition.getId(), 1);

    assertThat(target.isDeleted()).isTrue();
  }

  @Test
  void versionsListsVersionsDescending() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Approval", null);
    definition.publish(1);
    WorkflowVersion version =
        new WorkflowVersion(tenantId, definition.getId(), 1, VALID_GRAPH, WorkflowStatus.PUBLISHED);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findByWorkflowIdOrderByVersionDesc(definition.getId()))
        .thenReturn(List.of(version));

    List<?> result = service.versions(tenantId, definition.getId());

    assertThat(result).hasSize(1);
    verify(workflowMapper).toVersionResponse(version, 1);
  }

  @Test
  void createRejectsGraphWithUnknownTransitionTarget() {
    String badGraph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"ghost\"}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, badGraph)))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void updateDraftUpdatesTheVersionInPlaceAndReplacesTheGraph() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Old", null);
    WorkflowVersion draft =
        new WorkflowVersion(tenantId, definition.getId(), 1, VALID_GRAPH, WorkflowStatus.DRAFT);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findTopByWorkflowIdOrderByVersionDesc(definition.getId()))
        .thenReturn(Optional.of(draft));

    service.updateDraft(
        tenantId,
        definition.getId(),
        new WorkflowDefinitionUpdateRequest(
            "New name", "New description", VALID_GRAPH, definition.getUpdatedAt()));

    assertThat(definition.getName()).isEqualTo("New name");
    assertThat(draft.getDefinitionJson()).isEqualTo(VALID_GRAPH);
    verify(nodeDefinitionRepository).deleteByWorkflowVersionId(draft.getId());
    verify(transitionDefinitionRepository).deleteByWorkflowVersionId(draft.getId());
    verify(nodeDefinitionRepository, times(2)).save(any(NodeDefinition.class));
  }

  @Test
  void updateDraftRejectsAStaleToken() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Old", null);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    definition.getId(),
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, VALID_GRAPH, definition.getUpdatedAt().minusSeconds(1))))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("changed by another request");
  }

  @Test
  void updateDraftRejectsAPublishedDefinition() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Published", null);
    definition.publish(1);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    definition.getId(),
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, VALID_GRAPH, definition.getUpdatedAt())))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("cannot be updated in place");
  }

  @Test
  void updateDraftRejectsAPublishedLatestVersion() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Draft", null);
    WorkflowVersion published =
        new WorkflowVersion(tenantId, definition.getId(), 1, VALID_GRAPH, WorkflowStatus.PUBLISHED);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findTopByWorkflowIdOrderByVersionDesc(definition.getId()))
        .thenReturn(Optional.of(published));

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    definition.getId(),
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, VALID_GRAPH, definition.getUpdatedAt())))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("is immutable");
  }

  @Test
  void updateDraftRejectsAMissingVersion() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Draft", null);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));
    when(versionRepository.findTopByWorkflowIdOrderByVersionDesc(definition.getId()))
        .thenReturn(Optional.empty());

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    definition.getId(),
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, VALID_GRAPH, definition.getUpdatedAt())))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("draft version not found");
  }

  @Test
  void updateDraftRejectsAnInvalidGraph() {
    WorkflowDefinition definition = new WorkflowDefinition(tenantId, "Draft", null);
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(definition.getId(), tenantId))
        .thenReturn(Optional.of(definition));

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    definition.getId(),
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, "{\"nodes\":[]}", definition.getUpdatedAt())))
        .isInstanceOf(AwapException.class);
  }

  @Test
  void updateDraftRejectsAForeignTenant() {
    UUID id = UUID.randomUUID();
    when(definitionRepository.findByIdAndTenantIdAndDeletedFalse(id, tenantId))
        .thenReturn(Optional.empty());

    assertThatThrownBy(
            () ->
                service.updateDraft(
                    tenantId,
                    id,
                    new WorkflowDefinitionUpdateRequest(
                        "New", null, VALID_GRAPH, java.time.Instant.now())))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("not found");
  }

  @Test
  void createAcceptsValidDiagramGeometry() {
    when(definitionRepository.save(any(WorkflowDefinition.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(versionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\","
            + "\"di\":{\"x\":120,\"y\":80,\"width\":200,\"height\":70,"
            + "\"laneId\":\"lane-1\",\"poolId\":\"pool-1\"}}],"
            + "\"transitions\":[{\"id\":\"t1\",\"from\":\"start\",\"to\":\"start\","
            + "\"di\":{\"waypoints\":[{\"x\":10,\"y\":20},{\"x\":30,\"y\":40}],"
            + "\"labelPosition\":{\"x\":20,\"y\":30}}}]}";

    service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph));

    verify(versionRepository).save(any(WorkflowVersion.class));
  }

  @Test
  void createAcceptsALegacyGraphWithoutDiagramInterchange() {
    when(definitionRepository.save(any(WorkflowDefinition.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(versionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));

    service.create(tenantId, new WorkflowDefinitionRequest("W", null, VALID_GRAPH));

    verify(versionRepository).save(any(WorkflowVersion.class));
  }

  @Test
  void createRejectsANonObjectTransitionDiagram() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\",\"di\":\"bad\"}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Transition 'transition' has a non-object di block");
  }

  @Test
  void createAcceptsDiagramWithoutLaneOrPoolMembership() {
    when(definitionRepository.save(any(WorkflowDefinition.class)))
        .thenAnswer(inv -> inv.getArgument(0));
    when(versionRepository.save(any(WorkflowVersion.class))).thenAnswer(inv -> inv.getArgument(0));
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\","
            + "\"di\":{\"x\":10,\"y\":20,\"width\":180,\"height\":64}}],"
            + "\"transitions\":[]}";

    service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph));

    verify(versionRepository).save(any(WorkflowVersion.class));
  }

  @Test
  void createRejectsNonPositiveDiagramSize() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\","
            + "\"di\":{\"x\":0,\"y\":0,\"width\":-1,\"height\":64}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("Invalid diagram geometry");
  }

  @Test
  void createRejectsNonObjectDiagram() {
    String graph = "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\",\"di\":\"bad\"}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("non-object di");
  }

  @Test
  void createRejectsNonNumericWaypoint() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\","
            + "\"di\":{\"waypoints\":[{\"x\":\"bad\",\"y\":2}]}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("invalid di.x");
  }

  @Test
  void createRejectsANonArrayWaypointList() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\","
            + "\"di\":{\"waypoints\":{}}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("waypoints must be an array");
  }

  @Test
  void createRejectsANonObjectWaypoint() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\","
            + "\"di\":{\"waypoints\":[\"bad\"]}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("non-object waypoint");
  }

  @Test
  void createRejectsAnInvalidLabelPosition() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\","
            + "\"di\":{\"waypoints\":[{\"x\":1,\"y\":2}],\"labelPosition\":\"bad\"}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("labelPosition must be an object");
  }

  @Test
  void createRejectsAnInvalidLaneIdentifier() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\","
            + "\"di\":{\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"laneId\":42}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("invalid di.laneId");
  }

  @Test
  void createRejectsAnOutOfRangeSize() {
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\","
            + "\"di\":{\"x\":0,\"y\":0,\"width\":100001,\"height\":10}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("out-of-range size");
  }

  @Test
  void createRejectsMoreThanTheWaypointLimit() {
    StringBuilder points = new StringBuilder();
    for (int index = 0; index <= 10_000; index++) {
      if (index > 0) {
        points.append(',');
      }
      points.append("{\"x\":").append(index).append(",\"y\":0}");
    }
    String graph =
        "{\"nodes\":[{\"id\":\"start\",\"type\":\"START\"},{\"id\":\"end\",\"type\":\"END\"}],"
            + "\"transitions\":[{\"from\":\"start\",\"to\":\"end\","
            + "\"di\":{\"waypoints\":["
            + points
            + "]}}]}";

    assertThatThrownBy(
            () -> service.create(tenantId, new WorkflowDefinitionRequest("W", null, graph)))
        .isInstanceOf(AwapException.class)
        .hasMessageContaining("waypoint limit");
  }
}
