import { describe, expect, it, vi } from "vitest";
import { repairMissingLocalAdapterExecutionLocations } from "../local-adapter-repair.js";

function createMockDb(rows: Array<{ id: string; adapterType: string; adapterConfig: Record<string, unknown> }>) {
  const updateCalls: Array<{ set: Record<string, unknown> }> = [];

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          updateCalls.push({ set: payload });
          return [];
        }),
      })),
    })),
  };

  return { db, updateCalls };
}

describe("repairMissingLocalAdapterExecutionLocations", () => {
  it("backfills missing local execution locations to host when hybrid default is host", async () => {
    const { db, updateCalls } = createMockDb([
      { id: "agent-1", adapterType: "codex_local", adapterConfig: {} },
      { id: "agent-2", adapterType: "claude_local", adapterConfig: { executionLocation: "container" } },
    ]);

    const result = await repairMissingLocalAdapterExecutionLocations(db as any, {
      PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION: "host",
    });

    expect(result).toEqual({
      checked: 2,
      updated: 1,
      skipped: false,
      defaultExecutionLocation: "host",
    });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      set: {
        adapterConfig: {
          executionLocation: "host",
        },
      },
    });
  });

  it("skips backfill when the deployment default stays on container", async () => {
    const { db, updateCalls } = createMockDb([
      { id: "agent-1", adapterType: "codex_local", adapterConfig: {} },
    ]);

    const result = await repairMissingLocalAdapterExecutionLocations(db as any, {
      PAPERCLIP_LOCAL_ADAPTER_DEFAULT_EXECUTION_LOCATION: "container",
    });

    expect(result).toEqual({
      checked: 0,
      updated: 0,
      skipped: true,
      defaultExecutionLocation: "container",
    });
    expect(updateCalls).toHaveLength(0);
  });
});
