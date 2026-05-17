import type { Network, Post, SourcesByNetwork } from "../types";
import { NETWORK_KEYS } from "../types";
import { sourceKey } from "./storage";
import { hasValidPermalink } from "./format";

export function filterValidPermalinks(posts: Post[], network: Network, sourceName: string): Post[] {
  return posts.filter((p) => {
    if (!hasValidPermalink(p.permalink, network, sourceName)) {
      console.log(
        `[MF] Dropping post for "${sourceName}" — invalid/missing permalink: ` +
        `"${p.body.slice(0, 40)}…"`
      );
      return false;
    }
    return true;
  });
}

export function dedupePosts(posts: Post[], sourceName: string): Post[] {
  const seenKeys = new Set<string>();
  return posts.filter((p) => {
    const body = p.body.trim().toLowerCase();
    if (!body) return true;
    const key = body.slice(0, 80);
    if (seenKeys.has(key)) {
      console.log(`[MF] Dropping duplicate post for "${sourceName}": "${body.slice(0, 50)}…"`);
      return false;
    }
    seenKeys.add(key);
    return true;
  });
}

export function applyFilters(
  scrapedPosts: Map<string, Post[]>,
  hiddenIds: Set<string>,
  sources: SourcesByNetwork,
): Post[] {
  const validIds = new Set<string>();
  for (const { key } of NETWORK_KEYS) {
    for (const s of sources[key]) {
      validIds.add(s.id);
    }
  }

  const perSource: Post[][] = [];
  scrapedPosts.forEach((arr, sourceId) => {
    if (arr.length === 0) return;
    if (!validIds.has(sourceId)) return;
    const network = arr[0].network;
    if (hiddenIds.has(sourceKey(network, sourceId))) return;
    perSource.push(arr);
  });

  if (perSource.length === 0) return [];

  const interleaved: Post[] = [];
  const maxLen = Math.max(...perSource.map((arr) => arr.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of perSource) {
      if (i < arr.length) interleaved.push(arr[i]);
    }
  }
  return interleaved;
}
