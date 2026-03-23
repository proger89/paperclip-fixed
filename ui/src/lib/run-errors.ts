import type { ToastTone } from "../context/ToastContext";

export function isProviderQuotaErrorCode(errorCode: string | null | undefined): boolean {
  return errorCode === "codex_quota_exceeded";
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
  if (input.triggerDetail) return `Trigger: ${input.triggerDetail}`;
  return undefined;
}

export function getRunFailureHelper(
  errorCode: string | null | undefined,
): { title: string; body: string; tone: ToastTone } | null {
  if (!isProviderQuotaErrorCode(errorCode)) return null;
  return {
    title: "Provider quota reached",
    body:
      "Codex hit the provider quota or billing limit. Check the connected provider plan or billing status, then retry the run. The agent was not auto-paused for this failure.",
    tone: "warn",
  };
}
