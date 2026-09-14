-- One-off: mark the "Extra Indeed companies" list (emailed Sep 7, 2026) with
-- source = 'Indeed'. Safe to run repeatedly. Matches on the company name,
-- case- and whitespace-insensitive.
--
-- Run the whole file in the Supabase SQL editor. The final SELECT lists any
-- names from the list that did not match a company row, so they can be fixed
-- by hand (usually a spelling difference in the CRM).

create temp table indeed_names (name text) on commit drop;

insert into indeed_names (name) values
  ('Ontario Refrigeration'),
  ('Windy City Equipment Service'),
  ('J Wolf Mechanical'),
  ('Semper Fi Heating & Cooling'),
  ('Emergency Air'),
  ('Cool Zone Air Conditioning and Heating'),
  ('Skyline Mechanical'),
  ('Jenson Refrigeration'),
  ('Ground Zero Plumbing & AC'),
  ('Sunstate Mechanical Services'),
  ('Andrews Refrigeration'),
  ('Corporate Air Mechanical Services'),
  ('Maricopa Air'),
  ('Central Mechanical Services'),
  ('Tri-Mega Mechanical'),
  ('Haynes Mechanical Systems'),
  ('Sonoran Sun Heating and Cooling'),
  ('Arizona Gold Air'),
  ('A&K Plumbing, Mechanical and HVAC'),
  ('Kade Mechanical'),
  ('IS Mechanical'),
  ('RKS Plumbing and Mechanical'),
  ('Expert HVAC Services'),
  ('Tropical Companies'),
  ('TruTek Heating and Air Conditioning'),
  ('Midwest Mechanical Solutions'),
  ('Five Sharp'),
  ('Blue Collar Mechanical'),
  ('Air Lily Heating and Cooling'),
  ('Penguin Air, Plumbing & Electrical'),
  ('Parker & Sons'),
  ('Donley Service Center'),
  ('Desert Sun Heating, Cooling & Refrigeration'),
  ('CDL Mechanical'),
  ('AccuTemp Refrigeration'),
  ('Elite Air Conditioning Solutions'),
  ('Larson Air Conditioning'),
  ('Air2o'),
  ('Authority HVAC'),
  ('Helios HVACR Services'),
  ('Wise Cooling & Heating'),
  ('Cave Creek Cooling'),
  ('TrustPoint Electric & Air'),
  ('Precision Air & Heating'),
  ('Climate Pro'),
  ('Autumn Air Heating and Cooling'),
  ('Weather Masters'),
  ('Wolfgang''s Cooling Heating & Plumbing'),
  ('True Home Maintenance Air Conditioning & Heating'),
  ('Service 1st Home Maintenance'),
  ('Grand Canyon Home Services'),
  ('State 48 Air Conditioning and Heating'),
  ('Blackstone Plumbing, Heating & Air Conditioning'),
  ('Mission Mechanical Services'),
  ('Country Cooling & Heating'),
  ('Interior Climate Solutions'),
  ('Steve''s Ultimate Air Heating & Cooling'),
  ('Optimum Air'),
  ('BLS Mechanical'),
  ('Agave Mechanical'),
  ('Six Star AC'),
  ('SelmerAir'),
  ('Efficiency Mechanical'),
  ('Lock Raider'),
  ('Arizona Commercial Kitchen Repair'),
  ('Professional Piping Systems'),
  ('Arizona Air Balance Company'),
  ('Diamond Mechanical'),
  ('Emergency Air Heating and Cooling');

-- Normalize both sides: lowercase, collapse whitespace, treat "and" and "&"
-- the same so "Semper Fi Heating and Cooling" still matches.
create or replace function pg_temp.norm(t text) returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(lower(trim(t)), '\s*&\s*|\s+and\s+', ' and ', 'g'),
           '\s+', ' ', 'g');
$$;

update companies c
   set source = 'Indeed'
  from indeed_names n
 where pg_temp.norm(c.name) = pg_temp.norm(n.name)
   and c.source is distinct from 'Indeed';

-- Names from the list with no matching company row.
select n.name as not_found
  from indeed_names n
 where not exists (
   select 1 from companies c where pg_temp.norm(c.name) = pg_temp.norm(n.name)
 )
 order by n.name;
