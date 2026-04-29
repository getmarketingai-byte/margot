"use client";

import { useState } from "react";

interface HomeAddressFieldProps {
  name: string;
  defaultValue: string;
  /** When routing or weather-based outside blocks is on, the field is required. */
  required?: boolean;
  id?: string;
  placeholder?: string;
}

export function HomeAddressField({
  name,
  defaultValue,
  required: requiredProp,
  id = "home-address",
  placeholder
}: HomeAddressFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function useCurrentLocation() {
    setErrorMsg(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErrorMsg("Geolocation is not available in this browser.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setValue(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        setBusy(false);
      },
      (err) => {
        setErrorMsg(err.message || "Could not read your location.");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 120_000 }
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        id={id}
        name={name}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        required={requiredProp}
        className="field"
        aria-required={requiredProp || undefined}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:text-ink-200 dark:hover:bg-ink-800/60"
          disabled={busy}
          onClick={useCurrentLocation}
        >
          {busy ? "Locating…" : "Use current location"}
        </button>
        {errorMsg ? (
          <span className="text-xs text-red-600 dark:text-red-400" role="alert">
            {errorMsg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
