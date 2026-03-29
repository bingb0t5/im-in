import type { WhatsAppFailureCode } from "./contracts";

export type WhatsAppSendJob =
  | WhatsAppSendTestJob
  | WhatsAppSendDisclosureJob
  | WhatsAppSendManualPostJob
  | WhatsAppSendCapacityUpdateJob;

export interface WhatsAppJoinGroupJob {
  type: "join_group";
  inviteUrl: string;
}

export type WhatsAppSendJobType =
  | "send_test"
  | "send_disclosure"
  | "send_manual_post"
  | "send_capacity_update";

export type WhatsAppJoinJobType = "join_group";

interface BaseWhatsAppSendJob {
  groupNameExact: string;
}

export interface WhatsAppSendTestJob extends BaseWhatsAppSendJob {
  type: "send_test";
  label?: string;
}

export interface WhatsAppSendDisclosureJob extends BaseWhatsAppSendJob {
  type: "send_disclosure";
  disclosureText?: string;
  helperName?: string;
}

export interface WhatsAppSendManualPostJob extends BaseWhatsAppSendJob {
  type: "send_manual_post";
  activityTitle: string;
  activityUrl: string;
  summary?: string;
  startsAtLabel?: string;
  locationLabel?: string;
}

export interface WhatsAppSendCapacityUpdateJob extends BaseWhatsAppSendJob {
  type: "send_capacity_update";
  activityTitle: string;
  spotsRemainingLabel: string;
  activityUrl?: string;
}

export interface ProcessSendJobResult {
  ok: boolean;
  jobType: WhatsAppSendJobType;
  groupNameExact: string;
  processedAt: string;
  failureCode?: WhatsAppFailureCode;
}

export interface ProcessJoinJobResult {
  ok: boolean;
  jobType: WhatsAppJoinJobType;
  processedAt: string;
  groupNameExact?: string;
  failureCode?: WhatsAppFailureCode;
}
