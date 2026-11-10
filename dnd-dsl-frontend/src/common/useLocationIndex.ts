import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { SerializedLocation } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { DslContext } from '../contexts/DslContext';
import { indexLocations, parseLocationRoute, type LocationIndex } from './location-identity';

export function useLocationIndex(): LocationIndex<SerializedLocation> | undefined {
  const { worldState } = useContext(DslContext);
  const locations = worldState?.World?.locations;
  return useMemo(() => (locations ? indexLocations(locations) : undefined), [locations]);
}

export function useLocationRoute(): string[] | undefined {
  const { pathname } = useLocation();
  return useMemo(() => parseLocationRoute(pathname), [pathname]);
}
