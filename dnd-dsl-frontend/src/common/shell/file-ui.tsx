import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { BackendURL } from '../../contexts/BackendContext';

export type Adventure = { name: string; worlds: string[] };
export type NamedState = { name: string; savedAt: string };
export type FolderListing = { path: string; exists: boolean; parent: string | null; folders: string[]; drives?: string[] };

export async function call<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${BackendURL}/adventure/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `Request failed (${response.status})`);
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const panel: CSSProperties = {
  background: 'var(--bg-panel)', border: '1px solid var(--bd-strong)', borderRadius: 4,
  boxShadow: '0 6px 24px rgba(0,0,0,0.5)', color: 'var(--fg-primary)', fontFamily: 'var(--font-ui)', fontSize: 12,
};
export const field: CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--bd-soft)', borderRadius: 3, color: 'var(--fg-primary)',
  padding: '4px 8px', fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
export const button: CSSProperties = {
  background: 'transparent', border: '1px solid var(--bd-strong)', borderRadius: 3, color: 'inherit',
  cursor: 'pointer', padding: '4px 12px', fontSize: 12, fontFamily: 'inherit',
};
export const primary: CSSProperties = { ...button, background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--fg-bright)' };
export const row: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', padding: '4px 8px', cursor: 'pointer',
  background: 'transparent', border: 'none', color: 'inherit', fontSize: 12, fontFamily: 'inherit', textAlign: 'left',
};

export function Dialog({ title, onClose, width = 420, children }: { title: string; onClose: () => void; width?: number; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 80 }}
    >
      <div role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()} style={{ ...panel, width, maxWidth: '90vw', padding: 16 }}>
        <div style={{ fontWeight: 600, color: 'var(--fg-bright)', marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export const ErrorLine = ({ text }: { text: string | null }) =>
  text ? <div style={{ color: 'var(--error)', margin: '8px 0', whiteSpace: 'pre-wrap' }}>{text}</div> : null;

export const Hint = ({ children }: { children: ReactNode }) => <div style={{ color: 'var(--fg-secondary)', marginBottom: 10 }}>{children}</div>;
