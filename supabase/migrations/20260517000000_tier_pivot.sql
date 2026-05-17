-- Migration: tier_pivot
-- Renames tier values (anonymous→free, standard→plus) and adds unlimited tier.
-- Renames max_profiles_per_network → max_profiles_per_platform.
-- Run manually in Supabase Studio SQL Editor.

-- ============================================================
-- 1. Rename tier column values in user_profiles
-- ============================================================

UPDATE user_profiles SET tier = 'free'      WHERE tier = 'anonymous';
UPDATE user_profiles SET tier = 'plus'      WHERE tier = 'standard';

-- Ensure max_profiles_per_platform limits match new tier structure
UPDATE user_profiles SET max_profiles_per_platform = 10  WHERE tier = 'free';
UPDATE user_profiles SET max_profiles_per_platform = 30  WHERE tier = 'plus';
UPDATE user_profiles SET max_profiles_per_platform = 9999 WHERE tier = 'unlimited';

-- Rename column (run only if column is still named max_profiles_per_network)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles'
      AND column_name = 'max_profiles_per_network'
  ) THEN
    ALTER TABLE user_profiles
      RENAME COLUMN max_profiles_per_network TO max_profiles_per_platform;
  END IF;
END $$;

-- ============================================================
-- 2. Update pricing_tiers table
-- ============================================================

-- Rename column in pricing_tiers if needed
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_tiers'
      AND column_name = 'max_profiles_per_network'
  ) THEN
    ALTER TABLE pricing_tiers
      RENAME COLUMN max_profiles_per_network TO max_profiles_per_platform;
  END IF;
END $$;

-- Remove old tiers and insert new ones
DELETE FROM pricing_tiers WHERE tier_id IN ('anonymous', 'standard');

INSERT INTO pricing_tiers (tier_id, display_name, description, price_eur, max_profiles_per_platform, display_order)
VALUES
  ('plus',      'Plus',      '30 profilov per platforma',       2.00,  30,   1),
  ('unlimited', 'Unlimited', 'Neobmedzený počet profilov',       7.00,  9999, 2)
ON CONFLICT (tier_id) DO UPDATE
  SET display_name             = EXCLUDED.display_name,
      description              = EXCLUDED.description,
      price_eur                = EXCLUDED.price_eur,
      max_profiles_per_platform = EXCLUDED.max_profiles_per_platform,
      display_order            = EXCLUDED.display_order;

-- ============================================================
-- 3. Update check constraint on user_profiles.tier (if exists)
-- ============================================================

DO $$
BEGIN
  -- Drop old constraint if it exists (name may vary — adjust if needed)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_tier_check'
  ) THEN
    ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_tier_check;
  END IF;

  ALTER TABLE user_profiles
    ADD CONSTRAINT user_profiles_tier_check
    CHECK (tier IN ('free', 'plus', 'unlimited'));
END $$;
