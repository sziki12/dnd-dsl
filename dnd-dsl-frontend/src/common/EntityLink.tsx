import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const SECTION = { event: 'events', quest: 'quests' } as const;

/** A link to an event's or quest's own page. Shows the name unless given other children. */
export default function EntityLink({ kind, name, children }: {
  kind: keyof typeof SECTION;
  name: string;
  children?: ReactNode;
}) {
  return (
    <Link className="entity-link" to={`/${SECTION[kind]}/${encodeURIComponent(name)}`}>
      {children ?? name}
    </Link>
  );
}
