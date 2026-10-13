import { createContext } from 'react';
import { defaultSettings, type MapViewSettings } from './map-view-settings';

/** The map's live view settings, for the few parts (edges) that need them as numbers rather than through CSS. */
export const MapViewContext = createContext<MapViewSettings>(defaultSettings());
