"use client";

import { useMutation } from "@tanstack/react-query";

import {
  copilotChat,
  copilotKnowledgeSearch,
  copilotTaskDecision,
  type CopilotChatPayload,
  type CopilotResponseDto,
} from "../api";
import { queryKeys } from "../queryKeys";

/** Sends one copilot turn. Mutations are never retried (an action must not run twice). */
export function useCopilotChat() {
  return useMutation<CopilotResponseDto, Error, CopilotChatPayload>({
    mutationKey: queryKeys.copilot.chat(),
    mutationFn: copilotChat,
  });
}

export function useCopilotTaskDecision() {
  return useMutation<
    CopilotResponseDto,
    Error,
    { taskId: string; decision: "approve" | "reject" | "complete"; comment?: string }
  >({
    mutationKey: queryKeys.copilot.decision(),
    mutationFn: ({ taskId, decision, comment }) =>
      copilotTaskDecision(taskId, decision, comment, true),
  });
}

export function useCopilotKnowledgeSearch() {
  return useMutation<CopilotResponseDto, Error, string>({
    mutationKey: queryKeys.copilot.knowledge(),
    mutationFn: copilotKnowledgeSearch,
  });
}
