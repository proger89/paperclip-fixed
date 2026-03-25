import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { DEFAULT_COMPANY_SETTINGS } from "../src/constants.js";

const originalFetch = globalThis.fetch;

function enabledCompanySettings(companyId: string) {
  return {
    id: `settings-${companyId}`,
    companyId,
    pluginId: "plugin-install-1",
    enabled: true,
    settingsJson: {
      publishing: {
        ...DEFAULT_COMPANY_SETTINGS.publishing,
        botTokenSecretRef: "secret-1",
      },
      taskBot: {
        ...DEFAULT_COMPANY_SETTINGS.taskBot,
        enabled: true,
        pollingEnabled: true,
      },
    },
    lastError: null,
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
  };
}

describe("telegram channel connector plugin", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("tests Telegram connectivity with getMe and getChat", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/getMe")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            id: 1001,
            is_bot: true,
            first_name: "Paperclip Bot",
            username: "paperclip_test_bot",
            can_join_groups: true,
            can_read_all_group_messages: false,
          },
        }));
      }
      if (input.includes("/getChat")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            id: -1001234567890,
            type: "channel",
            title: "Paperclip News",
            username: "paperclip_news",
          },
        }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({
      manifest,
      config: {
        botTokenSecretRef: "11111111-1111-4111-8111-111111111111",
        defaultChatId: "@paperclip_news",
      },
    });

    await plugin.definition.setup(harness.ctx);
    const result = await harness.performAction<{
      connected: boolean;
      bot: { username: string | null };
      defaultChat: { username: string | null } | null;
    }>("test-connection", {
      companyId: "company-1",
    });

    expect(result.connected).toBe(true);
    expect(result.bot.username).toBe("paperclip_test_bot");
    expect(result.defaultChat?.username).toBe("paperclip_news");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(harness.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "telegram.connection_test",
      }),
    ]));
  });

  it("publishes a Telegram message and records plugin state", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (!input.includes("/sendMessage")) {
        throw new Error(`Unexpected fetch: ${input}`);
      }
      return new Response(JSON.stringify({
        ok: true,
        result: {
          message_id: 77,
          date: 1710000000,
          text: "Fresh publish",
          chat: {
            id: -1001234567890,
            type: "channel",
            title: "Paperclip News",
            username: "paperclip_news",
          },
        },
      }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({
      manifest,
      config: {
        botTokenSecretRef: "11111111-1111-4111-8111-111111111111",
        defaultChatId: "@paperclip_news",
        defaultPublicHandle: "@paperclip_news",
      },
    });

    await plugin.definition.setup(harness.ctx);
    const publication = await harness.performAction<{
      externalId: string;
      url: string | null;
      issueId: string | null;
      destinationLabel: string;
    }>("publish-message", {
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "PAP-101",
      issueTitle: "Ship Telegram integration",
      approvalId: "approval-1",
      text: "Fresh publish",
      destinationLabel: "@paperclip_news",
    });

    const issuePublications = await harness.getData<Array<{ externalId: string }>>("issue-publications", {
      companyId: "company-1",
      issueId: "issue-1",
    });

    expect(publication.externalId).toBe("-1001234567890:77");
    expect(publication.url).toBe("https://t.me/paperclip_news/77");
    expect(publication.issueId).toBe("issue-1");
    expect(issuePublications[0]?.externalId).toBe("-1001234567890:77");
    expect(harness.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "issue",
        entityId: "issue-1",
      }),
    ]));
    expect(harness.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "telegram.publish",
      }),
    ]));
  });

  it("links a Telegram private chat via /start code and persists update offsets in company state", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        const payload = init?.body ? JSON.parse(String(init.body)) as { offset?: number } : {};
        if ((payload.offset ?? 0) <= 0) {
          return new Response(JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 100,
                message: {
                  message_id: 7,
                  date: 1710000000,
                  text: "/start LINK1234",
                  chat: {
                    id: 555001,
                    type: "private",
                  },
                  from: {
                    id: 555001,
                    first_name: "Alex",
                    username: "alex_ops",
                  },
                },
              },
            ],
          }));
        }
        expect(payload.offset).toBe(101);
        return new Response(JSON.stringify({
          ok: true,
          result: [],
        }));
      }

      if (input.includes("/sendMessage")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 8,
            date: 1710000001,
            text: "linked",
            chat: {
              id: 555001,
              type: "private",
              username: "alex_ops",
              first_name: "Alex",
            },
          },
        }));
      }

      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({
      manifest,
    });

    harness.seed({
      companySettings: [
        {
          id: "settings-1",
          companyId: "company-1",
          pluginId: "plugin-install-1",
          enabled: true,
          settingsJson: {
            publishing: {
              ...DEFAULT_COMPANY_SETTINGS.publishing,
              botTokenSecretRef: "secret-1",
            },
            taskBot: {
              ...DEFAULT_COMPANY_SETTINGS.taskBot,
              enabled: true,
              pollingEnabled: true,
            },
          },
          lastError: null,
          createdAt: "2026-03-25T10:00:00.000Z",
          updatedAt: "2026-03-25T10:00:00.000Z",
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    const linkCode = await harness.performAction<{ code: string }>("generate-link-code", {
      companyId: "company-1",
      boardUserId: "user-1",
    });

    expect(linkCode.code).toHaveLength(8);

    await harness.ctx.entities.upsert({
      entityType: "telegram-claim-code",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "LINK1234",
      title: "Telegram link code LINK1234",
      status: "active",
      data: {
        code: "LINK1234",
        companyId: "company-1",
        boardUserId: "user-1",
        createdAt: "2026-03-25T10:00:00.000Z",
        expiresAt: "2099-03-25T10:30:00.000Z",
        consumedAt: null,
      },
    });

    await harness.runJob("sync-telegram");
    await harness.runJob("sync-telegram");

    const overview = await harness.getData<{
      linkedChats: Array<{ chatId: string; boardUserId: string | null; username: string | null; revokedAt: string | null }>;
      botHealth: { lastUpdateId: number | null };
    }>("overview", {
      companyId: "company-1",
    });

    expect(overview.linkedChats).toEqual([
      expect.objectContaining({
        chatId: "555001",
        boardUserId: "user-1",
        username: "alex_ops",
        revokedAt: null,
      }),
    ]);
    expect(overview.botHealth.lastUpdateId).toBe(100);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("creates an issue comment from a Telegram reply and wakes the assignee agent", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 200,
              message: {
                message_id: 19,
                date: 1710001000,
                text: "Please continue with the blocker fix.",
                chat: {
                  id: 555002,
                  type: "private",
                },
                from: {
                  id: 555002,
                  first_name: "Nina",
                  username: "nina_board",
                },
                reply_to_message: {
                  message_id: 900,
                  chat: {
                    id: 555002,
                    type: "private",
                  },
                },
              },
            },
          ],
        }));
      }

      if (input.includes("/sendMessage")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 20,
            date: 1710001001,
            text: "Ack",
            chat: {
              id: 555002,
              type: "private",
            },
          },
        }));
      }

      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({
      manifest,
    });

    harness.seed({
      issues: [
        {
          id: "issue-1",
          companyId: "company-1",
          projectId: null,
          projectWorkspaceId: null,
          goalId: null,
          parentId: null,
          title: "Fix Telegram blocker",
          description: "Reply from Telegram should wake the assignee.",
          status: "blocked",
          priority: "high",
          assigneeAgentId: "agent-1",
          assigneeUserId: null,
          reviewerAgentId: null,
          reviewerUserId: null,
          reviewPolicyKey: null,
          acceptanceChecklistJson: null,
          checkoutRunId: null,
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          createdByAgentId: null,
          createdByUserId: null,
          issueNumber: 12,
          identifier: "PAP-12",
          requestDepth: 0,
          billingCode: null,
          assigneeAdapterOverrides: null,
          executionWorkspaceId: null,
          executionWorkspacePreference: null,
          executionWorkspaceSettings: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          hiddenAt: null,
          createdAt: new Date("2026-03-25T09:00:00.000Z"),
          updatedAt: new Date("2026-03-25T09:30:00.000Z"),
        },
      ],
      agents: [
        {
          id: "agent-1",
          companyId: "company-1",
          name: "builder",
          urlKey: "builder",
          role: "engineer",
          title: null,
          icon: null,
          reportsTo: null,
          capabilities: null,
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          spentMonthlyCents: 0,
          status: "idle",
          pauseReason: null,
          pausedAt: null,
          permissions: {
            canCreateAgents: false,
          },
          lastHeartbeatAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:00:00.000Z"),
          metadata: null,
        },
      ],
      companySettings: [
        {
          id: "settings-1",
          companyId: "company-1",
          pluginId: "plugin-install-1",
          enabled: true,
          settingsJson: {
            publishing: {
              ...DEFAULT_COMPANY_SETTINGS.publishing,
              botTokenSecretRef: "secret-1",
            },
            taskBot: {
              ...DEFAULT_COMPANY_SETTINGS.taskBot,
              enabled: true,
              pollingEnabled: true,
            },
          },
          lastError: null,
          createdAt: "2026-03-25T10:00:00.000Z",
          updatedAt: "2026-03-25T10:00:00.000Z",
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);

    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555002",
      title: "@nina_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555002",
        telegramUserId: 555002,
        username: "nina_board",
        displayName: "Nina",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });
    await harness.ctx.entities.upsert({
      entityType: "telegram-thread-link",
      scopeKind: "issue",
      scopeId: "issue-1",
      externalId: "555002:900",
      title: "thread",
      status: "linked",
      data: {
        companyId: "company-1",
        issueId: "issue-1",
        chatId: "555002",
        messageId: 900,
        direction: "outbound",
        linkedAt: "2026-03-25T10:00:00.000Z",
        reason: "notification:blocked",
      },
    });

    await harness.runJob("sync-telegram");

    const comments = await harness.ctx.issues.listComments("issue-1", "company-1");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Telegram reply from Nina");
    expect(comments[0]?.body).toContain("Please continue with the blocker fix.");
    expect(harness.agentInvocations).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        companyId: "company-1",
        reason: "telegram_reply",
      }),
    ]);
  });

  it("shows inbox summary with board approvals and my requests", async () => {
    const sentMessages: string[] = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 300,
              message: {
                message_id: 31,
                date: 1710002000,
                text: "/inbox",
                chat: {
                  id: 555003,
                  type: "private",
                },
                from: {
                  id: 555003,
                  first_name: "Olga",
                  username: "olga_board",
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/sendMessage")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { text?: string } : {};
        sentMessages.push(body.text ?? "");
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 32,
            date: 1710002001,
            text: body.text ?? "",
            chat: {
              id: 555003,
              type: "private",
            },
          },
        }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      issues: [
        {
          id: "issue-blocked",
          companyId: "company-1",
          projectId: null,
          projectWorkspaceId: null,
          goalId: null,
          parentId: null,
          title: "Blocked task",
          description: null,
          status: "blocked",
          priority: "high",
          assigneeAgentId: null,
          assigneeUserId: "user-1",
          reviewerAgentId: null,
          reviewerUserId: null,
          reviewPolicyKey: null,
          acceptanceChecklistJson: null,
          checkoutRunId: null,
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          createdByAgentId: null,
          createdByUserId: "user-1",
          issueNumber: 44,
          identifier: "PAP-44",
          requestDepth: 0,
          billingCode: null,
          assigneeAdapterOverrides: null,
          executionWorkspaceId: null,
          executionWorkspacePreference: null,
          executionWorkspaceSettings: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          hiddenAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:10:00.000Z"),
        },
        {
          id: "issue-review",
          companyId: "company-1",
          projectId: null,
          projectWorkspaceId: null,
          goalId: null,
          parentId: null,
          title: "Review task",
          description: null,
          status: "in_review",
          priority: "medium",
          assigneeAgentId: null,
          assigneeUserId: "user-1",
          reviewerAgentId: null,
          reviewerUserId: "user-1",
          reviewPolicyKey: null,
          acceptanceChecklistJson: null,
          checkoutRunId: null,
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          createdByAgentId: null,
          createdByUserId: "user-1",
          issueNumber: 45,
          identifier: "PAP-45",
          requestDepth: 0,
          billingCode: null,
          assigneeAdapterOverrides: null,
          executionWorkspaceId: null,
          executionWorkspacePreference: null,
          executionWorkspaceSettings: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
          hiddenAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:12:00.000Z"),
        },
      ],
      approvals: [
        {
          id: "approval-pending",
          companyId: "company-1",
          type: "publish_content",
          requestedByAgentId: null,
          requestedByUserId: "user-1",
          status: "pending",
          payload: { channel: "telegram" },
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:20:00.000Z"),
        },
        {
          id: "approval-revision",
          companyId: "company-1",
          type: "install_connector_plugin",
          requestedByAgentId: null,
          requestedByUserId: "user-1",
          status: "revision_requested",
          payload: { packageName: "@paperclipai/plugin-telegram-channel-connector" },
          decisionNote: "Need approval context",
          decidedByUserId: "user-2",
          decidedAt: new Date("2026-03-25T08:21:00.000Z"),
          createdAt: new Date("2026-03-25T08:05:00.000Z"),
          updatedAt: new Date("2026-03-25T08:21:00.000Z"),
        },
      ],
      joinRequests: [
        {
          id: "join-1",
          inviteId: "invite-1",
          companyId: "company-1",
          requestType: "agent",
          status: "pending_approval",
          requestIp: "127.0.0.1",
          requestingUserId: null,
          requestEmailSnapshot: null,
          agentName: "ops-bot",
          adapterType: "codex_local",
          capabilities: null,
          agentDefaultsPayload: null,
          claimSecretExpiresAt: null,
          claimSecretConsumedAt: null,
          createdAgentId: null,
          approvedByUserId: null,
          approvedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
          createdAt: new Date("2026-03-25T08:06:00.000Z"),
          updatedAt: new Date("2026-03-25T08:06:00.000Z"),
        },
      ],
      budgetOverviews: [
        {
          companyId: "company-1",
          policies: [],
          activeIncidents: [
            {
              id: "incident-1",
              companyId: "company-1",
              policyId: "policy-1",
              scopeType: "project",
              scopeId: "project-1",
              scopeName: "Project One",
              metric: "billed_cents",
              windowKind: "calendar_month_utc",
              windowStart: new Date("2026-03-01T00:00:00.000Z"),
              windowEnd: new Date("2026-04-01T00:00:00.000Z"),
              thresholdType: "hard",
              amountLimit: 50000,
              amountObserved: 62000,
              status: "open",
              approvalId: null,
              approvalStatus: null,
              resolvedAt: null,
              createdAt: new Date("2026-03-25T08:07:00.000Z"),
              updatedAt: new Date("2026-03-25T08:07:00.000Z"),
            },
          ],
          pausedAgentCount: 0,
          pausedProjectCount: 1,
          pendingApprovalCount: 0,
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555003",
      title: "@olga_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555003",
        telegramUserId: 555003,
        username: "olga_board",
        displayName: "Olga",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });

    await harness.runJob("sync-telegram");

    expect(sentMessages.some((text) =>
      text.includes("Paperclip inbox")
      && text.includes("Blocked tasks: 1")
      && text.includes("Tasks in review: 1")
      && text.includes("Board approvals: 2")
      && text.includes("My pending approvals: 1")
      && text.includes("My revisions: 1")
      && text.includes("Pending join requests: 1")
      && text.includes("Open budget incidents: 1"),
    )).toBe(true);
  });

  it("approves an approval from Telegram callback actions", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 301,
              callback_query: {
                id: "cb-1",
                from: {
                  id: 555004,
                  first_name: "Max",
                  username: "max_board",
                },
                data: "approval_decision:approval-1:approve:board",
                message: {
                  message_id: 77,
                  chat: {
                    id: 555004,
                    type: "private",
                  },
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/editMessageText")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 77,
            date: 1710002100,
            text: init?.body ? JSON.parse(String(init.body)).text : "",
            chat: {
              id: 555004,
              type: "private",
            },
          },
        }));
      }
      if (input.includes("/answerCallbackQuery")) {
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      approvals: [
        {
          id: "approval-1",
          companyId: "company-1",
          type: "publish_content",
          requestedByAgentId: null,
          requestedByUserId: "user-1",
          status: "pending",
          payload: { channel: "telegram", issueIds: [] },
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:00:00.000Z"),
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555004",
      title: "@max_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555004",
        telegramUserId: 555004,
        username: "max_board",
        displayName: "Max",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });

    await harness.runJob("sync-telegram");

    const approval = await harness.ctx.approvals.get("approval-1");
    expect(approval?.status).toBe("approved");
    expect(approval?.decidedByUserId).toBe("user-1");
  });

  it("creates an approval comment from a Telegram reply and wakes the requesting agent", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 302,
              message: {
                message_id: 90,
                date: 1710002200,
                text: "Approved after the latest context, continue.",
                chat: {
                  id: 555005,
                  type: "private",
                },
                from: {
                  id: 555005,
                  first_name: "Nora",
                  username: "nora_board",
                },
                reply_to_message: {
                  message_id: 901,
                  chat: {
                    id: 555005,
                    type: "private",
                  },
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/sendMessage")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 91,
            date: 1710002201,
            text: "Ack",
            chat: {
              id: 555005,
              type: "private",
            },
          },
        }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      approvals: [
        {
          id: "approval-2",
          companyId: "company-1",
          type: "install_company_skill",
          requestedByAgentId: "agent-2",
          requestedByUserId: "user-1",
          status: "pending",
          payload: { skillId: "skill-1" },
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:00:00.000Z"),
        },
      ],
      agents: [
        {
          id: "agent-2",
          companyId: "company-1",
          name: "approver-agent",
          urlKey: "approver-agent",
          role: "general",
          title: null,
          icon: null,
          reportsTo: null,
          capabilities: null,
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          spentMonthlyCents: 0,
          status: "idle",
          pauseReason: null,
          pausedAt: null,
          permissions: { canCreateAgents: false },
          lastHeartbeatAt: null,
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:00:00.000Z"),
          metadata: null,
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555005",
      title: "@nora_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555005",
        telegramUserId: 555005,
        username: "nora_board",
        displayName: "Nora",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });
    await harness.ctx.entities.upsert({
      entityType: "telegram-thread-link",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555005:901",
      title: "approval-thread",
      status: "linked",
      data: {
        companyId: "company-1",
        resourceType: "approval",
        resourceId: "approval-2",
        approvalId: "approval-2",
        chatId: "555005",
        messageId: 901,
        direction: "outbound",
        linkedAt: "2026-03-25T10:00:00.000Z",
        reason: "notification:approval.created",
      },
    });

    await harness.runJob("sync-telegram");

    const comments = await harness.ctx.approvals.listComments("approval-2");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("Telegram reply from Nora");
    expect(comments[0]?.body).toContain("Approved after the latest context, continue.");
    expect(harness.agentInvocations).toEqual([
      expect.objectContaining({
        agentId: "agent-2",
        companyId: "company-1",
        reason: "telegram_approval_reply",
      }),
    ]);
  });

  it("resubmits a revision-requested personal approval from Telegram", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 303,
              callback_query: {
                id: "cb-resubmit",
                from: {
                  id: 555007,
                  first_name: "Ira",
                  username: "ira_board",
                },
                data: "approval_decision:approval-4:resubmit:mine",
                message: {
                  message_id: 88,
                  chat: {
                    id: 555007,
                    type: "private",
                  },
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/editMessageText")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 88,
            date: 1710002250,
            text: init?.body ? JSON.parse(String(init.body)).text : "",
            chat: {
              id: 555007,
              type: "private",
            },
          },
        }));
      }
      if (input.includes("/answerCallbackQuery")) {
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      approvals: [
        {
          id: "approval-4",
          companyId: "company-1",
          type: "install_company_skill",
          requestedByAgentId: null,
          requestedByUserId: "user-1",
          status: "revision_requested",
          payload: { skillId: "design-review" },
          decisionNote: "Please confirm scope",
          decidedByUserId: "user-2",
          decidedAt: new Date("2026-03-25T08:30:00.000Z"),
          createdAt: new Date("2026-03-25T08:00:00.000Z"),
          updatedAt: new Date("2026-03-25T08:30:00.000Z"),
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555007",
      title: "@ira_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555007",
        telegramUserId: 555007,
        username: "ira_board",
        displayName: "Ira",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });

    await harness.runJob("sync-telegram");

    const approval = await harness.ctx.approvals.get("approval-4");
    expect(approval?.status).toBe("pending");
    expect(approval?.decisionNote).toBeNull();
    expect(approval?.decidedByUserId).toBeNull();
  });

  it("approves join requests from Telegram callback actions", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 304,
              callback_query: {
                id: "cb-join",
                from: {
                  id: 555008,
                  first_name: "Petr",
                  username: "petr_board",
                },
                data: "join_decision:join-2:approve",
                message: {
                  message_id: 99,
                  chat: {
                    id: 555008,
                    type: "private",
                  },
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/editMessageText")) {
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 99,
            date: 1710002260,
            text: init?.body ? JSON.parse(String(init.body)).text : "",
            chat: {
              id: 555008,
              type: "private",
            },
          },
        }));
      }
      if (input.includes("/answerCallbackQuery")) {
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      joinRequests: [
        {
          id: "join-2",
          inviteId: "invite-join-2",
          companyId: "company-1",
          requestType: "human",
          status: "pending_approval",
          requestIp: "127.0.0.1",
          requestingUserId: "user-9",
          requestEmailSnapshot: "new.user@example.com",
          agentName: null,
          adapterType: null,
          capabilities: null,
          agentDefaultsPayload: null,
          claimSecretExpiresAt: null,
          claimSecretConsumedAt: null,
          createdAgentId: null,
          approvedByUserId: null,
          approvedAt: null,
          rejectedByUserId: null,
          rejectedAt: null,
          createdAt: new Date("2026-03-25T08:40:00.000Z"),
          updatedAt: new Date("2026-03-25T08:40:00.000Z"),
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555008",
      title: "@petr_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555008",
        telegramUserId: 555008,
        username: "petr_board",
        displayName: "Petr",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });

    await harness.runJob("sync-telegram");

    const joinRequest = await harness.ctx.joinRequests.list("company-1");
    expect(joinRequest.find((entry) => entry.id === "join-2")?.status).toBe("approved");
  });

  it("handles budget raise-and-resume via Telegram wizard", async () => {
    const sentMessages: string[] = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { offset?: number } : {};
        if ((body.offset ?? 0) <= 0) {
          return new Response(JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 305,
                callback_query: {
                  id: "cb-budget",
                  from: {
                    id: 555009,
                    first_name: "Lena",
                    username: "lena_board",
                  },
                  data: "budget_decision:incident-2:raise",
                  message: {
                    message_id: 111,
                    chat: {
                      id: 555009,
                      type: "private",
                    },
                  },
                },
              },
            ],
          }));
        }
        return new Response(JSON.stringify({
          ok: true,
          result: [
            {
              update_id: 306,
              message: {
                message_id: 112,
                date: 1710002270,
                text: "125.00",
                chat: {
                  id: 555009,
                  type: "private",
                },
                from: {
                  id: 555009,
                  first_name: "Lena",
                  username: "lena_board",
                },
              },
            },
          ],
        }));
      }
      if (input.includes("/sendMessage")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { text?: string } : {};
        sentMessages.push(body.text ?? "");
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 113,
            date: 1710002271,
            text: body.text ?? "",
            chat: {
              id: 555009,
              type: "private",
            },
          },
        }));
      }
      if (input.includes("/answerCallbackQuery")) {
        return new Response(JSON.stringify({ ok: true, result: true }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      budgetOverviews: [
        {
          companyId: "company-1",
          policies: [],
          activeIncidents: [
            {
              id: "incident-2",
              companyId: "company-1",
              policyId: "policy-2",
              scopeType: "project",
              scopeId: "project-2",
              scopeName: "Growth Dashboard",
              metric: "billed_cents",
              windowKind: "calendar_month_utc",
              windowStart: new Date("2026-03-01T00:00:00.000Z"),
              windowEnd: new Date("2026-04-01T00:00:00.000Z"),
              thresholdType: "hard",
              amountLimit: 5000,
              amountObserved: 7200,
              status: "open",
              approvalId: null,
              approvalStatus: null,
              resolvedAt: null,
              createdAt: new Date("2026-03-25T08:50:00.000Z"),
              updatedAt: new Date("2026-03-25T08:50:00.000Z"),
            },
          ],
          pausedAgentCount: 0,
          pausedProjectCount: 1,
          pendingApprovalCount: 0,
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555009",
      title: "@lena_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555009",
        telegramUserId: 555009,
        username: "lena_board",
        displayName: "Lena",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });

    await harness.runJob("sync-telegram");
    await harness.runJob("sync-telegram");

    const overview = await harness.ctx.budgets.overview("company-1");
    expect(overview.activeIncidents).toHaveLength(0);
    expect(sentMessages.some((text) => text.includes("Send the new budget amount in dollars"))).toBe(true);
    expect(sentMessages.some((text) => text.includes("Budget incident resolved"))).toBe(true);
  });

  it("deduplicates approval notifications even if the approval cursor is replayed", async () => {
    const sentMessages: string[] = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/getUpdates")) {
        return new Response(JSON.stringify({ ok: true, result: [] }));
      }
      if (input.includes("/sendMessage")) {
        const body = init?.body ? JSON.parse(String(init.body)) as { text?: string } : {};
        sentMessages.push(body.text ?? "");
        return new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 120,
            date: 1710002300,
            text: body.text ?? "",
            chat: {
              id: 555006,
              type: "private",
            },
          },
        }));
      }
      throw new Error(`Unexpected fetch: ${input}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const harness = createTestHarness({ manifest });
    harness.seed({
      companySettings: [enabledCompanySettings("company-1")],
      approvals: [
        {
          id: "approval-3",
          companyId: "company-1",
          type: "hire_agent",
          requestedByAgentId: null,
          requestedByUserId: "user-1",
          status: "pending",
          payload: { name: "Designer" },
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          createdAt: new Date("2026-03-25T00:30:00.000Z"),
          updatedAt: new Date("2026-03-25T00:30:00.000Z"),
        },
      ],
      activityEvents: [
        {
          id: "activity-approval-1",
          companyId: "company-1",
          runId: null,
          actorType: "user",
          actorId: "user-2",
          agentId: null,
          action: "approval.created",
          entityType: "approval",
          entityId: "approval-3",
          details: {},
          createdAt: new Date("2026-03-25T01:00:00.000Z"),
        },
      ],
    });

    await plugin.definition.setup(harness.ctx);
    await harness.ctx.entities.upsert({
      entityType: "telegram-linked-chat",
      scopeKind: "company",
      scopeId: "company-1",
      externalId: "555006",
      title: "@pavel_board",
      status: "linked",
      data: {
        companyId: "company-1",
        chatId: "555006",
        telegramUserId: 555006,
        username: "pavel_board",
        displayName: "Pavel",
        boardUserId: "user-1",
        linkedAt: "2026-03-25T10:00:00.000Z",
        revokedAt: null,
      },
    });
    await harness.ctx.state.set({
      scopeKind: "company",
      scopeId: "company-1",
      stateKey: "bot-health",
    }, {
      checkedAt: "2026-03-25T00:00:00.000Z",
      ok: true,
      lastUpdateId: null,
      lastActivityCursor: "2026-03-25T00:00:00.000Z",
      lastNotificationAt: null,
      lastApprovalNotificationAt: null,
      openApprovalCount: 0,
      revisionApprovalCount: 0,
      error: null,
    });

    await harness.runJob("sync-telegram");
    await harness.ctx.state.set({
      scopeKind: "company",
      scopeId: "company-1",
      stateKey: "bot-health",
    }, {
      checkedAt: "2026-03-25T00:00:00.000Z",
      ok: true,
      lastUpdateId: null,
      lastActivityCursor: "2026-03-25T00:00:00.000Z",
      lastNotificationAt: null,
      lastApprovalNotificationAt: null,
      openApprovalCount: 0,
      revisionApprovalCount: 0,
      error: null,
    });
    await harness.runJob("sync-telegram");

    expect(sentMessages.filter((text) => text.includes("My request updated")).length).toBe(1);
    const overview = await harness.getData<{
      botHealth: {
        lastApprovalNotificationAt: string | null;
        openApprovalCount: number;
        revisionApprovalCount: number;
      } | null;
    }>("overview", { companyId: "company-1" });
    expect(overview.botHealth?.openApprovalCount).toBe(1);
    expect(overview.botHealth?.revisionApprovalCount).toBe(0);
  });
});
