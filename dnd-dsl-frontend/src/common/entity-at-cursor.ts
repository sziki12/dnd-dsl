import { locationRoute } from './location-identity';

export type EntityKind = 'location' | 'npc' | 'faction' | 'quest' | 'objective' | 'event';

export type EntityRef = {
  kind: EntityKind;
  name: string;
  /** The quest an objective belongs to. */
  questName?: string;
  /** The names that lead to a location, when the line writes them (`location "A" -> "B"`): the name alone may be shared. */
  path?: string[];
};

/** The names a world declares, to tell a real entity name from any other string. */
export type EntityNames = {
  location: ReadonlySet<string>;
  npc: ReadonlySet<string>;
  faction: ReadonlySet<string>;
  quest: ReadonlySet<string>;
  event: ReadonlySet<string>;
  /** Objective name to the quests that have one: more than one when quests reuse a name. */
  objective: ReadonlyMap<string, readonly string[]>;
};

type NamedLocation = { name: string; sublocations?: NamedLocation[] };

/** The part of the served world this needs, so it can be fed a serialized world or a plain object. */
export type NamedWorld = {
  World?: {
    locations?: NamedLocation[];
    npcs?: { name: string }[];
    factions?: { name: string }[];
    quests?: { name: string; objectives?: { name: string }[] }[];
    events?: { name: string }[];
  };
};

const KINDS: EntityKind[] = ['location', 'npc', 'faction', 'quest', 'objective', 'event'];

/** The word before a string that says what the string names. */
const HINTS: Record<string, EntityKind> = {
  location: 'location', locations: 'location', sublocations: 'location', to: 'location', entry: 'location',
  npc: 'npc', npcs: 'npc',
  faction: 'faction', factions: 'faction',
  quest: 'quest', quests: 'quest',
  objective: 'objective', objectives: 'objective',
  event: 'event', events: 'event', trigger: 'event',
};

/** `quest completed "A"`: the word before the string is the status, the one before it says what it names. */
const STATUS_WORDS = new Set(['completed', 'failed', 'accepted']);

/** After `->` the string names the same kind as the last entity word before the chain. */
const CHAIN_HEADS: Record<string, EntityKind> = { location: 'location', to: 'location', quest: 'objective' };

export function collectEntityNames(world: NamedWorld | undefined): EntityNames {
  const location = new Set<string>();
  const addLocations = (locations: NamedLocation[] | undefined) => {
    for (const item of locations ?? []) {
      location.add(item.name);
      addLocations(item.sublocations);
    }
  };
  addLocations(world?.World?.locations);

  const objective = new Map<string, string[]>();
  for (const quest of world?.World?.quests ?? []) {
    for (const item of quest.objectives ?? []) objective.set(item.name, [...(objective.get(item.name) ?? []), quest.name]);
  }

  return {
    location,
    npc: new Set((world?.World?.npcs ?? []).map(item => item.name)),
    faction: new Set((world?.World?.factions ?? []).map(item => item.name)),
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
  // The words inside an earlier string are a name, not a keyword: `quest "Escape to Freedom" ->` is not an exit target.
  const words = before.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').match(/[A-Za-z_]+|->/g) ?? [];
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

/** A string literal in either quote style, as the grammar accepts both. */
const QUOTED = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;

/** The quest in `quest "Q" ->` / `quest "Q" . objectives` right before the string, if that is what precedes it. */
const QUEST_QUALIFIER = new RegExp(String.raw`\bquest\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*(?:->|\.\s*objectives)\s*$`);

/**
 * An objective is told apart from others of its name by the quest written in front of it, else by the quest the caret
 * is in (inside a quest a bare name is its own), else by being the only one. Otherwise there is no telling which.
 */
function objectiveRef(names: EntityNames, name: string, before: string, enclosingQuest: string | undefined): EntityRef | undefined {
  const quests = names.objective.get(name) ?? [];
  const qualifier = QUEST_QUALIFIER.exec(before);
  const written = (qualifier?.[1] ?? qualifier?.[2])?.replace(/\\(.)/g, '$1');
  let questName: string | undefined;
  if (written !== undefined) questName = quests.includes(written) ? written : undefined;
  else if (enclosingQuest !== undefined && quests.includes(enclosingQuest)) questName = enclosingQuest;
  else if (quests.length === 1) questName = quests[0];
  return questName === undefined ? undefined : { kind: 'objective', name, questName };
}

/** The names written before a location's own, in `location "A" -> "B" ->` / `exit "x" to "A" . sublocations "B"`. */
const LOCATION_QUALIFIER = new RegExp(String.raw`\b(?:location|to)\s+((?:${QUOTED}\s*(?:->|\.\s*sublocations)\s*)+)$`);

function locationRef(name: string, before: string): EntityRef {
  const written = LOCATION_QUALIFIER.exec(before)?.[1];
  if (written === undefined) return { kind: 'location', name };
  const earlier = Array.from(written.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g), match => (match[1] ?? match[2]).replace(/\\(.)/g, '$1'));
  return { kind: 'location', name, path: [...earlier, name] };
}

function refOf(names: EntityNames, kind: EntityKind, name: string, before: string, enclosingQuest: string | undefined): EntityRef | undefined {
  if (kind === 'objective') return objectiveRef(names, name, before, enclosingQuest);
  return kind === 'location' ? locationRef(name, before) : { kind, name };
}

/**
 * The name of the quest declared above `lineNumber` (1-based, the line itself included), for a caret on an objective
 * inside it. A quest is declared on a line of its own: `quest "Name"`.
 */
export function enclosingQuestAt(lineAt: (lineNumber: number) => string, lineNumber: number): string | undefined {
  for (let n = lineNumber; n >= 1; n--) {
    const match = /^\s*quest\s+"((?:\\.|[^"\\])*)"\s*$/.exec(lineAt(n));
    if (match) return match[1].replace(/\\(.)/g, '$1');
  }
  return undefined;
}

/**
 * The declared entity the caret is on. A keyword before the string says which kind it names
 * (`location "A"`, `exit "x" to "A"`, `trigger "E"`), and a name of another kind or an unknown name
 * gives nothing. With no such keyword the name must belong to exactly one kind, so a description
 * that happens to repeat a name is not taken for it. `enclosingQuest` is the quest the line sits in (see
 * `enclosingQuestAt`), which settles an objective name that several quests use.
 */
export function entityAt(line: string, column: number, names: EntityNames, enclosingQuest?: string): EntityRef | undefined {
  const found = stringAt(line, column);
  if (!found) return undefined;

  const hinted = hintFor(found.before);
  if (hinted) return declares(names, hinted, found.value) ? refOf(names, hinted, found.value, found.before, enclosingQuest) : undefined;

  if (/\bdescription\s*$/.test(found.before)) return undefined;
  const matches = KINDS.filter(kind => declares(names, kind, found.value));
  return matches.length === 1 ? refOf(names, matches[0], found.value, found.before, enclosingQuest) : undefined;
}

/** The page that shows the entity. NPCs and factions have one list page each, an objective lives on its quest's page. */
export function entityRoute(ref: EntityRef): string {
  const name = encodeURIComponent(ref.name);
  switch (ref.kind) {
    case 'location': return locationRoute(ref.path ?? [ref.name]);
    case 'quest': return `/quests/${name}`;
    case 'objective': return `/quests/${encodeURIComponent(ref.questName ?? ref.name)}`;
    case 'event': return `/events/${name}`;
    case 'npc': return '/npcs';
    case 'faction': return '/factions';
  }
}
