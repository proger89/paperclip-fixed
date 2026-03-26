import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { ROLE_BUNDLES } from "../services/role-bundles.js";

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
  ensureMembership: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
}));
const mockBudgetService = vi.hoisted(() => ({}));
const mockHeartbeatService = vi.hoisted(() => ({}));
const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));
const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockAgentInstructionsService = vi.hoisted(() => ({
  getBundle: vi.fn(),
  readFile: vi.fn(),
  updateBundle: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  exportFiles: vi.fn(),
  ensureManagedBundle: vi.fn(),
  materializeManagedBundle: vi.fn(),
}));

const mockCompanySkillService = vi.hoisted(() => ({
  listFull: vi.fn(),
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  resolveAdapterConfigForRuntime: vi.fn(),
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockResolveRoleBundleConnectorCoverage = vi.hoisted(() => vi.fn());
const mockResolveRoleBundleSkillCoverage = vi.hoisted(() => vi.fn());

const mockAdapter = vi.hoisted(() => ({
  listSkills: vi.fn(),
  syncSkills: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => mockAgentService,
  agentInstructionsService: () => mockAgentInstructionsService,
  accessService: () => mockAccessService,
  approvalService: () => mockApprovalService,
  companySkillService: () => mockCompanySkillService,
  budgetService: () => mockBudgetService,
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => mockIssueApprovalService,
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  secretService: () => mockSecretService,
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(() => mockAdapter),
  listAdapterModels: vi.fn(),
}));

vi.mock("../services/role-bundle-connectors.js", () => ({
  resolveRoleBundleConnectorCoverage: mockResolveRoleBundleConnectorCoverage,
}));

vi.mock("../services/role-bundle-skills.js", async (importActual) => {
  const actual = await importActual<typeof import("../services/role-bundle-skills.js")>();
  return {
    ...actual,
    resolveRoleBundleSkillCoverage: mockResolveRoleBundleSkillCoverage,
  };
});

function createDb(options: { requireBoardApprovalForNewAgents?: boolean; toolInstallPolicy?: string } = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          {
            id: "company-1",
            requireBoardApprovalForNewAgents: options.requireBoardApprovalForNewAgents ?? false,
            toolInstallPolicy: options.toolInstallPolicy ?? "approval_gated",
          },
        ]),
      })),
    })),
  };
}

function createApp(db: Record<string, unknown> = createDb()) {
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
  app.use("/api", agentRoutes(db as any));
  app.use(errorHandler);
  return app;
}

function makeAgent(adapterType: string) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Agent",
    role: "engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType,
    adapterConfig: {},
    runtimeConfig: {},
    permissions: null,
    updatedAt: new Date(),
  };
}

describe("agent skill routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
    mockAgentService.resolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: makeAgent("claude_local"),
    });
    mockSecretService.resolveAdapterConfigForRuntime.mockResolvedValue({ config: { env: {} } });
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([
      {
        key: "paperclipai/paperclip/paperclip",
        runtimeName: "paperclip",
        source: "/tmp/paperclip",
        required: true,
        requiredReason: "required",
      },
    ]);
    mockCompanySkillService.listFull.mockResolvedValue([
      {
        id: "skill-1",
        companyId: "company-1",
        key: "paperclipai/paperclip/paperclip",
        slug: "paperclip",
        name: "paperclip",
      },
    ]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) =>
        requested.map((value) =>
          value === "paperclip"
            ? "paperclipai/paperclip/paperclip"
            : value,
        ),
    );
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });
    mockAdapter.syncSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeAgent("claude_local"),
      adapterConfig: patch.adapterConfig ?? {},
    }));
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      ...makeAgent(String(input.adapterType ?? "claude_local")),
      ...input,
      adapterConfig: input.adapterConfig ?? {},
      runtimeConfig: input.runtimeConfig ?? {},
      budgetMonthlyCents: Number(input.budgetMonthlyCents ?? 0),
      permissions: null,
    }));
    mockApprovalService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      id: "approval-1",
      companyId: "company-1",
      type: input.type ?? "hire_agent",
      status: "pending",
      payload: input.payload ?? {},
    }));
    mockApprovalService.list.mockResolvedValue([]);
    mockResolveRoleBundleConnectorCoverage.mockResolvedValue({
      required: [],
      installed: [],
      missing: [],
    });
    mockResolveRoleBundleSkillCoverage.mockResolvedValue({
      installedSkillKeys: ["paperclipai/paperclip/paperclip"],
      installedReferences: ["paperclip"],
      missing: [],
    });
    mockIssueService.getById.mockResolvedValue(null);
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
  });

  it("skips runtime materialization when listing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .get("/api/agents/11111111-1111-4111-8111-111111111111/skills?companyId=company-1");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.listSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterType: "claude_local",
        config: expect.objectContaining({
          paperclipRuntimeSkills: expect.any(Array),
        }),
      }),
    );
  });

  it("keeps runtime materialization for persistent skill adapters", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("codex_local"));
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "codex_local",
      supported: true,
      mode: "persistent",
      desiredSkills: ["paperclipai/paperclip/paperclip"],
      entries: [],
      warnings: [],
    });

    const res = await request(createApp())
      .get("/api/agents/11111111-1111-4111-8111-111111111111/skills?companyId=company-1");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: true,
    });
  });

  it("skips runtime materialization when syncing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/skills/sync?companyId=company-1")
      .send({ desiredSkills: ["paperclipai/paperclip/paperclip"] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.syncSkills).toHaveBeenCalled();
  });

  it("canonicalizes desired skill references before syncing", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await request(createApp())
      .post("/api/agents/11111111-1111-4111-8111-111111111111/skills/sync?companyId=company-1")
      .send({ desiredSkills: ["paperclip"] });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith(
      "company-1",
      ["paperclip"],
    );
    expect(mockAgentService.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          paperclipSkillSync: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  it("persists canonical desired skills when creating an agent directly", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith(
      "company-1",
      ["paperclip"],
    );
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          paperclipSkillSync: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
    );
  });

  it("materializes a managed AGENTS.md for directly created local agents", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        adapterType: "claude_local",
      }),
      { "AGENTS.md": "You are QA." },
      { entryFile: "AGENTS.md", replaceExisting: false, managedDefaultBundleMarker: null },
    );
    expect(mockAgentService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
        }),
      }),
    );
    expect(mockAgentService.update.mock.calls.at(-1)?.[1]).not.toMatchObject({
      adapterConfig: expect.objectContaining({
        promptTemplate: expect.anything(),
      }),
    });
  });

  it("materializes the bundled CEO instruction set for default CEO agents", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/agents")
      .send({
        name: "CEO",
        role: "ceo",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "ceo",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("You are the CEO."),
        "HEARTBEAT.md": expect.stringContaining("CEO Heartbeat Checklist"),
        "SOUL.md": expect.stringContaining("CEO Persona"),
        "TOOLS.md": expect.stringContaining("# Tools"),
      }),
      expect.objectContaining({
        entryFile: "AGENTS.md",
        replaceExisting: false,
        managedDefaultBundleMarker: expect.objectContaining({
          source: "paperclip_default_agent_bundle",
          role: "ceo",
        }),
      }),
    );
  });

  it("materializes the bundled default instruction set for non-CEO agents with no prompt template", async () => {
    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agents")
      .send({
        name: "Engineer",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "engineer",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("Keep the work moving until it's done."),
      }),
      expect.objectContaining({
        entryFile: "AGENTS.md",
        replaceExisting: false,
        managedDefaultBundleMarker: expect.objectContaining({
          source: "paperclip_default_agent_bundle",
          role: "default",
        }),
      }),
    );
  });

  it("appends role-specific operating rules for default designer agents", async () => {
    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agents")
      .send({
        name: "Designer",
        role: "designer",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "designer",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("You own product UX quality and visible polish."),
      }),
      expect.any(Object),
    );
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("Attach primary previews, runtime links, artifacts, or docs"),
      }),
      expect.any(Object),
    );
  });

  it("defaults new local agents to host execution when configured for hybrid deployment", async () => {
    const previousExecutionLocation = process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
    process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = "host";

    try {
      const res = await request(createApp())
        .post("/api/companies/company-1/agents")
        .send({
          name: "Host Default Agent",
          role: "engineer",
          adapterType: "codex_local",
          adapterConfig: {},
        });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          adapterConfig: expect.objectContaining({
            executionLocation: "host",
          }),
        }),
      );
    } finally {
      if (previousExecutionLocation === undefined) delete process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
      else process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = previousExecutionLocation;
    }
  });

  it("preserves an explicit container execution location for new local agents", async () => {
    const previousExecutionLocation = process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
    process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = "host";

    try {
      const res = await request(createApp())
        .post("/api/companies/company-1/agents")
        .send({
          name: "Pinned Container Agent",
          role: "engineer",
          adapterType: "codex_local",
          adapterConfig: {
            executionLocation: "container",
          },
        });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          adapterConfig: expect.objectContaining({
            executionLocation: "container",
          }),
        }),
      );
    } finally {
      if (previousExecutionLocation === undefined) delete process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
      else process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = previousExecutionLocation;
    }
  });

  it("lists role bundle catalog entries for the requested role", async () => {
    const res = await request(createApp())
      .get("/api/companies/company-1/agent-role-bundles?role=general");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((bundle: { key: string }) => bundle.key)).toEqual([
      "content_operator",
      "general_specialist",
    ]);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "content_operator",
        agentRole: "general",
        requestedSkillRefs: expect.arrayContaining(["doc-maintenance", "pr-report"]),
        requestedSkillRequirements: expect.arrayContaining([
          expect.objectContaining({
            reference: "doc-maintenance",
          }),
        ]),
        suggestedConnectorPlugins: expect.arrayContaining([
          expect.objectContaining({
            key: "paperclip.web-content-import",
            source: "local_path",
          }),
          expect.objectContaining({
            key: "paperclip.feed-sources",
            source: "local_path",
          }),
        ]),
        requiredConnectorPlugins: expect.arrayContaining([
          expect.objectContaining({
            key: "paperclip.telegram-publishing",
            source: "local_path",
          }),
          expect.objectContaining({
            key: "paperclip.author-voice-profiles",
            source: "local_path",
          }),
        ]),
      }),
      expect.objectContaining({
        key: "general_specialist",
        agentRole: "general",
        requestedSkillRefs: expect.arrayContaining(["paperclip", "playwright"]),
        requestedSkillRequirements: expect.arrayContaining([
          expect.objectContaining({
            reference: "playwright",
          }),
        ]),
        suggestedConnectorPlugins: expect.arrayContaining([
          expect.objectContaining({
            key: "paperclip.telegram-publishing",
            source: "local_path",
          }),
          expect.objectContaining({
            key: "paperclip.telegram-operator-bot",
            source: "local_path",
          }),
        ]),
      }),
    ]));
  });

  it("includes local connector install metadata in the role bundle catalog", async () => {
    const previousRequirements = ROLE_BUNDLES.pm.requiredConnectorPlugins;
    ROLE_BUNDLES.pm.requiredConnectorPlugins = [
      {
        key: "paperclip.feed-sources",
        displayName: "Feed Sources",
        pluginKey: "paperclip.feed-sources",
        packageName: "@paperclipai/plugin-feed-sources",
        source: "local_path",
        localPath: "D:/new-projects/paperclip/packages/plugins/feed-sources",
        version: "0.1.0",
      },
    ];

    try {
      const res = await request(createApp())
        .get("/api/companies/company-1/agent-role-bundles?role=pm");

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          key: "pm",
          suggestedConnectorPlugins: expect.arrayContaining([
            expect.objectContaining({
              key: "paperclip.telegram-publishing",
              source: "local_path",
            }),
            expect.objectContaining({
              key: "paperclip.feed-sources",
              packageName: "@paperclipai/plugin-feed-sources",
              source: "local_path",
            }),
          ]),
          requiredConnectorPlugins: expect.arrayContaining([
            expect.objectContaining({
              key: "paperclip.feed-sources",
              packageName: "@paperclipai/plugin-feed-sources",
              source: "local_path",
              localPath: "D:/new-projects/paperclip/packages/plugins/feed-sources",
              version: "0.1.0",
            }),
          ]),
        }),
      ]);
    } finally {
      ROLE_BUNDLES.pm.requiredConnectorPlugins = previousRequirements;
    }
  });

  it("includes canonical desired skills in hire approvals", async () => {
    const db = createDb({ requireBoardApprovalForNewAgents: true });

    const res = await request(createApp(db))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).toHaveBeenCalledWith(
      "company-1",
      ["paperclip", "paperclipai/paperclip/paperclip"],
    );
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          desiredSkills: ["paperclipai/paperclip/paperclip"],
          requestedConfigurationSnapshot: expect.objectContaining({
            desiredSkills: ["paperclipai/paperclip/paperclip"],
          }),
        }),
      }),
    );
  });

  it("routes generic engineer hires to a specialist bundle when the staffing reason signals design work", async () => {
    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "UI Hire",
        role: "engineer",
        staffingReason: "Design a beautiful dashboard UI with stronger visual polish and clearer layout.",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        role: "designer",
      }),
    );
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        payload: expect.objectContaining({
          role: "designer",
          roleBundleKey: "designer",
          roleBundleSelectionSource: "capability_inferred",
        }),
      }),
    );
    expect(res.body.roleBundleKey).toBe("designer");
    expect(res.body.roleBundleSelectionSource).toBe("capability_inferred");
  });

  it("creates skill install approvals for missing role bundle skills with known sources", async () => {
    mockResolveRoleBundleSkillCoverage.mockResolvedValue({
      installedSkillKeys: ["paperclipai/paperclip/paperclip"],
      installedReferences: ["paperclip"],
      missing: [
        {
          reference: "doc-maintenance",
          displayName: "doc-maintenance",
          source: "D:/new-projects/paperclip/.agents/skills/doc-maintenance",
          sourceType: "local_path",
        },
      ],
    });

    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenNthCalledWith(
      1,
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        payload: expect.objectContaining({
          missingRequestedSkillRefs: ["doc-maintenance"],
          missingRequestedSkillDisplayNames: ["doc-maintenance"],
        }),
      }),
    );
    expect(mockApprovalService.create).toHaveBeenNthCalledWith(
      2,
      "company-1",
      expect.objectContaining({
        type: "install_company_skill",
        payload: expect.objectContaining({
          requestedRef: "doc-maintenance",
          source: "D:/new-projects/paperclip/.agents/skills/doc-maintenance",
          roleBundleKey: "pm",
          relatedHireApprovalId: "approval-1",
        }),
      }),
    );
    expect(res.body.skillApprovals).toHaveLength(1);
    expect(res.body.missingRequestedSkills).toHaveLength(1);
  });

  it("reuses existing pending skill approvals instead of duplicating them", async () => {
    mockResolveRoleBundleSkillCoverage.mockResolvedValue({
      installedSkillKeys: ["paperclipai/paperclip/paperclip"],
      installedReferences: ["paperclip"],
      missing: [
        {
          reference: "doc-maintenance",
          displayName: "doc-maintenance",
          source: "D:/new-projects/paperclip/.agents/skills/doc-maintenance",
          sourceType: "local_path",
        },
      ],
    });
    mockApprovalService.list.mockResolvedValue([
      {
        id: "approval-skill-existing",
        companyId: "company-1",
        type: "install_company_skill",
        status: "pending",
        payload: {
          requestedRef: "doc-maintenance",
          source: "D:/new-projects/paperclip/.agents/skills/doc-maintenance",
        },
      },
    ]);

    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
      }),
    );
    expect(res.body.skillApprovals).toHaveLength(1);
    expect(res.body.skillApprovals[0].id).toBe("approval-skill-existing");
  });

  it("does not auto-create skill approvals when installation policy is manual only", async () => {
    mockResolveRoleBundleSkillCoverage.mockResolvedValue({
      installedSkillKeys: ["paperclipai/paperclip/paperclip"],
      installedReferences: ["paperclip"],
      missing: [
        {
          reference: "doc-maintenance",
          displayName: "doc-maintenance",
          source: "D:/new-projects/paperclip/.agents/skills/doc-maintenance",
          sourceType: "local_path",
        },
      ],
    });

    const res = await request(createApp(createDb({
      requireBoardApprovalForNewAgents: true,
      toolInstallPolicy: "manual_only",
    })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    expect(res.body.skillApprovals).toHaveLength(0);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        payload: expect.objectContaining({
          missingRequestedSkillRefs: ["doc-maintenance"],
        }),
      }),
    );
  });

  it("creates connector install approvals for missing role bundle plugins", async () => {
    mockResolveRoleBundleConnectorCoverage.mockResolvedValue({
      required: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
          reason: "Required for issue sync",
        },
      ],
      installed: [],
      missing: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
          reason: "Required for issue sync",
        },
      ],
    });

    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenNthCalledWith(
      1,
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        payload: expect.objectContaining({
          missingConnectorPluginKeys: ["@paperclip/plugin-linear"],
          missingConnectorPluginDisplayNames: ["Linear Connector"],
        }),
      }),
    );
    expect(mockApprovalService.create).toHaveBeenNthCalledWith(
      2,
      "company-1",
      expect.objectContaining({
        type: "install_connector_plugin",
        payload: expect.objectContaining({
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
          name: "Linear Connector",
          relatedHireApprovalId: "approval-1",
        }),
      }),
    );
    expect(res.body.connectorApprovals).toHaveLength(1);
  });

  it("reuses existing pending connector approvals instead of duplicating them", async () => {
    mockResolveRoleBundleConnectorCoverage.mockResolvedValue({
      required: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      ],
      installed: [],
      missing: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      ],
    });
    mockApprovalService.list.mockResolvedValue([
      {
        id: "approval-existing",
        companyId: "company-1",
        type: "install_connector_plugin",
        status: "pending",
        payload: {
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      },
    ]);

    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
      }),
    );
    expect(res.body.connectorApprovals).toHaveLength(1);
    expect(res.body.connectorApprovals[0].id).toBe("approval-existing");
  });

  it("does not auto-create connector approvals when tool installation is manual only", async () => {
    mockResolveRoleBundleConnectorCoverage.mockResolvedValue({
      required: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      ],
      installed: [],
      missing: [
        {
          key: "@paperclip/plugin-linear",
          displayName: "Linear Connector",
          pluginKey: "@paperclip/plugin-linear",
          packageName: "@paperclip/plugin-linear",
        },
      ],
    });

    const res = await request(createApp(createDb({
      requireBoardApprovalForNewAgents: true,
      toolInstallPolicy: "manual_only",
    })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "PM Agent",
        role: "pm",
        roleBundleKey: "pm",
        adapterType: "claude_local",
        adapterConfig: {},
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledTimes(1);
    expect(res.body.connectorApprovals).toHaveLength(0);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        type: "hire_agent",
        payload: expect.objectContaining({
          missingConnectorPluginKeys: ["@paperclip/plugin-linear"],
        }),
      }),
    );
  });

  it("uses managed AGENTS config in hire approval payloads", async () => {
    const res = await request(createApp(createDb({ requireBoardApprovalForNewAgents: true })))
      .post("/api/companies/company-1/agent-hires")
      .send({
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          adapterConfig: expect.objectContaining({
            instructionsBundleMode: "managed",
            instructionsEntryFile: "AGENTS.md",
            instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
          }),
        }),
      }),
    );
    const approvalInput = mockApprovalService.create.mock.calls.at(-1)?.[1] as
      | { payload?: { adapterConfig?: Record<string, unknown> } }
      | undefined;
    expect(approvalInput?.payload?.adapterConfig?.promptTemplate).toBeUndefined();
  });

  it("defaults new local hire requests to host execution when configured for hybrid deployment", async () => {
    const previousExecutionLocation = process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
    process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = "host";

    try {
      const res = await request(createApp())
        .post("/api/companies/company-1/agent-hires")
        .send({
          name: "Host Hire Agent",
          role: "engineer",
          adapterType: "codex_local",
          adapterConfig: {},
        });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          adapterConfig: expect.objectContaining({
            executionLocation: "host",
          }),
        }),
      );
    } finally {
      if (previousExecutionLocation === undefined) delete process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION;
      else process.env.PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION = previousExecutionLocation;
    }
  });
});
