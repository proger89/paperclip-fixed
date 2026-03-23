import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  listApprovalsForIssue: vi.fn(),
}));

const mockWorkProductService = vi.hoisted(() => ({
  createForIssue: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => ({}),
  agentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => ({}),
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  documentService: () => ({}),
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({}),
  workProductService: () => mockWorkProductService,
}));

function createApp(actorType: "agent" | "board" = "agent") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actorType === "agent"
      ? {
          type: "agent",
          agentId: "agent-1",
          companyId: "company-1",
          runId: "run-1",
        }
      : {
          type: "board",
          userId: "user-1",
          companyIds: ["company-1"],
          source: "session",
          isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

function createIssue() {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: null,
  };
}

function createWorkProduct(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-03-23T18:00:00.000Z");
  return {
    id: "work-product-1",
    companyId: "company-1",
    projectId: null,
    issueId: "issue-1",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "artifact",
    provider: "telegram",
    externalId: null,
    title: "Telegram publish",
    url: null,
    status: "draft",
    reviewState: "none",
    isPrimary: false,
    healthStatus: "unknown",
    summary: null,
    metadata: {
      publication: {
        channel: "telegram",
      },
    },
    createdByRunId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("issue publication guard routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(createIssue());
    mockIssueService.getByIdentifier.mockResolvedValue(null);
    mockIssueApprovalService.listApprovalsForIssue.mockResolvedValue([]);
    mockWorkProductService.createForIssue.mockResolvedValue(createWorkProduct());
    mockWorkProductService.getById.mockResolvedValue(createWorkProduct());
    mockWorkProductService.update.mockResolvedValue(createWorkProduct({ status: "active" }));
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("blocks agent publish result creation without an approved publish_content approval", async () => {
    const res = await request(createApp("agent"))
      .post("/api/issues/issue-1/work-products")
      .send({
        type: "artifact",
        provider: "telegram",
        title: "Published post",
        status: "active",
        url: "https://t.me/paperclip_ai/1",
        metadata: {
          publication: {
            channel: "telegram",
          },
        },
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("publish_content");
    expect(mockWorkProductService.createForIssue).not.toHaveBeenCalled();
  });

  it("allows agent draft publication placeholders before approval", async () => {
    const res = await request(createApp("agent"))
      .post("/api/issues/issue-1/work-products")
      .send({
        type: "artifact",
        provider: "telegram",
        title: "Draft placeholder",
        status: "draft",
        metadata: {
          publication: {
            channel: "telegram",
          },
        },
      });

    expect(res.status).toBe(201);
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledTimes(1);
  });

  it("allows agent publish result creation when the linked publish_content approval is approved", async () => {
    mockIssueApprovalService.listApprovalsForIssue.mockResolvedValue([
      {
        id: "approval-1",
        type: "publish_content",
        status: "approved",
      },
    ]);

    const res = await request(createApp("agent"))
      .post("/api/issues/issue-1/work-products")
      .send({
        type: "artifact",
        provider: "telegram",
        title: "Published post",
        status: "active",
        externalId: "telegram:1",
        metadata: {
          publication: {
            channel: "telegram",
            approvalId: "approval-1",
          },
        },
      });

    expect(res.status).toBe(201);
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledTimes(1);
  });

  it("blocks agent patching a draft publication into a published result without approval", async () => {
    mockWorkProductService.getById.mockResolvedValue(createWorkProduct({ status: "draft" }));

    const res = await request(createApp("agent"))
      .patch("/api/work-products/work-product-1")
      .send({
        status: "active",
        url: "https://t.me/paperclip_ai/1",
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("publish_content");
    expect(mockWorkProductService.update).not.toHaveBeenCalled();
  });

  it("allows board users to record publication results as a governance override", async () => {
    const res = await request(createApp("board"))
      .post("/api/issues/issue-1/work-products")
      .send({
        type: "artifact",
        provider: "telegram",
        title: "Manual publish record",
        status: "active",
        url: "https://t.me/paperclip_ai/1",
        metadata: {
          publication: {
            channel: "telegram",
          },
        },
      });

    expect(res.status).toBe(201);
    expect(mockWorkProductService.createForIssue).toHaveBeenCalledTimes(1);
  });
});
