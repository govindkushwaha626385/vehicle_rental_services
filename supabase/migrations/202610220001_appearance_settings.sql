-- 202610220001_appearance_settings.sql
-- Admin-controlled appearance defaults.
--
-- These are ordinary settings, so they can be changed from Admin → Settings
-- without a schema change. The client applies them as CSS custom properties,
-- which means Tailwind utilities and component styles repaint together.

insert into public.settings (key, value) values
  ('theme_accent', 'lime'),
  ('theme_radius', 'soft'),
  ('theme_motion', 'full'),
  ('map_view_enabled', 'true')
on conflict (key) do nothing;
