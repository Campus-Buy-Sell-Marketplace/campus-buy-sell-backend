-- ============================================================
-- Campus Marketplace — Schema V6: Campus Meetup Location & Time
-- Run after schema_v5.sql
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS meetup_location VARCHAR(255) DEFAULT 'Campus Central Library Gate',
  ADD COLUMN IF NOT EXISTS meetup_time VARCHAR(255) DEFAULT 'Tomorrow (4:00 PM - 5:30 PM)',
  ADD COLUMN IF NOT EXISTS meetup_notes TEXT;
