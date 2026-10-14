import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendURL } from '../contexts/BackendContext.js';
import { errorMessageOf, validateImageFile } from './map-image';
import type { Size } from './map-coords';

export type MapImage = { url: string; natural: Size };

type Loaded = { adventure: string; location: string; image: MapImage | null };

const query = (adventure: string, location: string) =>
  `adventure=${encodeURIComponent(adventure)}&location=${encodeURIComponent(location)}`;

/** Fetches the location's map image and decodes it, so its natural size is known before it is drawn. */
async function fetchImage(adventure: string, location: string, version: number): Promise<MapImage> {
  // `v` changes after an upload; the URL is otherwise the same, and a cached copy must not be reused.
  const response = await fetch(`${BackendURL}/image/load?${query(adventure, location)}&v=${version}`);
  if (!response.ok) throw new Error('no map image');
  const url = URL.createObjectURL(await response.blob());
  return new Promise<MapImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, natural: { width: img.naturalWidth, height: img.naturalHeight } });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('failed to decode map image')); };
    img.src = url;
  });
}

/**
 * The map image of one location (none is the normal case, not an error), and a way to replace it.
 * After an upload the old image stays on screen until the new one has loaded; moving to another
 * location shows no image until that location's own has loaded.
 */
export function useMapImage(adventure: string, location: string) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [upload, setUpload] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!adventure || !location) return;
    let cancelled = false;
    fetchImage(adventure, location, version)
      .then(image => {
        if (cancelled) { URL.revokeObjectURL(image.url); return; }
        const previous = urlRef.current;
        urlRef.current = image.url;
        setLoaded({ adventure, location, image });
        // Give the screen a moment to switch to the new image before the old one is released.
        if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
      })
      .catch(() => {
        if (cancelled) return;
        const previous = urlRef.current;
        urlRef.current = null;
        setLoaded({ adventure, location, image: null });
        if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
      });
    return () => { cancelled = true; };
  }, [adventure, location, version]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const replace = useCallback(async (file: File) => {
    const problem = validateImageFile(file);
    if (problem) { setUpload({ busy: false, error: problem }); return; }
    setUpload({ busy: true, error: null });
    try {
      const response = await fetch(`${BackendURL}/image/upload?${query(adventure, location)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        throw new Error(errorMessageOf(body, response.status));
      }
      setVersion(v => v + 1);
      setUpload({ busy: false, error: null });
    } catch (error) {
      setUpload({ busy: false, error: error instanceof Error ? error.message : 'The upload failed.' });
    }
  }, [adventure, location]);

  const image = loaded !== null && loaded.adventure === adventure && loaded.location === location ? loaded.image : null;
  return { image, replace, busy: upload.busy, error: upload.error } as const;
}
