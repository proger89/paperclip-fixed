import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getAncestors: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  getByIdentifier: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  listByIds: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
}));

const mockExecutionWorkspaceService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockDocumentService = vi.hoisted(() => ({
  getIssueDocumentPayload: vi.fn(),
}));

const mockWorkProductService = vi.hoisted(() => ({
  listForIssue: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => mockDocumentService,
  executionWorkspaceService: () => mockExecutionWorkspaceService,
  goalService: () => mockGoalService,
  heartbeatService: () => ({}),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectService: () => mockProjectService,
  routineService: () => ({}),
  workProductService: () => mockWorkProductService,
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

describe("legacy task detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      goalId: null,
      projectId: null,
      executionWorkspaceId: null,
      identifier: "PAP-1",
      title: "Bootstrap CEO task",
      status: "todo",
    });
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockDocumentService.getIssueDocumentPayload.mockResolvedValue({});
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);
    mockWorkProductService.listForIssue.mockResolvedValue([]);
  });

  it("serves issue detail from the legacy /api/v1/tasks/:id alias", async () => {
    const res = await request(createApp())
      .get("/api/v1/tasks/11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
      title: "Bootstrap CEO task",
      mentionedProjects: [],
      workProducts: [],
      currentExecutionWorkspace: null,
      goal: null,
      project: null,
    });
    expect(mockIssueService.getById).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
});
