ALTER TABLE "core"."oauth_alert_events"
  ADD COLUMN IF NOT EXISTS "incident_id" text;
--> statement-breakpoint
UPDATE "core"."oauth_alert_events"
SET "incident_id" = "provider" || ':' || "phase" || ':' || "id"::text
WHERE "incident_id" IS NULL OR btrim("incident_id") = '';
--> statement-breakpoint
ALTER TABLE "core"."oauth_alert_events"
  ALTER COLUMN "incident_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_alert_events_incident_id_idx"
  ON "core"."oauth_alert_events" ("incident_id", "created_at");
--> statement-breakpoint
ALTER TABLE "core"."oauth_alert_deliveries"
  ADD COLUMN IF NOT EXISTS "incident_id" text;
--> statement-breakpoint
UPDATE "core"."oauth_alert_deliveries" AS "delivery"
SET "incident_id" = "event"."incident_id"
FROM "core"."oauth_alert_events" AS "event"
WHERE "delivery"."event_id" = "event"."id"
  AND ("delivery"."incident_id" IS NULL OR btrim("delivery"."incident_id") = '');
--> statement-breakpoint
UPDATE "core"."oauth_alert_deliveries"
SET "incident_id" = 'legacy:' || "event_id"::text
WHERE "incident_id" IS NULL OR btrim("incident_id") = '';
--> statement-breakpoint
ALTER TABLE "core"."oauth_alert_deliveries"
  ALTER COLUMN "incident_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_alert_deliveries_incident_id_idx"
  ON "core"."oauth_alert_deliveries" ("incident_id", "sent_at");
