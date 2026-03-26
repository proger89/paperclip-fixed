import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { useI18n } from "@/context/I18nContext";

export function StatusBadge({ status }: { status: string }) {
  const { translateText } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        statusBadge[status] ?? statusBadgeDefault
      )}
    >
      {translateText(status.replaceAll("_", " "))}
    </span>
  );
}
