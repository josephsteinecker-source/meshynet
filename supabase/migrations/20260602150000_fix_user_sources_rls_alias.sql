-- Fix: user_sources_insert_own policy had ambiguous alias in tier-check subquery.
-- The inner FROM user_sources shadowed the outer NEW row, so `user_sources.platform`
-- in the WHERE clause referred to the iterating row (= always true) instead of NEW.
-- Result: the count was total rows for the user across ALL platforms, not per-platform.
-- Fix: alias the inner table as `us` so `user_sources.platform` unambiguously refers
-- to the outer NEW row.

DROP POLICY IF EXISTS "user_sources_insert_own" ON public.user_sources;

CREATE POLICY "user_sources_insert_own"
  ON public.user_sources FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      SELECT COUNT(*)
      FROM public.user_sources us
      WHERE us.user_id = auth.uid()
        AND us.platform = user_sources.platform
    ) < (
      SELECT max_profiles_per_platform
      FROM public.user_profiles
      WHERE user_id = auth.uid()
    )
  );
