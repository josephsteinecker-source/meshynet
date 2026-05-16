import type { Network } from "../types";

export function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "pred chvíľou";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `pred ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `pred ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `pred ${days} d`;
  return date.toLocaleDateString("sk-SK");
}

// Formátovanie konca billing periody pre cancel banner.
// Príklad: "2026-06-15T..." → "15. júna 2026"
export function formatPlanEndDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString("sk-SK", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

export function isLikelyValidImage(dataUri: string | undefined): boolean {
  if (!dataUri) return false;
  if (!dataUri.startsWith("data:")) return true;
  const commaIdx = dataUri.indexOf(",");
  if (commaIdx === -1) return false;
  const base64Len = dataUri.length - commaIdx - 1;
  return base64Len >= 6800;
}

export function hasValidPermalink(
  permalink: string | undefined,
  network: Network,
  sourceName?: string,
): boolean {
  if (!permalink) return false;
  const url = permalink.trim();
  if (!url) return false;

  if (network === "Facebook") {
    if (!sourceName) {
      return /\/(posts|videos|photos|permalink|reel|story\.php|watch)/i.test(url);
    }
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`facebook\\.com/${escaped}(?:[/?#]|$)`, "i");
    return pattern.test(url);
  }
  if (network === "Instagram") {
    return /\/(p|reel|tv)\//i.test(url);
  }
  if (network === "YouTube") {
    return /watch\?v=|youtu\.be\//i.test(url);
  }
  return true;
}
