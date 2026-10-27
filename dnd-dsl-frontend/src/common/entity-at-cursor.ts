export type EntityKind = 'location' | 'npc' | 'quest' | 'objective' | 'event';

export type EntityRef = {
  kind: EntityKind;
  name: string;
  /** The quest an objective belongs to. */
  questName?: string;
};

/** The names a world declares, to tell a real entity name from any other string. */
export type EntityNames = {
  location: ReadonlySet<string>;
  npc: ReadonlySet<string>;
  quest: ReadonlySet<string>;
  event: ReadonlySet<string>;
  /** Objective name to the quest that owns it (objective names are unique across the world). */
  objective: ReadonlyMap<string, string>;
};

type NamedLocation = { name: string; sublocations?: NamedLocation[] };

/** The part of the served world this needs, so it can be fed a serialized world or a plain object. */
export type NamedWorld = {
  World?: {
    locations?: NamedLocation[];
    npcs?: { name: string }[];
    quests?: { name: string; objectives?: { name: string }[] }[];
    events?: { name: string }[];
  };
};

const KINDS: EntityKind[] = ['location', 'npc', 'quest', 'objective', 'event'];

/** The word before a string that says what the string names. */
const HINTS: Record<string, EntityKind> = {
  location: 'location', locations: 'location', sublocations: 'location', to: 'location', entry: 'location',
  npc: 'npc', npcs: 'npc',
  quest: 'quest', quests: 'quest',
  objective: 'objective', objectives: 'objective',
  event: 'event', events: 'event', trigger: 'event',
};

/** `quest completed "A"`: the word before the string is the status, the one before it says what it names. */
const STATUS_WORDS = new Set(['completed', 'failed', 'accepted']);

/** After `->` the string names the same kind as the last entity word before the chain. */
const CHAIN_HEADS: Record<string, EntityKind> = { location: 'location', quest: 'objective' };

export function collectEntityNames(world: NamedWorld | undefined): EntityNames {
  const location = new Set<string>();
  const addLocations = (locations: NamedLocation[] | undefined) => {
    for (const item of locations ?? []) {
      location.add(item.name);
      addLocations(item.sublocations);
    }
  };
  addLocations(world?.World?.locations);

  const objective = new Map<string, string>();
  for (const quest of world?.World?.quests ?? []) {
    for (const item of quest.objectives ?? []) objective.set(item.name, quest.name);
  }

  return {
    location,
    npc: new Set((world?.World?.npcs ?? []).map(item => item.name)),
    quest: new Set((world?.World?.quests ?? []).map(item => item.name)),
    event: new Set((world?.World?.events ?? []).map(item => item.name)),
    objective,
  };
}

type StringAtCursor = { value: string; before: string };

/** The string literal the caret (a 1-based Monaco column) is in or right after, with the text before it. */
export function stringAt(line: string, column: number): StringAtCursor | undefined {
  const caret = column - 1;
  for (const match of line.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (caret >= start && caret <= end) {
      return { value: (match[1] ?? match[2]).replace(/\\(.)/g, '$1'), before: line.slice(0, start) };
    }
  }
  return undefined;
}

function hintFor(before: string): EntityKind | undefined {
  const words = before.match(/[A-Za-z_]+|->/g) ?? [];
  let last = words.length - 1;
  if (words[last] === '->') {
    for (let i = last - 1; i >= 0; i--) {
      if (words[i] in CHAIN_HEADS) return CHAIN_HEADS[words[i]];
    }
    return undefined;
  }
  if (STATUS_WORDS.has(words[last])) last--;
  return HINTS[words[last]];
}

function declares(names: EntityNames, kind: EntityKind, name: string): boolean {
  return kind === 'objective' ? names.objective.has(name) : names[kind].has(name);
}

function refOf(names: EntityNames, kind: EntityKind, name: string): EntityRef {
  return kind === 'objective' ? { kind, name, questName: names.objective.get(name) } : { kind, name };
}

/**
 * The declared entity the caret is on. A keyword before the string says which kind it names
 * (`location "A"`, `exit "x" to "A"`, `trigger "E"`), and a name of another kind or an unknown name
 * gives nothing. With no such keyword the name must belong to exactly one kind, so a description
 * that happens to repeat a name is not taken for it.
 */
export function entityAt(line: string, column: number, names: EntityNames): EntityRef | undefined {
  const found = stringAt(line, column);
  if (!found) return undefined;

  const hinted = hintFor(found.before);
  if (hinted) return declares(names, hinted, found.value) ? refOf(names, hinted, found.value) : undefined;

  if (/\bdescription\s*$/.test(found.before)) return undefined;
  const matches = KINDS.filter(kind => declares(names, kind, found.value));
  return matches.length === 1 ? refOf(names, matches[0], found.value) : undefined;
}

/** The page that shows the entity. NPCs have one list page, an objective lives on its quest's page. */
export function entityRoute(ref: EntityRef): string {
  const name = encodeURIComponent(ref.name);
  switch (ref.kind) {
    case 'location': return `/location/${name}`;
    case 'quest': return `/quests/${name}`;
    case 'objective': return `/quests/${encodeURIComponent(ref.questName ?? ref.name)}`;
    case 'event': return `/events/${name}`;
    case 'npc': return '/npcs';
  }
}
