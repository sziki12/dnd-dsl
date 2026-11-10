import { useContext, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { DslContext } from '../../contexts/DslContext';
import { useLocationRoute } from '../useLocationIndex';

const MENU_ITEMS = ['File', 'Edit', 'View', 'Help'];

/** The current view's display name - what the tab strip used to show per-tab,
 *  now driving the browser tab title instead since there is no tab strip anymore. */
function useViewName(): string {
  const { pathname } = useLocation();
  const { questName, eventName } = useParams();
  const locationNames = useLocationRoute();
  const { worldState } = useContext(DslContext);

  if (pathname === '/') return 'Home';
  if (pathname.startsWith('/location/')) return locationNames?.join(' \u203a ') ?? worldState?.World?.locations[0]?.name ?? 'Location';
  if (pathname === '/map') return 'World map';
  if (pathname === '/npcs') return 'NPCs';
  if (pathname === '/factions') return 'Factions';
  if (pathname === '/quests') return 'Quests';
  if (pathname.startsWith('/quests/')) return questName ?? 'Quest';
  if (pathname === '/events') return 'Events';
  if (pathname.startsWith('/events/')) return eventName ?? 'Event';
  if (pathname === '/script') return 'Script';
  if (pathname === '/editor') return 'Editor';
  return 'DnD DSL';
}

export default function TitleBar() {
  const { adventure, world } = useContext(DslContext);
  const { questName, eventName } = useParams();
  const locationNames = useLocationRoute();
  const entityName = locationNames?.join(' \u203a ') ?? questName ?? eventName;
  const viewName = useViewName();

  useEffect(() => {
    document.title = `${viewName} - DnD DSL`;
  }, [viewName]);

  return (
    <div className="shell-titlebar" title={viewName}>
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
        {entityName && (
          <>
            <span style={{ color: 'var(--fg-muted)' }}>&rsaquo;</span>
            <span style={{ color: 'var(--fg-primary)' }}>{entityName}</span>
          </>
        )}
      </div>
      <div />
    </div>
  );
}
