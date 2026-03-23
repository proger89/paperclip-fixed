import type { ToastTone } from "../context/ToastContext";

export function isProviderQuotaErrorCode(errorCode: string | null | undefined): boolean {
  return errorCode === "codex_quota_exceeded";
}

export function isControlPlaneFailureErrorCode(errorCode: string | null | undefined): boolean {
  return (
    errorCode === "paperclip_control_plane_unavailable"
    || errorCode === "paperclip_control_plane_auth_failed"
  );
}

export function getRunStatusTone(
  status: string,
  errorCode: string | null | undefined,
): ToastTone {
  if (status === "succeeded") return "success";
  if (status === "cancelled") return "warn";
  if (isProviderQuotaErrorCode(errorCode)) return "warn";
  return "error";
}

export function getRunStatusLabel(
  status: string,
  errorCode: string | null | undefined,
): string {
  if (status === "succeeded") return "succeeded";
  if (status === "timed_out") return "timed out";
  if (status === "cancelled") return "cancelled";
  if (isProviderQuotaErrorCode(errorCode)) return "hit provider quota";
  if (isControlPlaneFailureErrorCode(errorCode)) return "lost control-plane access";
  return "failed";
}

export function getRunStatusBody(input: {
  error: string | null | undefined;
  errorCode: string | null | undefined;
  triggerDetail?: string | null;
}): string | undefined {
  if (input.error) return input.error;
  if (isProviderQuotaErrorCode(input.errorCode)) {
    return "Codex provider quota or billing limit reached. Check provider billing before retrying.";
  }
  if (input.errorCode === "paperclip_control_plane_unavailable") {
    return "The host-executed agent could not reach the configured Paperclip control plane URL.";
  }
  if (input.errorCode === "paperclip_control_plane_auth_failed") {
    return "The host-executed agent reached Paperclip, but the run JWT was rejected by that instance.";
  }
  if (input.triggerDetail) return `Trigger: ${input.triggerDetail}`;
  return undefined;
}

export function getRunFailureHelper(
  errorCode: string | null | undefined,
): { title: string; body: string; tone: ToastTone } | null {
  if (isProviderQuotaErrorCode(errorCode)) {
    return {
      title: "Provider quota reached",
      body:
        "Codex hit the provider quota or billing limit. Check the connected provider plan or billing status, then retry the run. The agent was not auto-paused for this failure.",
      tone: "warn",
    };
  }
  if (errorCode === "paperclip_control_plane_unavailable") {
    return {
      title: "Control plane unreachable",
      body:
        "The host-executed agent could not reach the configured Paperclip control-plane URL. Check PAPERCLIP_AGENT_API_URL or PAPERCLIP_PUBLIC_URL and make sure that host can reach /api/health.",
      tone: "error",
    };
  }
  if (errorCode === "paperclip_control_plane_auth_failed") {
    return {
      title: "Wrong Paperclip instance or rejected run auth",
      body:
        "The host-executed agent reached Paperclip, but that instance rejected the run JWT. Check PAPERCLIP_AGENT_API_URL or PAPERCLIP_PUBLIC_URL and make sure the host runtime points at the same Paperclip instance that started the run.",
      tone: "error",
    };
  }
  return null;
}
