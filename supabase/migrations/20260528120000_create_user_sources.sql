-- Migration: create_user_sources
-- Creates the user_sources table that tracks which Facebook/Instagram/YouTube
-- profiles each user is following. Owned by the MeshyNet web/desktop apps;
-- read by the meshynet-scraper-api cron loop (via service_role, bypasses RLS).
--
-- Tier enforcement is encoded as an RLS INSERT policy that counts existing
-- rows for (user_id, platform) and rejects writes that would exceed
-- user_profiles.max_profiles_per_platform.

-- ============================================================
-- 1. Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('facebook', 'instagram', 'youtube')),
  identifier  text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  visible     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, identifier)
);

-- ============================================================
-- 2. Indexes
-- ============================================================
-- Scraper cron query: SELECT platform, identifier WHERE visible = true
CREATE INDEX IF NOT EXISTS idx_user_sources_visible_platform
  ON public.user_sources (visible, platform, identifier)
  WHERE visible = true;

-- Frontend ownership query: WHERE user_id = auth.uid() ORDER BY position
CREATE INDEX IF NOT EXISTS idx_user_sources_user_position
  ON public.user_sources (user_id, position);

-- ============================================================
-- 3. updated_at trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_sources_updated_at ON public.user_sources;
CREATE TRIGGER trg_user_sources_updated_at
  BEFORE UPDATE ON public.user_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. Row Level Security
-- ============================================================

ALTER TABLE public.user_sources ENABLE ROW LEVEL SECURITY;

-- Drop-then-create pattern (Postgres < 15 has no CREATE POLICY IF NOT EXISTS)
DROP POLICY IF EXISTS "user_sources_select_own"  ON public.user_sources;
DROP POLICY IF EXISTS "user_sources_insert_own"  ON public.user_sources;
DROP POLICY IF EXISTS "user_sources_update_own"  ON public.user_sources;
DROP POLICY IF EXISTS "user_sources_delete_own"  ON public.user_sources;

-- SELECT: user reads only their own rows
CREATE POLICY "user_sources_select_own"
  ON public.user_sources FOR SELECT
  USING (user_id = auth.uid());

-- INSERT: user can insert only own rows AND must be under tier limit
CREATE POLICY "user_sources_insert_own"
  ON public.user_sources FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      SELECT COUNT(*)
      FROM public.user_sources
      WHERE user_id = auth.uid()
        AND platform = user_sources.platform
    ) < (
      SELECT max_profiles_per_platform
      FROM public.user_profiles
      WHERE user_id = auth.uid()
    )
  );

-- UPDATE: user updates only own rows; cannot change ownership
CREATE POLICY "user_sources_update_own"
  ON public.user_sources FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: user deletes only own rows
CREATE POLICY "user_sources_delete_own"
  ON public.user_sources FOR DELETE
  USING (user_id = auth.uid());

-- Service-role bypasses RLS by default; scraper API reads (visible=true)
-- via service_role key — no explicit grant needed.
