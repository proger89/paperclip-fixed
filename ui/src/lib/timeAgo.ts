import { relativeTime } from "./utils";

export function timeAgo(date: Date | string): string {
  return relativeTime(date);
}
