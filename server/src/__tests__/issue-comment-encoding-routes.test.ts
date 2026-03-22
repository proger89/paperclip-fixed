import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const storedComments: Array<{
  id: string;
  issueId: string;
  companyId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  authorAgentId: string | null;
  authorUserId: string | null;
}> = [];

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  addComment: vi.fn(),
  listComments: vi.fn(),
  findMentionedAgents: vi.fn(),
  assertCheckoutOwner: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({}),
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({}),
  workProductService: () => ({}),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue comment encoding routes", () => {
  beforeEach(() => {
    storedComments.length = 0;
    vi.clearAllMocks();

    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: "local-board",
      identifier: "PAP-UTF8",
      title: "Comment encoding round-trip",
      executionRunId: null,
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.assertCheckoutOwner.mockResolvedValue({
      adoptedFromRunId: null,
    });
    mockIssueService.addComment.mockImplementation(async (issueId: string, body: string) => {
      const comment = {
        id: `comment-${storedComments.length + 1}`,
        issueId,
        companyId: "company-1",
        body,
        createdAt: new Date(),
        updatedAt: new Date(),
        authorAgentId: null,
        authorUserId: "local-board",
      };
      storedComments.push(comment);
      return comment;
    });
    mockIssueService.listComments.mockImplementation(async () => [...storedComments]);
  });

  it("round-trips Cyrillic comment bodies through POST and GET routes", async () => {
    const body = "Привет, мир. Проверка UTF-8 для комментариев.";
    const app = createApp();

    const createResponse = await request(app)
      .post("/api/issues/11111111-1111-4111-8111-111111111111/comments")
      .send({ body });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.body).toBe(body);

    const listResponse = await request(app)
      .get("/api/issues/11111111-1111-4111-8111-111111111111/comments");

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toHaveLength(1);
    expect(listResponse.body[0]?.body).toBe(body);
  });
});
