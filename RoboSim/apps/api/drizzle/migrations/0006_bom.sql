CREATE TYPE "public"."stock_status" AS ENUM('in_stock', 'low', 'out_of_stock', 'unknown');--> statement-breakpoint
CREATE TABLE "catalog_prices" (
	"part_key" text PRIMARY KEY NOT NULL,
	"price_irr" bigint,
	"stock" "stock_status" DEFAULT 'unknown' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_inventory" (
	"user_id" uuid NOT NULL,
	"part_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_inventory_user_id_part_key_pk" PRIMARY KEY("user_id","part_key"),
	CONSTRAINT "user_inventory_quantity_positive" CHECK ("user_inventory"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_prices" ADD CONSTRAINT "catalog_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_inventory" ADD CONSTRAINT "user_inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Parts list (FR-BOM-02/03). Prices are a global catalogue requests read; staff write it as the owning role.
-- A user reads and replaces only their own inventory.
GRANT SELECT ON catalog_prices TO robosim_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_inventory TO robosim_app;
--> statement-breakpoint
ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_inventory FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_inventory_owner ON user_inventory TO robosim_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
