import seedPravidla from "../pravidla.json";
import type { Mode, Network, SourcesByNetwork } from "../types";

const SOURCES_STORAGE_KEY = "mf-sources-v2";
const HIDDEN_STORAGE_KEY = "mf-hidden-sources-v1";
const MODE_STORAGE_KEY = "mf-mode-v1";
const FILTER_EXPANDED_KEY = "mf-filter-expanded-v1";
const NETWORK_EXPANDED_KEY = "mf-network-expanded-v1";

export function loadSources(): SourcesByNetwork {
  try {
    const saved = localStorage.getItem(SOURCES_STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      return {
        facebook: data.facebook || [],
        instagram: data.instagram || [],
        youtube: data.youtube || [],
      };
    }
  } catch {}
  const seed = seedPravidla as Partial<SourcesByNetwork>;
  return {
    facebook: seed.facebook || [],
    instagram: seed.instagram || [],
    youtube: seed.youtube || [],
  };
}

export function saveSources(s: SourcesByNetwork) {
  try {
    localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

export function loadHidden(): Set<string> {
  try {
    const saved = localStorage.getItem(HIDDEN_STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {}
  return new Set();
}

export function saveHidden(disabled: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...disabled]));
  } catch {}
}

export function loadMode(): Mode {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get("mode");
    if (urlMode === "free" || urlMode === "filter") {
      try {
        localStorage.setItem(MODE_STORAGE_KEY, urlMode);
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, "", cleanUrl);
      } catch {}
      return urlMode;
    }
  } catch {}
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === "free" || saved === "filter") return saved;
  } catch {}
  return "free";
}

export function saveMode(m: Mode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, m);
  } catch {}
}

export function loadFilterExpanded(): boolean {
  try {
    const saved = localStorage.getItem(FILTER_EXPANDED_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {}
  return false; // default: zatvorený, šetrí miesto pri veľa profiloch
}

export function saveFilterExpanded(expanded: boolean) {
  try {
    localStorage.setItem(FILTER_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {}
}

export function loadNetworkExpanded(): Record<Network, boolean> {
  try {
    const saved = localStorage.getItem(NETWORK_EXPANDED_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        Facebook: !!parsed.Facebook,
        Instagram: !!parsed.Instagram,
        YouTube: !!parsed.YouTube,
      };
    }
  } catch {}
  return { Facebook: false, Instagram: false, YouTube: false };
}

export function saveNetworkExpanded(state: Record<Network, boolean>) {
  try {
    localStorage.setItem(NETWORK_EXPANDED_KEY, JSON.stringify(state));
  } catch {}
}

export function sourceKey(network: Network, sourceId: string): string {
  return `${network}:${sourceId}`;
}

export function networkKey(network: Network): keyof SourcesByNetwork {
  return network.toLowerCase() as keyof SourcesByNetwork;
}

export function totalSourceCount(s: SourcesByNetwork): number {
  return s.facebook.length + s.instagram.length + s.youtube.length;
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
