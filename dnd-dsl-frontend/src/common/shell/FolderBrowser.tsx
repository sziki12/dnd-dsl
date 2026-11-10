import { useContext, useEffect, useState, type FormEvent } from 'react';
import { DslContext } from '../../contexts/DslContext';
import { button, call, ErrorLine, errorText, field, primary, row, type FolderListing } from './file-ui';
import { joinPath } from './folder-path';

/**
 * Browses the folders of the machine the server runs on and sets the one that holds the adventures.
 * A path that does not exist yet can be typed too: choosing it then creates it.
 */
export default function FolderBrowser({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { sourceFolder } = useContext(DslContext);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [typed, setTyped] = useState(sourceFolder ?? '');
  const [error, setError] = useState<string | null>(null);

  const go = async (target?: string) => {
    try {
      const next = await call<FolderListing>(`folders${target ? `?path=${encodeURIComponent(target)}` : ''}`);
      setListing(next);
      setTyped(next.path);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => { void go(sourceFolder ?? undefined); }, []);

  const typedGo = (e: FormEvent) => {
    e.preventDefault();
    void go(typed);
  };

  const choose = async () => {
    if (!listing) return;
    try {
      await call('source-folder', { method: 'POST', body: { path: listing.path, create: !listing.exists } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div>
      <form onSubmit={typedGo} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input style={field} value={typed} onChange={e => setTyped(e.target.value)} aria-label="Folder path" spellCheck={false} autoFocus />
        <button type="submit" style={button}>Go</button>
      </form>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <button style={button} disabled={!listing?.parent} onClick={() => listing?.parent && go(listing.parent)}>Up</button>
        {listing?.drives && listing.drives.length > 0 && (
          <select
            style={{ ...field, width: 'auto' }}
            value=""
            aria-label="Drive"
            onChange={e => e.target.value && go(e.target.value)}
          >
            <option value="">Drive...</option>
            {listing.drives.map(drive => <option key={drive} value={drive}>{drive}</option>)}
          </select>
        )}
        {listing && !listing.exists && <span style={{ color: 'var(--warn)' }}>This folder does not exist yet.</span>}
      </div>

      <div style={{ border: '1px solid var(--bd-soft)', borderRadius: 3, height: 220, overflow: 'auto' }}>
        {listing?.folders.length === 0 && (
          <div style={{ padding: '6px 8px', color: 'var(--fg-muted)' }}>{listing.exists ? 'No folders here.' : ''}</div>
        )}
        {listing?.folders.map(name => (
          <button key={name} style={row} onClick={() => go(joinPath(listing.path, name))}>{name}</button>
        ))}
      </div>

      <ErrorLine text={error} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        {onCancel && <button style={button} onClick={onCancel}>Cancel</button>}
        <button style={primary} disabled={!listing} onClick={choose}>
          {listing && !listing.exists ? 'Create and use' : 'Use this folder'}
        </button>
      </div>
    </div>
  );
}
