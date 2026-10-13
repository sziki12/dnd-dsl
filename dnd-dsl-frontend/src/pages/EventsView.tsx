import { Fragment, useContext } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext';
import EntityLink from '../common/EntityLink';
import { triggeredEventNames } from '@dnd-language/evaluation/dnd-dsl-world-graph.js';
import type { SerializedEvent } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

const PAGE_STYLE = { height: '100%', overflow: 'auto', background: 'var(--bg-editor)', color: 'var(--fg-primary)' } as const;

function EventList() {
  const { worldState } = useContext(DslContext);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';

  const events: SerializedEvent[] = worldState?.World?.events ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? events.filter(e => e.name.toLowerCase().includes(needle) || (e.description ?? '').toLowerCase().includes(needle))
    : events;

  return (
    <div style={PAGE_STYLE}>
      <div className="pane-hd">
        <div className="pane-tabs">
          <span className="pane-tab active">Events<span className="cnt">{needle ? `${shown.length}/${events.length}` : events.length}</span></span>
        </div>
        <input
          className="filter-input"
          type="search"
          placeholder="Filter by name or description"
          value={query}
          // `replace` keeps typing out of the history, so Back leaves the page instead of undoing keystrokes.
          onChange={e => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
        />
      </div>

      {!worldState && <div className="npc-stub">No world loaded.</div>}
      {worldState && events.length === 0 && <div className="npc-stub">No events declared in this world.</div>}
      {worldState && events.length > 0 && shown.length === 0 && <div className="npc-stub">No event matches "{query}".</div>}

      {shown.map(event => (
        <div key={event.name} className="event-row">
          <EntityLink kind="event" name={event.name} />
          {event.description && <span className="desc">{event.description}</span>}
        </div>
      ))}
    </div>
  );
}

function EventDetail({ name }: { name: string }) {
  const { worldState } = useContext(DslContext);
  const event = worldState?.World?.events.find(e => e.name === name);
  const triggers = worldState && event ? triggeredEventNames(worldState, event) : [];

  return (
    <div style={PAGE_STYLE}>
      <div className="pane-hd">
        <div className="pane-tabs"><span className="pane-tab active">Event</span></div>
        <Link className="entity-link back-link" to="/events">&larr; All events</Link>
      </div>

      {!worldState && <div className="npc-stub">No world loaded.</div>}
      {worldState && !event && <div className="npc-stub">No event named "{name}" in this world.</div>}

      {event && (
        <>
          <div className="var-banner"><h1>{event.name}</h1></div>
          {event.description && (
            <div className="detail-section"><h2>Description</h2>{event.description}</div>
          )}
          <div className="detail-section">
            <h2>Triggers</h2>
            {triggers.length === 0
              ? <span className="none">Triggers no other events.</span>
              : triggers.map((trigger, i) => (
                  <Fragment key={trigger}>
                    {i > 0 && ', '}
                    <EntityLink kind="event" name={trigger} />
                  </Fragment>
                ))}
          </div>
        </>
      )}
    </div>
  );
}

/** `/events` is the filterable list, `/events/:eventName` one event. */
export default function EventsView() {
  const { eventName } = useParams();
  return eventName === undefined ? <EventList /> : <EventDetail name={eventName} />;
}
