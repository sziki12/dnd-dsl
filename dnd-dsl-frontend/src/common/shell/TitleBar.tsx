import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { DslContext } from '../../contexts/DslContext';

const MENU_ITEMS = ['File', 'Edit', 'View', 'Help'];

export default function TitleBar({ pageName }: { pageName: string }) {
  const { adventure, world } = useContext(DslContext);
  const { locationName } = useParams();

  return (
    <div className="shell-titlebar" title={pageName}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontWeight: 600, color: 'var(--fg-bright)' }}>DnD DSL</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {MENU_ITEMS.map((m) => (
            <span key={m} style={{ padding: '3px 8px', borderRadius: 3 }}>{m}</span>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'center' }}>
        <span>{adventure}</span>
        <span style={{ color: 'var(--fg-muted)' }}>&rsaquo;</span>
        <span>{world}</span>
        {locationName && (
          <>
            <span style={{ color: 'var(--fg-muted)' }}>&rsaquo;</span>
            <span style={{ color: 'var(--fg-primary)' }}>{locationName}</span>
          </>
        )}
      </div>
      <div />
    </div>
  );
}
