CREATE TABLE "weather_forecast_cache" (
	"userId" text PRIMARY KEY NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"coordsFingerprint" text NOT NULL,
	"openMeteoJson" jsonb,
	"openMeteoFetchedAtMs" text NOT NULL,
	"sunriseByDate" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "weather_forecast_cache" ADD CONSTRAINT "weather_forecast_cache_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
