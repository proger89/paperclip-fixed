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
  defaultChatId: string;
  defaultPublicHandle: string;
  defaultParseMode: TelegramParseMode;
  defaultDisableLinkPreview: boolean;
  defaultDisableNotification: boolean;
};

export type TelegramTaskBotSettings = {
  enabled: boolean;
  pollingEnabled: boolean;
  notificationMode: "linked_only" | "fallback_all_linked";
  claimCodeTtlMinutes: number;
};

export type TelegramCompanySettings = {
  publishing: TelegramPublishingSettings;
  taskBot: TelegramTaskBotSettings;
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
  openApprovalCount: number;
  revisionApprovalCount: number;
  openJoinRequestCount: number;
  openBudgetIncidentCount: number;
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
  blockedTaskCount: number;
  openTaskCount: number;
  reviewTaskCount: number;
  approvalsInboxEnabled: boolean;
  actionableApprovalCount: number;
  myPendingApprovalCount: number;
  myRevisionApprovalCount: number;
  pendingJoinRequestCount: number;
  openBudgetIncidentCount: number;
};
