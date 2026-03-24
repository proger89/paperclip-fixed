import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";
import { publishLiveEvent, subscribeCompanyLiveEvents } from "../services/live-events.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";

const activityCalls: Array<Record<string, unknown>> = [];

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  checkout: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
  activityCalls.push(input);
  publishLiveEvent({
    companyId: String(input.companyId),
    type: "activity.logged",
    payload: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      runId: input.runId,
    },
  });
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({}),
  agentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  documentService: () => ({}),
  logActivity: mockLogActivity,
  projectService: () => mockProjectService,
  routineService: () => ({}),
  workProductService: () => ({}),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "agent",
      agentId,
      companyId,
      runId: "run-checkout-1",
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue checkout live events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activityCalls.length = 0;
    mockProjectService.getById.mockResolvedValue(null);
    mockIssueService.getById.mockResolvedValue({
      id: issueId,
      companyId,
      projectId: null,
      status: "todo",
      assigneeAgentId: agentId,
      assigneeUserId: null,
      createdByUserId: "board-user",
      identifier: "CMP-1",
      title: "Checkout regression",
    });
    mockIssueService.checkout.mockResolvedValue({
      id: issueId,
      companyId,
      projectId: null,
      status: "in_progress",
      assigneeAgentId: agentId,
      assigneeUserId: null,
      createdByUserId: "board-user",
      identifier: "CMP-1",
      title: "Checkout regression",
      checkoutRunId: "run-checkout-1",
    });
  });

  it("returns 200 even if a live-event subscriber throws during checkout activity logging", async () => {
    const unsubscribe = subscribeCompanyLiveEvents(
      companyId,
      () => {
        throw new Error("socket send failed");
      },
      { context: "test_throwing_listener" },
    );

    try {
      const res = await request(createApp())
        .post(`/api/issues/${issueId}/checkout`)
        .send({
          agentId,
          expectedStatuses: ["todo", "backlog", "blocked"],
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({
        id: issueId,
        status: "in_progress",
        assigneeAgentId: agentId,
        checkoutRunId: "run-checkout-1",
      }));
      expect(mockIssueService.checkout).toHaveBeenCalledWith(
        issueId,
        agentId,
        ["todo", "backlog", "blocked"],
        "run-checkout-1",
      );
      expect(mockLogActivity).toHaveBeenCalledTimes(1);
      expect(activityCalls).toHaveLength(1);
      expect(activityCalls[0]).toEqual(expect.objectContaining({
        companyId,
        action: "issue.checked_out",
        entityType: "issue",
        entityId: issueId,
        runId: "run-checkout-1",
      }));
      expect(mockHeartbeatService.wakeup).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });
});
