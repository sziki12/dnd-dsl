import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendURL } from '../contexts/BackendContext.js';
import { readWithLegacy } from '../common/location-identity';
import { defaultSettings, sanitizeSettings, settingsToStored, type MapViewSettings } from './map-view-settings';

/** How long after the last change the settings are written, so dragging a slider is one save, not hundreds. */
const SAVE_DELAY_MS = 500;
/** One object for "nothing loaded yet", so the settings keep the same identity between renders. */
const DEFAULTS = defaultSettings();

type Target = { adventure: string; world: string; location: string };
type Pending = Target & { settings: MapViewSettings };

const query = (t: Target) =>
  `adventure=${encodeURIComponent(t.adventure)}&world=${encodeURIComponent(t.world)}&location=${encodeURIComponent(t.location)}`;

function post(target: Target, body: unknown): Promise<Response> {
  // keepalive lets the request finish when the page is being closed or navigated away from.
  return fetch(`${BackendURL}/file/view/save?${query(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  });
}

function save(pending: Pending) {
  void post(pending, settingsToStored(pending.settings)).catch(() => { /* the settings still apply on screen; the next change tries again */ });
}

async function read(target: Target): Promise<Record<string, unknown>> {
  const response = await fetch(`${BackendURL}/file/view/load?${query(target)}`).catch(() => undefined);
  return response?.ok ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : {};
}

/**
 * Moves settings found under a location's old key to its current one: written to the new key first, and only then
 * cleared from the old one, so they are never in neither. Without the clearing, putting the settings back to the defaults
 * (which removes the new entry) would bring the old ones back on the next load.
 */
async function moveToCurrentKey(target: Target, legacyLocation: string, settings: MapViewSettings) {
  try {
    const written = await post(target, settingsToStored(settings));
    if (written.ok) await post({ ...target, location: legacyLocation }, {});
  } catch { /* the old entry stays, and the next load moves it again */ }
}

/**
 * The map's view settings for one location, saved on the server (`<world>.mapview.json`).
 * Loads when the location changes; every change applies at once and is written shortly after.
 * `ready` is false until the saved settings have arrived, so the map is not drawn in the wrong colours first.
 */
export function useMapViewSettings(adventure: string, world: string, location: string, legacyLocation?: string) {
  const key = adventure && world && location ? JSON.stringify([adventure, world, location]) : '';
  const [loaded, setLoaded] = useState<{ key: string; settings: MapViewSettings } | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) save(pending);
  }, []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const target = { adventure, world, location };
    readWithLegacy(loc => read({ adventure, world, location: loc }), location, legacyLocation)
      .then(({ value, fromLegacy }) => {
        if (cancelled) return;
        const settings = sanitizeSettings(value);
        // If the user already changed something while this was loading, keep their version.
        setLoaded(previous => (previous?.key === key ? previous : { key, settings }));
        if (fromLegacy && legacyLocation !== undefined) void moveToCurrentKey(target, legacyLocation, settings);
      });
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', flush);
      // Leaving this location (or the page): write what has not been written yet, under the old location.
      flush();
    };
  }, [key, adventure, world, location, legacyLocation, flush]);

  const update = useCallback((next: MapViewSettings) => {
    if (!key) return;
    setLoaded({ key, settings: next });
    pendingRef.current = { adventure, world, location, settings: next };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [key, adventure, world, location, flush]);

  const settings = loaded !== null && loaded.key === key ? loaded.settings : DEFAULTS;
  const ready = key !== '' && loaded?.key === key;
  return [settings, update, ready] as const;
}
