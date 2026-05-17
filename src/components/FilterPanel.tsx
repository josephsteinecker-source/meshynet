import { useState, useRef, useEffect, useMemo, type RefObject } from "react";
import type { Network, SourcesByNetwork, SourceConfig } from "../types";
import { NETWORK_KEYS } from "../types";
import { sourceKey, loadFilterExpanded, saveFilterExpanded, loadNetworkExpanded, saveNetworkExpanded } from "../lib/storage";
import { EyeIcon, MinusIcon, SpinnerIcon, ChevronIcon, PlusIcon } from "./icons";

const PLACEHOLDER_BY_NETWORK: Record<Network, string> = {
  Facebook: "Meno Facebook stránky (napr. fender)",
  Instagram: "Instagram username (napr. fender)",
  YouTube: "YouTube @handle (napr. fendermusic)",
};

const HINT_BY_NETWORK: Record<Network, string> = {
  Facebook: "Zadaj presne tak, ako sa zobrazuje v URL stránky (bez https://facebook.com/).",
  Instagram: "Zadaj Instagram username (bez @, bez URL).",
  YouTube: "Zadaj YouTube @handle (bez @, bez URL).",
};

function AddSourceForm({
  network,
  onAdd,
  inputRef,
}: {
  network: Network;
  onAdd: (name: string, scrapeQuery: string) => Promise<void> | void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placeholder = PLACEHOLDER_BY_NETWORK[network];
  const hint = HINT_BY_NETWORK[network];

  const trimmed = value.trim();
  const canSubmit = !busy && trimmed.length >= 2;

  const handleAdd = async () => {
    if (!canSubmit) return;

    if (/^https?:\/\//i.test(trimmed) || trimmed.includes(" ")) {
      setError("Zadaj len meno profilu, nie URL ani medzery.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const cleanName = trimmed.replace(/^@/, "").replace(/\/+$/, "");
      await onAdd(cleanName, cleanName);
      setValue("");
    } catch (e: any) {
      if (e?.message === "MF_LIMIT_REACHED") {
        // No-op — parent zobrazil upgrade modal
      } else {
        setError("Nepodarilo sa pridať. Skús znova.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        background: "#f5f5f7",
        border: error
          ? "0.5px solid #ff9500"
          : "0.5px solid rgba(0,0,0,0.06)",
        borderRadius: 10,
        transition: "border-color 200ms ease",
      }}>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={placeholder}
          disabled={busy}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: 14,
            color: "#1d1d1f",
            fontFamily: "inherit",
            padding: "4px 0",
          }}
        />
        <button
          onClick={handleAdd}
          disabled={!canSubmit}
          title={canSubmit ? `Pridať ${network} profil` : "Zadaj meno profilu"}
          style={{
            background: "transparent",
            border: "none",
            padding: 4,
            cursor: canSubmit ? "pointer" : "default",
            opacity: canSubmit ? 1 : 0.4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <PlusIcon />
        </button>
      </div>

      {error ? (
        <div style={{
          fontSize: 12,
          color: "#ff9500",
          marginTop: 6,
          paddingLeft: 4,
        }}>
          {error}
        </div>
      ) : (
        <div style={{
          fontSize: 11,
          color: "#86868b",
          marginTop: 6,
          paddingLeft: 4,
          lineHeight: 1.4,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Source row
// ============================================================

function SourceRow({
  source, enabled, onToggle, onRemove, isScraping,
}: {
  source: SourceConfig;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
  isScraping?: boolean;
}) {
  const isScrapeSource = !!source.scrapeQuery;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 0",
    }}>
      {isScrapeSource && isScraping && (
        <span title="Načítavam najnovšie posty…" style={{ display: "inline-flex" }}>
          <SpinnerIcon />
        </span>
      )}
      {isScrapeSource && !isScraping && (
        <span title="Profil zo sociálnej siete" style={{
          fontSize: 11,
          color: "#0071e3",
          fontWeight: 600,
          letterSpacing: "0.3px",
          padding: "2px 6px",
          background: "rgba(0,113,227,0.08)",
          borderRadius: 4,
        }}>
          @
        </span>
      )}
      <span style={{
        flex: 1,
        fontSize: 14,
        color: enabled ? "#1d1d1f" : "#86868b",
        fontWeight: 400,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        transition: "color 200ms ease",
      }}>
        {source.nazov}
      </span>
      <button
        onClick={onToggle}
        title={enabled ? "Skryť" : "Zobraziť"}
        style={{
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <EyeIcon active={enabled} />
      </button>
      <button
        onClick={onRemove}
        title="Odobrať"
        style={{
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <MinusIcon />
      </button>
    </div>
  );
}

// ============================================================
// Filter panel — collapsible (2 levely: panel + per-network)
// ============================================================

export function FilterPanel({
  sources, hiddenIds, focusNetwork, scrapingIds,
  onToggleSource, onAddSource, onRemoveSource,
}: {
  sources: SourcesByNetwork;
  hiddenIds: Set<string>;
  focusNetwork?: Network | null;
  scrapingIds: Set<string>;
  onToggleSource: (key: string) => void;
  onAddSource: (network: Network, name: string, scrapeQuery: string) => Promise<void>;
  onRemoveSource: (network: Network, sourceId: string) => void;
}) {
  const [isPanelExpanded, setIsPanelExpanded] = useState<boolean>(loadFilterExpanded);
  const [networkExpanded, setNetworkExpanded] =
    useState<Record<Network, boolean>>(loadNetworkExpanded);
  const [panelHeaderHovered, setPanelHeaderHovered] = useState(false);
  const [hoveredNetworkHeader, setHoveredNetworkHeader] = useState<Network | null>(null);

  const fbInputRef = useRef<HTMLInputElement | null>(null);
  const igInputRef = useRef<HTMLInputElement | null>(null);
  const ytInputRef = useRef<HTMLInputElement | null>(null);
  const fbSectionRef = useRef<HTMLDivElement | null>(null);
  const igSectionRef = useRef<HTMLDivElement | null>(null);
  const ytSectionRef = useRef<HTMLDivElement | null>(null);

  const inputRefByNetwork: Record<Network, RefObject<HTMLInputElement | null>> = {
    Facebook: fbInputRef,
    Instagram: igInputRef,
    YouTube: ytInputRef,
  };
  const sectionRefByNetwork: Record<Network, RefObject<HTMLDivElement | null>> = {
    Facebook: fbSectionRef,
    Instagram: igSectionRef,
    YouTube: ytSectionRef,
  };

  // Persist states
  useEffect(() => {
    saveFilterExpanded(isPanelExpanded);
  }, [isPanelExpanded]);

  useEffect(() => {
    saveNetworkExpanded(networkExpanded);
  }, [networkExpanded]);

  // Auto-otvor panel + príslušnú sieť pri focusNetwork (klik na sieť v StatusBar)
  useEffect(() => {
    if (!focusNetwork) return;
    const panelWasExpanded = isPanelExpanded;
    const networkWasExpanded = networkExpanded[focusNetwork];

    if (!panelWasExpanded) setIsPanelExpanded(true);
    if (!networkWasExpanded) {
      setNetworkExpanded((prev) => ({ ...prev, [focusNetwork]: true }));
    }

    // Počkaj na animácie pred scroll + focus
    const panelDelay = panelWasExpanded ? 0 : 320;
    const networkDelay = networkWasExpanded ? 0 : 280;
    const totalDelay = panelDelay + networkDelay;

    const timer = setTimeout(() => {
      sectionRefByNetwork[focusNetwork].current?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
      setTimeout(() => {
        inputRefByNetwork[focusNetwork].current?.focus();
      }, 350);
    }, totalDelay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNetwork]);

  const counts = useMemo(() => ({
    Facebook: sources.facebook.length,
    Instagram: sources.instagram.length,
    YouTube: sources.youtube.length,
    total: sources.facebook.length + sources.instagram.length + sources.youtube.length,
  }), [sources]);

  const toggleNetwork = (network: Network) => {
    setNetworkExpanded((prev) => ({ ...prev, [network]: !prev[network] }));
  };

  return (
    <div style={{
      background: "#ffffff",
      border: "0.5px solid rgba(0,0,0,0.08)",
      borderRadius: 12,
      marginBottom: 14,
      overflow: "hidden",
    }}>
      {/* PANEL HEADER — vždy viditeľný, klikateľný */}
      <button
        type="button"
        onClick={() => setIsPanelExpanded((e) => !e)}
        onMouseEnter={() => setPanelHeaderHovered(true)}
        onMouseLeave={() => setPanelHeaderHovered(false)}
        aria-expanded={isPanelExpanded}
        aria-controls="filter-panel-body"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          width: "100%",
          padding: "14px 20px",
          background: panelHeaderHovered ? "#fafafa" : "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          transition: "background 160ms ease",
        }}
        title={isPanelExpanded ? "Zbaliť zoznam zdrojov" : "Rozbaliť zoznam zdrojov"}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{
            fontSize: 15,
            fontWeight: 500,
            color: "#1d1d1f",
            letterSpacing: "-0.1px",
          }}>
            Zdroje
          </span>
          <span style={{
            fontSize: 12,
            color: "#86868b",
            fontWeight: 400,
          }}>
            {counts.total === 0
              ? "Žiadne pridané"
              : `${counts.Facebook} Facebook · ${counts.Instagram} Instagram · ${counts.YouTube} YouTube`}
          </span>
        </div>
        <ChevronIcon expanded={isPanelExpanded} />
      </button>

      {/* PANEL BODY — collapsible cez grid-template-rows trick */}
      <div
        id="filter-panel-body"
        aria-hidden={!isPanelExpanded}
        style={{
          display: "grid",
          gridTemplateRows: isPanelExpanded ? "1fr" : "0fr",
          transition: "grid-template-rows 280ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        <div style={{ overflow: "hidden", minHeight: 0 }}>
          <div style={{
            borderTop: "0.5px solid rgba(0,0,0,0.06)",
          }}>
            {NETWORK_KEYS.map(({ key, network }, idx) => {
              const list = sources[key];
              const isLast = idx === NETWORK_KEYS.length - 1;
              const isNetExpanded = networkExpanded[network];
              const isHovered = hoveredNetworkHeader === network;

              return (
                <div
                  key={network}
                  ref={sectionRefByNetwork[network]}
                  style={{
                    borderBottom: isLast ? "none" : "0.5px solid rgba(0,0,0,0.06)",
                  }}
                >
                  {/* NETWORK HEADER */}
                  <button
                    type="button"
                    onClick={() => toggleNetwork(network)}
                    onMouseEnter={() => setHoveredNetworkHeader(network)}
                    onMouseLeave={() => setHoveredNetworkHeader(null)}
                    aria-expanded={isNetExpanded}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      width: "100%",
                      padding: "12px 20px",
                      background: isHovered ? "#fafafa" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                      transition: "background 160ms ease",
                    }}
                    title={isNetExpanded ? `Zbaliť ${network}` : `Rozbaliť ${network}`}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 15,
                        fontWeight: 500,
                        color: "#1d1d1f",
                      }}>
                        {network}
                      </span>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: list.length === 0 ? "#c7c7cc" : "#86868b",
                        padding: "1px 8px",
                        background: list.length === 0 ? "transparent" : "#f5f5f7",
                        borderRadius: 10,
                        minWidth: 22,
                        textAlign: "center",
                      }}>
                        {list.length}
                      </span>
                    </div>
                    <ChevronIcon expanded={isNetExpanded} size={16} />
                  </button>

                  {/* NETWORK BODY — collapsible */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: isNetExpanded ? "1fr" : "0fr",
                      transition: "grid-template-rows 260ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                    }}
                    aria-hidden={!isNetExpanded}
                  >
                    <div style={{ overflow: "hidden", minHeight: 0 }}>
                      <div style={{ padding: "0 20px 14px" }}>
                        <AddSourceForm
                          network={network}
                          inputRef={inputRefByNetwork[network]}
                          onAdd={(name, scrapeQuery) => onAddSource(network, name, scrapeQuery)}
                        />

                        {list.length === 0 ? (
                          <div style={{
                            fontSize: 13,
                            color: "#c7c7cc",
                            padding: "6px 0",
                            fontStyle: "italic",
                          }}>
                            žiadne zdroje
                          </div>
                        ) : (
                          list.map((s) => {
                            const k = sourceKey(network, s.id);
                            const enabled = !hiddenIds.has(k);
                            return (
                              <SourceRow
                                key={s.id}
                                source={s}
                                enabled={enabled}
                                isScraping={scrapingIds.has(s.id)}
                                onToggle={() => onToggleSource(k)}
                                onRemove={() => onRemoveSource(network, s.id)}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
