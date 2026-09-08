CREATE TABLE event_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  UNIQUE (event_id, name),
  UNIQUE (event_id, sort_order)
);

ALTER TABLE seats ADD COLUMN pricing_tier_id uuid REFERENCES event_pricing_tiers(id);

WITH distinct_prices AS (
  SELECT event_id, price_paise,
         dense_rank() OVER (PARTITION BY event_id ORDER BY price_paise DESC) - 1 AS tier_order
  FROM seats
  GROUP BY event_id, price_paise
)
INSERT INTO event_pricing_tiers (event_id, name, price_paise, color, sort_order)
SELECT event_id,
       CASE
         WHEN event_id = '10000000-0000-4000-8000-000000000001' AND price_paise = 120000 THEN 'VIP'
         WHEN event_id = '10000000-0000-4000-8000-000000000001' AND price_paise = 80000 THEN 'Standard'
         WHEN tier_order = 0 THEN 'Standard'
         ELSE 'Tier ' || (tier_order + 1)
       END,
       price_paise,
       (ARRAY['#80ED99', '#F6C453', '#7EA8FF', '#C792EA', '#FF8A80'])[(least(tier_order + 1, 5))::int],
       tier_order
FROM distinct_prices;

UPDATE seats s
SET pricing_tier_id = pt.id
FROM event_pricing_tiers pt
WHERE pt.event_id = s.event_id AND pt.price_paise = s.price_paise;

ALTER TABLE seats ALTER COLUMN pricing_tier_id SET NOT NULL;

CREATE INDEX event_pricing_tiers_event_id_idx ON event_pricing_tiers (event_id, sort_order);
CREATE INDEX seats_pricing_tier_id_idx ON seats (pricing_tier_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_pricing_tiers TO seatlock_app;

ALTER TABLE event_pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY pricing_tiers_public_read ON event_pricing_tiers
  FOR SELECT TO seatlock_app
  USING (current_setting('app.access_mode', true) = 'public');

CREATE POLICY pricing_tiers_tenant_all ON event_pricing_tiers
  FOR ALL TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_pricing_tiers.event_id
        AND e.organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.access_mode', true) = 'tenant'
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_pricing_tiers.event_id
        AND e.organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
    )
  );
