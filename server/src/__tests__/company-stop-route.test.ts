import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/index.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  cancelCompanyWork: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  companyPortabilityService: () => mockCompanyPortabilityService,
  companyService: () => mockCompanyService,
  heartbeatService: () => mockHeartbeatService,
  logActivity: mockLogActivity,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: ["company-1"],
    };
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function createCompany(status: "active" | "paused" | "archived") {
  const now = new Date("2026-03-23T09:00:00.000Z");
  return {
    id: "company-1",
    name: "Paperclip",
    description: null,
    status,
    issuePrefix: "PAP",
    issueCounter: 42,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireBoardApprovalForNewAgents: false,
    brandColor: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("company stop routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels company work when a company is paused through PATCH", async () => {
    mockCompanyService.getById.mockResolvedValue(createCompany("active"));
    mockCompanyService.update.mockResolvedValue(createCompany("paused"));
    const app = createApp();

    const res = await request(app)
      .patch("/api/companies/company-1")
      .send({ status: "paused" });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelCompanyWork).toHaveBeenCalledWith(
      "company-1",
      "Cancelled because the company was paused",
    );
  });

  it("cancels company work when a company is archived", async () => {
    mockCompanyService.archive.mockResolvedValue(createCompany("archived"));
    const app = createApp();

    const res = await request(app).post("/api/companies/company-1/archive");

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.cancelCompanyWork).toHaveBeenCalledWith(
      "company-1",
      "Cancelled because the company was archived",
    );
  });
});
