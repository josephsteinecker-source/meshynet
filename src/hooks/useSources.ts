import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import type { Session } from "../lib/supabase";
import type { Network, SourceConfig, SourcesByNetwork } from "../types";
import { generateId, loadSources, saveSources, networkKey } from "../lib/storage";

const LS_SOURCES_KEY = "mf-sources-v2";

type DbRow = {
  id: string;
  user_id: string;
  platform: string;
  identifier: string;
  visible: boolean;
  position: number;
};

const EMPTY_SOURCES: SourcesByNetwork = {
  facebook: [],
  instagram: [],
  youtube: [],
};

function rowToSource(r: DbRow): SourceConfig {
  return {
    id: r.id,
    nazov: r.identifier,
    url: "",
    scrapeQuery: r.identifier,
  };
}

function rowsToSourcesByNetwork(rows: DbRow[]): SourcesByNetwork {
  const out: SourcesByNetwork = { facebook: [], instagram: [], youtube: [] };
  for (const r of rows) {
    if (r.platform === "facebook" || r.platform === "instagram" || r.platform === "youtube") {
      out[r.platform].push(rowToSource(r));
    }
  }
  return out;
}

function countAll(s: SourcesByNetwork): number {
  return s.facebook.length + s.instagram.length + s.youtube.length;
}

async function fetchFromSupabase(userId: string): Promise<SourcesByNetwork> {
  const { data, error } = await supabase
    .from("user_sources")
    .select("id, user_id, platform, identifier, visible, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });
  if (error) throw error;
  return rowsToSourcesByNetwork((data ?? []) as DbRow[]);
}

async function migrateLocalToSupabase(
  userId: string,
  existing: SourcesByNetwork,
  local: SourcesByNetwork
): Promise<number> {
  const existingKeys = new Set<string>();
  for (const platform of ["facebook", "instagram", "youtube"] as const) {
    for (const s of existing[platform]) {
      existingKeys.add(`${platform}:${(s.scrapeQuery ?? s.nazov).toLowerCase()}`);
    }
  }

  const rowsToInsert: DbRow[] = [];
  for (const platform of ["facebook", "instagram", "youtube"] as const) {
    let pos = existing[platform].length;
    for (const s of local[platform]) {
      const identifier = s.scrapeQuery ?? s.nazov;
      const key = `${platform}:${identifier.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      rowsToInsert.push({
        id: s.id || generateId(),
        user_id: userId,
        platform,
        identifier,
        visible: true,
        position: pos++,
      });
    }
  }

  if (rowsToInsert.length === 0) return 0;
  const { error } = await supabase.from("user_sources").insert(rowsToInsert);
  if (error) throw error;
  return rowsToInsert.length;
}

export function useSources(session: Session | null, authLoaded: boolean): {
  sources: SourcesByNetwork;
  sourcesLoaded: boolean;
  addSource: (network: Network, name: string, scrapeQuery: string) => Promise<SourceConfig>;
  removeSource: (network: Network, sourceId: string) => Promise<void>;
} {
  const [sources, setSources] = useState<SourcesByNetwork>(EMPTY_SOURCES);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const previousUserIdRef = useRef<string | null>(null);
  const sourcesRef = useRef(sources);
  useEffect(() => { sourcesRef.current = sources; }, [sources]);

  useEffect(() => {
    if (!authLoaded) return;
    let cancelled = false;

    const prevUserId = previousUserIdRef.current;
    const currentUserId = session?.user?.id ?? null;
    previousUserIdRef.current = currentUserId;

    if (!currentUserId) {
      const local = loadSources();
      if (cancelled) return;
      console.log("[MF] Sources loaded from localStorage");
      setSources(local);
      setSourcesLoaded(true);
      return;
    }

    (async () => {
      try {
        const remote = await fetchFromSupabase(currentUserId);

        const isLoginTransition = prevUserId === null;
        if (isLoginTransition) {
          const local = loadSources();
          if (countAll(local) > 0) {
            try {
              const migrated = await migrateLocalToSupabase(currentUserId, remote, local);
              if (migrated > 0) {
                try { localStorage.removeItem(LS_SOURCES_KEY); } catch {}
                const refetched = await fetchFromSupabase(currentUserId);
                if (cancelled) return;
                console.log(`[MF] Sources loaded from Supabase (${countAll(refetched)})`);
                setSources(refetched);
                setSourcesLoaded(true);
                return;
              }
              try { localStorage.removeItem(LS_SOURCES_KEY); } catch {}
            } catch (e) {
              console.warn("[MF] LS → Supabase migration failed:", e);
            }
          }
        }

        if (cancelled) return;
        console.log(`[MF] Sources loaded from Supabase (${countAll(remote)})`);
        setSources(remote);
        setSourcesLoaded(true);
      } catch (e) {
        console.warn("[MF] Supabase sources fetch failed — falling back to localStorage:", e);
        if (cancelled) return;
        const local = loadSources();
        setSources(local);
        setSourcesLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoaded, session]);

  const addSource = useCallback(
    async (network: Network, name: string, scrapeQuery: string): Promise<SourceConfig> => {
      const k = networkKey(network);
      const newSource: SourceConfig = {
        id: generateId(),
        nazov: name,
        url: "",
        scrapeQuery,
      };
      const prev = sourcesRef.current;
      const next: SourcesByNetwork = {
        ...prev,
        [k]: [...prev[k], newSource],
      };
      setSources(next);

      if (!session) {
        saveSources(next);
        return newSource;
      }

      try {
        const { error } = await supabase.from("user_sources").insert({
          id: newSource.id,
          user_id: session.user.id,
          platform: network.toLowerCase(),
          identifier: scrapeQuery,
          visible: true,
          position: prev[k].length,
        });
        if (error) throw error;
        console.log("[MF] Source added to Supabase");
        return newSource;
      } catch (e) {
        console.warn("[MF] Source insert failed — reverting:", e);
        setSources(prev);
        throw e;
      }
    },
    [session]
  );

  const removeSource = useCallback(
    async (network: Network, sourceId: string): Promise<void> => {
      const k = networkKey(network);
      const prev = sourcesRef.current;
      const next: SourcesByNetwork = {
        ...prev,
        [k]: prev[k].filter((s) => s.id !== sourceId),
      };
      setSources(next);

      if (!session) {
        saveSources(next);
        return;
      }

      try {
        const { error } = await supabase
          .from("user_sources")
          .delete()
          .eq("id", sourceId);
        if (error) throw error;
        console.log("[MF] Source removed from Supabase");
      } catch (e) {
        console.warn("[MF] Source delete failed — reverting:", e);
        setSources(prev);
        throw e;
      }
    },
    [session]
  );

  return { sources, sourcesLoaded, addSource, removeSource };
}
