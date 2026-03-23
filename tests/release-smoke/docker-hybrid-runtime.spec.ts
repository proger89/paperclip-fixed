import fs from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL =
  process.env.PAPERCLIP_RELEASE_SMOKE_EMAIL ??
  process.env.SMOKE_ADMIN_EMAIL ??
  "smoke-admin@paperclip.local";
const ADMIN_PASSWORD =
  process.env.PAPERCLIP_RELEASE_SMOKE_PASSWORD ??
  process.env.SMOKE_ADMIN_PASSWORD ??
  "paperclip-smoke-password";
const SMOKE_DATA_DIR =
  process.env.PAPERCLIP_RELEASE_SMOKE_DATA_DIR ??
  process.env.SMOKE_DATA_DIR ??
  "";
const HYBRID_MODE = process.env.PAPERCLIP_HYBRID_SMOKE_MODE ?? "available";

const COMPANY_NAME = `Hybrid-Smoke-${Date.now()}`;
const INITIAL_AGENT_NAME = "CEO";
const INITIAL_TASK_TITLE = "Hybrid runtime smoke seed";
const HOST_AGENT_NAME = "Hybrid Host Codex";
const HOST_TASK_TITLE = "Run hybrid host codex";

type CompanySummary = {
  id: string;
  name: string;
};

type AgentSummary = {
  id: string;
  name: string;
  role: string;
  adapterType: string;
};

type HeartbeatRunSummary = {
  id: string;
  agentId: string;
  invocationSource: string;
  status: string;
  errorCode: string | null;
};

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth/);

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function openOnboarding(page: Page) {
  const wizardHeading = page.locator("h3", { hasText: "Name your company" });
  const startButton = page.getByRole("button", { name: "Start Onboarding" });

  await expect(wizardHeading.or(startButton)).toBeVisible({ timeout: 20_000 });
  if (await startButton.isVisible()) {
    await startButton.click();
  }
  await expect(wizardHeading).toBeVisible({ timeout: 10_000 });
}

async function completeOnboarding(page: Page) {
  await signIn(page);
  await openOnboarding(page);

  await page.locator('input[placeholder="Acme Corp"]').fill(COMPANY_NAME);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.locator("h3", { hasText: "Create your first agent" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[placeholder="CEO"]')).toHaveValue(INITIAL_AGENT_NAME);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.locator("h3", { hasText: "Give it something to do" })).toBeVisible({ timeout: 10_000 });
  await page
    .locator('input[placeholder="e.g. Research competitor pricing"]')
    .fill(INITIAL_TASK_TITLE);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.locator("h3", { hasText: "Ready to launch" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Create & Open Issue" }).click();
  await expect(page).toHaveURL(/\/issues\//, { timeout: 10_000 });

  const baseUrl = new URL(page.url()).origin;
  const companiesRes = await page.request.get(`${baseUrl}/api/companies`);
  expect(companiesRes.ok()).toBe(true);
  const companies = (await companiesRes.json()) as CompanySummary[];
  const company = companies.find((entry) => entry.name === COMPANY_NAME);
  expect(company).toBeTruthy();
  return {
    baseUrl,
    company: company!,
  };
}

test.describe("Docker hybrid runtime smoke", () => {
  test("keeps the board healthy when the host bridge is unavailable and returns typed env-test errors", async ({
    page,
  }) => {
    test.skip(HYBRID_MODE !== "missing", "This scenario is only for missing host bridge mode.");

    const { baseUrl, company } = await completeOnboarding(page);

    const envTestRes = await page.request.post(
      `${baseUrl}/api/companies/${company.id}/adapters/codex_local/test-environment`,
      {
        data: {
          adapterConfig: {
            executionLocation: "host",
            cwd: "/paperclip/hybrid-smoke/workspace",
          },
        },
      },
    );
    expect(envTestRes.ok()).toBe(true);
    const envTest = await envTestRes.json();
    expect(envTest).toMatchObject({
      status: "fail",
      checks: [
        expect.objectContaining({
          code: "host_bridge_unavailable",
          level: "error",
        }),
      ],
    });
  });

  test("runs a host-executed codex agent from Docker and injects a host browser endpoint", async ({
    page,
  }) => {
    test.skip(HYBRID_MODE !== "available", "This scenario is only for active host bridge mode.");

    const { baseUrl, company } = await completeOnboarding(page);

    const createAgentRes = await page.request.post(`${baseUrl}/api/companies/${company.id}/agents`, {
      data: {
        name: HOST_AGENT_NAME,
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {
          executionLocation: "host",
          command: "node",
          cwd: "/paperclip/hybrid-smoke/workspace",
          extraArgs: ["/paperclip/hybrid-smoke/fake-codex.mjs"],
          promptTemplate: "Continue your work.",
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: "/paperclip/hybrid-smoke/capture.json",
          },
          workspaceRuntime: {
            services: [
              {
                name: "browser",
                location: "host",
                lifecycle: "ephemeral",
              },
            ],
          },
        },
        runtimeConfig: {
          heartbeat: {
            enabled: false,
          },
        },
      },
    });
    expect(createAgentRes.status()).toBe(201);
    const hostAgent = (await createAgentRes.json()) as AgentSummary;
    expect(hostAgent.adapterType).toBe("codex_local");

    const createIssueRes = await page.request.post(`${baseUrl}/api/companies/${company.id}/issues`, {
      data: {
        title: HOST_TASK_TITLE,
        description: "Validate hybrid host runtime execution.",
        status: "backlog",
        priority: "medium",
        assigneeAgentId: hostAgent.id,
      },
    });
    expect(createIssueRes.status()).toBe(201);
    const issue = await createIssueRes.json();

    const wakeRes = await page.request.post(
      `${baseUrl}/api/agents/${hostAgent.id}/wakeup?companyId=${encodeURIComponent(company.id)}`,
      {
        data: {
          source: "assignment",
          triggerDetail: "system",
          payload: {
            issueId: issue.id,
          },
        },
      },
    );
    expect(wakeRes.ok()).toBe(true);
    const wake = await wakeRes.json();
    const runId = typeof wake?.id === "string" ? wake.id : null;

    await expect
      .poll(
        async () => {
          if (runId) {
            const runRes = await page.request.get(`${baseUrl}/api/heartbeat-runs/${runId}`);
            expect(runRes.ok()).toBe(true);
            return (await runRes.json()) as HeartbeatRunSummary;
          }

          const runsRes = await page.request.get(
            `${baseUrl}/api/companies/${company.id}/heartbeat-runs?agentId=${encodeURIComponent(hostAgent.id)}&limit=10`,
          );
          expect(runsRes.ok()).toBe(true);
          const runs = (await runsRes.json()) as HeartbeatRunSummary[];
          return runs.find((entry) => entry.agentId === hostAgent.id) ?? null;
        },
        {
          timeout: 45_000,
          intervals: [1_000, 2_000, 5_000],
        },
      )
      .toEqual(
        expect.objectContaining({
          agentId: hostAgent.id,
          invocationSource: "assignment",
          status: "succeeded",
          errorCode: null,
        }),
      );

    expect(SMOKE_DATA_DIR).toBeTruthy();
    const capturePath = path.join(SMOKE_DATA_DIR, "hybrid-smoke", "capture.json");
    await expect
      .poll(
        async () => {
          const raw = await fs.readFile(capturePath, "utf8").catch(() => null);
          return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        },
        {
          timeout: 20_000,
          intervals: [500, 1_000, 2_000],
        },
      )
      .toBeTruthy();

    const capturePayload = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
      cwd: string;
      argv: string[];
      paperclipApiUrl: string | null;
      playwrightWsEndpoint: string | null;
      browserCdpUrl: string | null;
    };

    expect(capturePayload.cwd).not.toBe("/paperclip/hybrid-smoke/workspace");
    expect(capturePayload.cwd).toContain("hybrid-smoke");
    expect(capturePayload.paperclipApiUrl).toBeTruthy();
    expect(capturePayload.playwrightWsEndpoint || capturePayload.browserCdpUrl).toBeTruthy();
  });
});
