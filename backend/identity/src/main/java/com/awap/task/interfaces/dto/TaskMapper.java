package com.awap.task.interfaces.dto;

import com.awap.task.domain.Task;
import com.awap.task.domain.TaskStatus;
import com.awap.task.domain.TaskType;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

/** Maps task entities to their public representation. */
@Mapper(componentModel = "spring")
public interface TaskMapper {

  @Mapping(target = "status", source = "status", qualifiedByName = "statusToString")
  @Mapping(target = "taskType", source = "taskType", qualifiedByName = "taskTypeToString")
  TaskResponse toResponse(Task task);

  @Named("statusToString")
  default String statusToString(TaskStatus status) {
    return status == null ? null : status.name();
  }

  @Named("taskTypeToString")
  default String taskTypeToString(TaskType taskType) {
    return taskType == null ? null : taskType.name();
  }
}
