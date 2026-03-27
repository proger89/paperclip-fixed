export type TelegramParseMode = "" | "HTML" | "MarkdownV2";

export type LegacyTelegramConfig = {
  botTokenSecretRef?: string;
  defaultChatId?: string;
  defaultPublicHandle?: string;
  defaultParseMode?: TelegramParseMode;
  defaultDisableLinkPreview?: boolean;
  defaultDisableNotification?: boolean;
};

export type TelegramPublishingSettings = {
  botTokenSecretRef: string;
  defaultChatId?: string;
  defaultPublicHandle?: string;
  defaultParseMode?: TelegramParseMode;
  defaultDisableLinkPreview?: boolean;
  defaultDisableNotification?: boolean;
  destinations: TelegramDestination[];
  defaultDestinationId: string;
};

export type TelegramPublishingAiSettings = {
  adapterType: "codex_local";
  model: string;
  reasoningEffort: "low" | "medium" | "high";
};

export type TelegramTaskBotSettings = {
  enabled: boolean;
  pollingEnabled: boolean;
  notificationMode: "linked_only" | "fallback_all_linked";
  claimCodeTtlMinutes: number;
};

export type TelegramIngestionSourceMode = "channel_posts" | "discussion_replies" | "both";

export type TelegramDestination = {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  parseMode: TelegramParseMode;
  disableLinkPreview: boolean;
  disableNotification: boolean;
  enabled: boolean;
  isDefault: boolean;
};

export type TelegramIngestionSource = {
  id: string;
  label: string;
  chatId: string;
  publicHandle: string;
  discussionChatId: string;
  mode: TelegramIngestionSourceMode;
  enabled: boolean;
  projectId: string;
  assigneeAgentId: string;
  routineId: string;
  issueTemplateKey: string;
};

export type TelegramCompanySettings = {
  publishing: TelegramPublishingSettings;
  taskBot: TelegramTaskBotSettings;
  ai: TelegramPublishingAiSettings;
  ingestion: {
    sources: TelegramIngestionSource[];
  };
};

export type TelegramPublication = {
  externalId: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  companyId: string;
  destinationLabel: string;
  chatId: string;
  chatTitle: string | null;
  publicHandle: string | null;
  messageId: number;
  url: string | null;
  approvalId: string | null;
  parseMode: string | null;
  sentAt: string;
  summary: string;
  destinationId: string | null;
};

export type TelegramLinkedChat = {
  companyId: string;
  chatId: string;
  telegramUserId: number;
  username: string | null;
  displayName: string;
  boardUserId: string | null;
  linkedAt: string;
  revokedAt: string | null;
};

export type TelegramBotHealth = {
  checkedAt: string;
  ok: boolean;
  lastUpdateId: number | null;
  lastActivityCursor: string | null;
  lastNotificationAt: string | null;
  lastApprovalNotificationAt: string | null;
  lastControlPlaneNotificationAt: string | null;
  lastIngestionAt: string | null;
  lastPublishDispatchAt: string | null;
  openApprovalCount: number;
  revisionApprovalCount: number;
  openJoinRequestCount: number;
  openBudgetIncidentCount: number;
  scheduledPublishCount: number;
  failedPublishCount: number;
  ingestedStoryCount: number;
  error: string | null;
};

export type TelegramThreadLinkRecord = {
  companyId: string;
  resourceType?: "issue" | "approval" | "join_request" | "budget_incident";
  resourceId?: string;
  issueId?: string;
  approvalId?: string;
  joinRequestId?: string;
  budgetIncidentId?: string;
  chatId: string;
  messageId: number;
  direction: "outbound";
  linkedAt: string;
  reason: string;
};

export type TelegramApprovalThreadLink = TelegramThreadLinkRecord & {
  resourceType: "approval";
  resourceId: string;
  approvalId: string;
};

export type TelegramPublicationJobStatus =
  | "pending"
  | "scheduled"
  | "sending"
  | "published"
  | "failed"
  | "cancelled";

export type TelegramPublicationJob = {
  id?: string;
  companyId: string;
  issueId: string;
  approvalId: string | null;
  destinationId: string;
  publishAt: string;
  status: TelegramPublicationJobStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  failureReason: string | null;
  publishedMessageId: number | null;
  publishedUrl: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TelegramSourceMessageRecord = {
  companyId: string;
  sourceId: string;
  chatId: string;
  messageId: number;
  routineRunId: string | null;
  issueId: string | null;
  messageDate: string | null;
  discussionChatId: string | null;
  excerpt: string | null;
  hash: string | null;
  direction: "inbound";
  linkedAt: string;
};

export type TelegramInboxSummary = {
  blockedTaskCount: number;
  reviewTaskCount: number;
  actionableApprovalCount: number;
  myPendingApprovalCount: number;
  myRevisionApprovalCount: number;
  pendingJoinRequestCount: number;
  openBudgetIncidentCount: number;
};

export type TelegramBudgetWizardState = {
  kind: "budget_raise_amount";
  incidentId: string;
  companyId: string;
  chatId: string;
  boardUserId: string | null;
  telegramUserId: number;
  startedAt: string;
};

export type TelegramOverview = {
  configured: boolean;
  config?: {
    defaultChatId?: string | null;
    defaultPublicHandle?: string | null;
    defaultParseMode?: string | null;
    defaultDisableLinkPreview?: boolean;
    defaultDisableNotification?: boolean;
  };
  companySettings: TelegramCompanySettings;
  legacyConfigDetected: boolean;
  destinations: TelegramDestination[];
  sources: TelegramIngestionSource[];
  linkedChats: TelegramLinkedChat[];
  botHealth: TelegramBotHealth | null;
  lastValidation?: {
    checkedAt: string;
    connected: boolean;
    bot?: {
      username?: string | null;
      firstName?: string | null;
    } | null;
    defaultChat?: {
      id: string;
      title?: string | null;
      username?: string | null;
      type?: string | null;
    } | null;
  } | null;
  lastPublication?: TelegramPublication | null;
  recentPublications: TelegramPublication[];
  scheduledPublications: TelegramPublicationJob[];
  recentIngestedStories: TelegramSourceMessageRecord[];
  blockedTaskCount: number;
  openTaskCount: number;
  reviewTaskCount: number;
  approvalsInboxEnabled: boolean;
  actionableApprovalCount: number;
  myPendingApprovalCount: number;
  myRevisionApprovalCount: number;
  pendingJoinRequestCount: number;
  openBudgetIncidentCount: number;
  scheduledPublishCount: number;
  failedPublishCount: number;
  ingestedStoryCount: number;
};
