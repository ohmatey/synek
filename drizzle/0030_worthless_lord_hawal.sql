ALTER TABLE `stories` ADD `brand_id` text REFERENCES brands(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `story_series` ADD `brand_id` text REFERENCES brands(id) ON DELETE SET NULL;--> statement-breakpoint
INSERT INTO brands (id, owner_id, slug, name, kit, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  p.owner_id,
  'project-brand-' || p.id,
  COALESCE(json_extract(p.brand, '$.name'), p.title),
  p.brand,
  p.created_at,
  p.updated_at
FROM projects p
WHERE p.brand IS NOT NULL AND p.brand_id IS NULL;--> statement-breakpoint
UPDATE projects
SET brand_id = (SELECT b.id FROM brands b WHERE b.slug = 'project-brand-' || projects.id)
WHERE brand IS NOT NULL AND brand_id IS NULL;
