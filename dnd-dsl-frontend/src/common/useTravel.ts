import { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackendURL } from '../contexts/BackendContext';
import { DslContext } from '../contexts/DslContext';
import { locationRoute } from './location-identity';

/**
 * Follows an exit into another world: opens that world (every page follows) and goes to the place. The Editor holds
 * the whole adventure, so its unsaved edits are not in the way.
 */
export function useTravel() {
  const navigate = useNavigate();
  const { adventure } = useContext(DslContext);

  return useCallback(async (world: string, path: readonly string[]) => {
    const response = await fetch(
      `${BackendURL}/adventure/open?adventure=${encodeURIComponent(adventure)}&world=${encodeURIComponent(world)}`,
      { method: 'POST' },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      window.alert(typeof body?.message === 'string' ? body.message : `Could not open the world "${world}".`);
      return;
    }
    navigate(locationRoute(path));
  }, [adventure, navigate]);
}
