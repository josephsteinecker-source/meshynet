export type Network = "Facebook" | "Instagram" | "YouTube";
export type View = "index" | "feed";
export type Mode = "free" | "filter";

// Mirror of Rust structs in src-tauri/src/backend.rs
export type UserStatus = {
  user_id: string | null;
  email: string | null;
  tier: string;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  max_profiles_per_network: number;
};

export type PricingTier = {
  tier_id: string;
  display_name: string;
  description: string | null;
  price_eur: number;
  max_profiles_per_network: number;
  display_order: number;
  features: any | null;
};

export type StatusResponse = {
  status: UserStatus;
  available_tiers: PricingTier[];
};

export type SourceConfig = {
  id: string;
  nazov: string;
  url: string;          // Legacy field (zostáva kvôli kompatibilite so starými dátami)
  scrapeQuery?: string; // Profile name pre scraping (primárny mechanizmus)
};

export type SourcesByNetwork = {
  facebook: SourceConfig[];
  instagram: SourceConfig[];
  youtube: SourceConfig[];
};

export type NetworkStatus = "connected" | "empty" | "error";

export type Post = {
  id: string;
  network: Network;
  sourceId: string;
  sourceName: string;
  authorAvatar?: string;
  body: string;
  imageUrl?: string;
  videoThumbUrl?: string;
  permalink: string;
  publishedAt: Date;
};

export const NETWORK_KEYS: Array<{ key: keyof SourcesByNetwork; network: Network }> = [
  { key: "facebook", network: "Facebook" },
  { key: "instagram", network: "Instagram" },
  { key: "youtube", network: "YouTube" },
];

export const BRAND_GRADIENT =
  "linear-gradient(135deg, #4061ad 0%, #5c59a7 30%, #4788c7 65%, #2fbebe 100%)";
