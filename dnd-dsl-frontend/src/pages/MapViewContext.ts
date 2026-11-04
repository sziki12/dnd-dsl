import { createContext } from 'react';
import { defaultSettings, type MapViewSettings } from './map-view-settings';

/** The map's live view settings, for the few parts (edges) that need them as numbers rather than through CSS. */
export const MapViewContext = createContext<MapViewSettings>(defaultSettings());

/** Opens or closes the group with this name; null where the map has no groups (the location page). */
export const MapGroupContext = createContext<((name: string) => void) | null>(null);
