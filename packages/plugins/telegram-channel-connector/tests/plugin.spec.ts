import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const originalFetch = globalThis.fetch;

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
});
