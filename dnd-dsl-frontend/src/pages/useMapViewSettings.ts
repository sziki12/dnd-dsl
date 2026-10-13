import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendURL } from '../contexts/BackendContext.js';
import { defaultSettings, sanitizeSettings, settingsToStored, type MapViewSettings } from './map-view-settings';

/** How long after the last change the settings are written, so dragging a slider is one save, not hundreds. */
const SAVE_DELAY_MS = 500;
/** One object for "nothing loaded yet", so the settings keep the same identity between renders. */
const DEFAULTS = defaultSettings();

type Target = { adventure: string; world: string; location: string };
type Pending = Target & { settings: MapViewSettings };

const query = (t: Target) =>
  `adventure=${encodeURIComponent(t.adventure)}&world=${encodeURIComponent(t.world)}&location=${encodeURIComponent(t.location)}`;

function save(pending: Pending) {
  // keepalive lets the request finish when the page is being closed or navigated away from.
  void fetch(`${BackendURL}/file/view/save?${query(pending)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settingsToStored(pending.settings)),
    keepalive: true,
  }).catch(() => { /* the settings still apply on screen; the next change tries again */ });
}

/**
 * The map's view settings for one location, saved on the server (`<world>.mapview.json`).
 * Loads when the location changes; every change applies at once and is written shortly after.
 * `ready` is false until the saved settings have arrived, so the map is not drawn in the wrong colours first.
 */
export function useMapViewSettings(adventure: string, world: string, location: string) {
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
    fetch(`${BackendURL}/file/view/load?${query({ adventure, world, location })}`)
      .then(response => (response.ok ? response.json() : {}))
      .catch(() => ({}))
      .then(raw => {
        if (cancelled) return;
        // If the user already changed something while this was loading, keep their version.
        setLoaded(previous => (previous?.key === key ? previous : { key, settings: sanitizeSettings(raw) }));
      });
    window.addEventListener('pagehide', flush);
    return () => {
      cancelled = true;
      window.removeEventListener('pagehide', flush);
      // Leaving this location (or the page): write what has not been written yet, under the old location.
      flush();
    };
  }, [key, adventure, world, location, flush]);

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
