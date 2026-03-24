import { describe, expect, it, vi } from "vitest";
import {
  publishGlobalLiveEvent,
  publishLiveEvent,
  subscribeCompanyLiveEvents,
  subscribeGlobalLiveEvents,
} from "../services/live-events.js";

describe("live events", () => {
  it("does not throw when a company listener fails", () => {
    const handledErrors: Error[] = [];
    const unsubscribe = subscribeCompanyLiveEvents(
      "company-1",
      () => {
        throw new Error("listener exploded");
      },
      {
        context: "test_company_listener",
        onError: (err) => {
          handledErrors.push(err);
        },
      },
    );

    try {
      expect(() => publishLiveEvent({
        companyId: "company-1",
        type: "activity.logged",
        payload: { action: "issue.checked_out" },
      })).not.toThrow();
      expect(handledErrors).toHaveLength(1);
      expect(handledErrors[0]?.message).toContain("listener exploded");
    } finally {
      unsubscribe();
    }
  });

  it("does not throw when a global listener fails", () => {
    const handledErrors: Error[] = [];
    const unsubscribe = subscribeGlobalLiveEvents(
      () => {
        throw new Error("global listener exploded");
      },
      {
        context: "test_global_listener",
        onError: (err) => {
          handledErrors.push(err);
        },
      },
    );

    try {
      expect(() => publishGlobalLiveEvent({
        type: "heartbeat.run.status",
        payload: { status: "running" },
      })).not.toThrow();
      expect(handledErrors).toHaveLength(1);
      expect(handledErrors[0]?.message).toContain("global listener exploded");
    } finally {
      unsubscribe();
    }
  });
});
