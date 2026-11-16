"use client";

import { useMutation } from "@tanstack/react-query";

import {
  copilotApprovalAssistance,
  copilotChat,
  copilotKnowledgeSearch,
  copilotTaskDecision,
  type CopilotApprovalPayload,
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

/** Two-step approval: call once to propose, then again with the proposal id/hash and confirm. */
export function useCopilotApproval() {
  return useMutation<CopilotResponseDto, Error, CopilotApprovalPayload>({
    mutationKey: queryKeys.copilot.approval(),
    mutationFn: copilotApprovalAssistance,
  });
}

export function useCopilotKnowledgeSearch() {
  return useMutation<CopilotResponseDto, Error, string>({
    mutationKey: queryKeys.copilot.knowledge(),
    mutationFn: copilotKnowledgeSearch,
  });
}
