-- New sharing categories for additional Apple Health data.
-- (Enum values are added in their own migration: a new enum value cannot be used in
-- the same transaction that adds it.)
alter type public.health_category add value if not exists 'vitals';
alter type public.health_category add value if not exists 'mobility';
alter type public.health_category add value if not exists 'body';
