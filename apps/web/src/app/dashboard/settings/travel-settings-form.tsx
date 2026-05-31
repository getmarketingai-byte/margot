"use client";

import { useState } from "react";
import type { RoutingProvider } from "@margot/schema";
import { HomeAddressField } from "./home-address-field";

interface TravelSettingsFormProps {
  updateTravel: (formData: FormData) => Promise<void>;
  defaultHomeAddress: string;
  defaultRoutingProvider: RoutingProvider;
  defaultRoutingMaxCalls: number;
  defaultRoutingAvoidTolls: boolean;
  weatherEnabled: boolean;
}

export function TravelSettingsForm({
  updateTravel,
  defaultHomeAddress,
  defaultRoutingProvider,
  defaultRoutingMaxCalls,
  defaultRoutingAvoidTolls,
  weatherEnabled
}: TravelSettingsFormProps) {
  const [routingProvider, setRoutingProvider] =
    useState<RoutingProvider>(defaultRoutingProvider);
  const homeRequired = weatherEnabled || routingProvider !== "disabled";

  return (
    <form action={updateTravel} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1 text-xs sm:col-span-2">
        <label htmlFor="home-address" className="font-normal">
          Home address
          {homeRequired ? (
            <span className="ml-1 text-red-600 dark:text-red-400">(required)</span>
          ) : null}
        </label>
        <HomeAddressField
          id="home-address"
          name="homeAddress"
          defaultValue={defaultHomeAddress}
          required={homeRequired}
          placeholder="e.g. 123 Example St, Melbourne VIC 3000  —  or  -37.910156,145.107420"
        />
        <span className="text-[11px] text-ink-400">
          Origin/destination for drive legs, and the location for weather suitability when that
          feature is enabled. Use current location to paste GPS coordinates (you can edit the text
          into a street address later). Leave blank only when routing is disabled and weather-based
          outside blocks are off.
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        Routing provider
        <select
          name="routingProvider"
          value={routingProvider}
          onChange={(e) => setRoutingProvider(e.target.value as RoutingProvider)}
          className="field"
        >
          <option value="disabled">Disabled (fallback estimate only)</option>
          <option value="openrouteservice">OpenRouteService (free tier)</option>
        </select>
        <span className="text-[11px] text-ink-400">
          Server needs <code>OPENROUTESERVICE_API_KEY</code> for live lookups; otherwise drives
          quietly stay at the fallback duration.
        </span>
      </label>
      <label className="flex items-center gap-2 text-xs sm:col-span-2">
        <input
          type="checkbox"
          name="routingAvoidTolls"
          defaultChecked={defaultRoutingAvoidTolls}
          disabled={routingProvider === "disabled"}
        />
        <span>Avoid toll roads (OpenRouteService)</span>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Max provider calls per render
        <input
          name="routingMaxCallsPerRender"
          type="number"
          min={0}
          max={200}
          defaultValue={defaultRoutingMaxCalls}
          className="field"
        />
        <span className="text-[11px] text-ink-400">
          Caps cost on the free tier. Stale legs are refreshed soonest-event-first.
        </span>
      </label>
      <div className="sm:col-span-2">
        <button type="submit" className="btn-primary w-full">
          Save travel settings
        </button>
      </div>
    </form>
  );
}
