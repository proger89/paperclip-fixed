import { describe, expect, it } from "vitest";
import {
  getRunFailureHelper,
  getRunStatusBody,
  getRunStatusLabel,
  getRunStatusTone,
  isProviderQuotaErrorCode,
} from "./run-errors";

describe("run error presentation", () => {
  it("classifies codex quota exhaustion as provider quota", () => {
    expect(isProviderQuotaErrorCode("codex_quota_exceeded")).toBe(true);
    expect(getRunStatusTone("failed", "codex_quota_exceeded")).toBe("warn");
    expect(getRunStatusLabel("failed", "codex_quota_exceeded")).toBe("hit provider quota");
    expect(getRunStatusBody({ error: null, errorCode: "codex_quota_exceeded" })).toContain(
      "provider quota",
    );
    expect(getRunFailureHelper("codex_quota_exceeded")?.tone).toBe("warn");
  });

  it("keeps ordinary failures as errors", () => {
    expect(isProviderQuotaErrorCode("adapter_failed")).toBe(false);
    expect(getRunStatusTone("failed", "adapter_failed")).toBe("error");
    expect(getRunStatusLabel("failed", "adapter_failed")).toBe("failed");
    expect(getRunFailureHelper("adapter_failed")).toBeNull();
  });

  it("surfaces control-plane routing failures separately from provider auth/quota", () => {
    expect(getRunStatusTone("failed", "paperclip_control_plane_unavailable")).toBe("error");
    expect(getRunStatusLabel("failed", "paperclip_control_plane_unavailable")).toBe("lost control-plane access");
    expect(getRunStatusBody({ error: null, errorCode: "paperclip_control_plane_auth_failed" })).toContain(
      "run JWT was rejected",
    );
    expect(getRunFailureHelper("paperclip_control_plane_unavailable")?.title).toContain(
      "Control plane",
    );
    expect(getRunFailureHelper("paperclip_control_plane_auth_failed")?.title).toContain(
      "Wrong Paperclip instance",
    );
  });
});
