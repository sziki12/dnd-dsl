import { describe, expect, test } from 'vitest';
import { KIND_COLORS, kindTokenRules, withKindScopes, type Kind } from './kind-colors';

const base = {
  name: 'dnd-dsl',
  patterns: [
    { include: '#comments' },
    { name: 'keyword.control.dnd-dsl', match: '\\b(location|npc)\\b' },
    { name: 'string.quoted.double.dnd-dsl', begin: '"', end: '"' },
  ],
};

/** The scope the first matching rule gives the name, like the TextMate engine would pick it. */
function nameScope(line: string): { scope?: string; text?: string } {
  for (const p of withKindScopes(base).patterns) {
    if (typeof p.match !== 'string' || !p.captures) continue;
    const m = new RegExp(p.match).exec(line);
    if (!m) continue;
    const captures = p.captures as Record<number, { name?: string }>;
    const named = Object.keys(captures).map(Number).filter(i => captures[i].name?.startsWith('entity.name'));
    const last = Math.max(...named);
    return { scope: captures[last].name, text: m[last] };
  }
  return {};
}

/** Every coloured name on the line, in order, including the ones inside a `->` step. */
function allNames(line: string): [string, string][] {
  for (const p of withKindScopes(base).patterns) {
    if (typeof p.match !== 'string' || !p.captures) continue;
    const m = new RegExp(p.match).exec(line);
    if (!m) continue;
    const found: [string, string][] = [];
    const captures = p.captures as Record<number, { name?: string; patterns?: { name: string; match: string }[] }>;
    for (const [index, capture] of Object.entries(captures)) {
      const text = m[Number(index)];
      if (capture.name?.startsWith('entity.name')) found.push([text, capture.name]);
      for (const nested of capture.patterns ?? []) {
        if (!nested.name.startsWith('entity.name')) continue;
        for (const hit of (text ?? '').matchAll(new RegExp(nested.match, 'g'))) found.push([hit[0], nested.name]);
      }
    }
    return found;
  }
  return [];
}

describe('withKindScopes', () => {
  test('the name after a -> step is the child kind', () => {
    expect(allNames('on change quest "Rising Dead" -> "Geather Bone Fragments" . Status to "Completed"')).toEqual([
      ['"Rising Dead"', 'entity.name.quest.dnd-dsl'],
      ['"Geather Bone Fragments"', 'entity.name.objective.dnd-dsl'],
    ]);
    expect(allNames('location "A" -> "B" -> \'C\'')).toEqual([
      ['"A"', 'entity.name.location.dnd-dsl'],
      ['"B"', 'entity.name.location.dnd-dsl'],
      ["'C'", 'entity.name.location.dnd-dsl'],
    ]);
    expect(allNames('quest "Q" . objectives "O"')).toEqual([
      ['"Q"', 'entity.name.quest.dnd-dsl'],
      ['"O"', 'entity.name.objective.dnd-dsl'],
    ]);
  });

  test('an exit colours its target as a location and leaves its label a string', () => {
    expect(allNames('exit "Door" to "Hall"')).toEqual([['"Hall"', 'entity.name.location.dnd-dsl']]);
    const exit = withKindScopes(base).patterns.find(p => typeof p.match === 'string' && p.match.startsWith('\\b(exit)'));
    expect((exit?.captures as Record<number, { name: string }>)[2].name).toBe('string.quoted.dnd-dsl');
  });

  test('a string after the steps is not coloured', () => {
    expect(allNames('quest "Q" -> "O" . Status to "Done"')).toHaveLength(2);
    expect(allNames('location "A" . Gold to "x"')).toHaveLength(1);
  });

  test('puts the kind rules after the includes and before the keyword and string rules', () => {
    const patterns = withKindScopes(base).patterns;
    expect(patterns[0]).toEqual({ include: '#comments' });
    expect(patterns[1].match).toContain('location');
    expect(patterns.at(-1)).toEqual(base.patterns.at(-1));
    expect(patterns).toHaveLength(base.patterns.length + 12);
  });

  test('does not change the grammar it was given', () => {
    const before = JSON.stringify(base);
    withKindScopes(base);
    expect(JSON.stringify(base)).toBe(before);
  });

  test.each<[Kind, string, string]>([
    ['location', 'location "Tavern"', '"Tavern"'],
    ['npc', "npc 'Grim'", "'Grim'"],
    ['faction', 'faction "Guards"', '"Guards"'],
    ['party', 'party "Heroes"', '"Heroes"'],
    ['quest', 'quest "Q1"', '"Q1"'],
    ['objective', 'objective "O1"', '"O1"'],
    ['event', 'event "Storm"', '"Storm"'],
    ['event', 'trigger "The Beginning"', '"The Beginning"'],
    ['location', 'entry "Hall"', '"Hall"'],
    ['location', "exit 'Door' to 'Hall'", "'Hall'"],
    ['event', 'when event triggered "Storm"', '"Storm"'],
    ['function', 'function reward', 'reward'],
    ['state', 'state Mood {', 'Mood'],
  ])('%s gets its own scope', (kind, line, name) => {
    expect(nameScope(line)).toEqual({ scope: `entity.name.${kind}.dnd-dsl`, text: name });
  });

  test('an escaped quote stays inside the name', () => {
    expect(nameScope('npc "Say \\"hi\\""').text).toBe('"Say \\"hi\\""');
  });

  test('quest status expressions colour the quest name', () => {
    expect(nameScope('when quest completed "Q1"')).toEqual({ scope: 'entity.name.quest.dnd-dsl', text: '"Q1"' });
    expect(nameScope('objective failed "O1"')).toEqual({ scope: 'entity.name.objective.dnd-dsl', text: '"O1"' });
  });

  test('plain strings, plural keywords and unrelated lines are left alone', () => {
    expect(nameScope('print "location"')).toEqual({});
    expect(nameScope('world . npcs "x"')).toEqual({});
    expect(nameScope('let location_name = "x"')).toEqual({});
    expect(nameScope('description "a quest"')).toEqual({});
  });
});

describe('kindTokenRules', () => {
  test('has one rule per kind with its colour', () => {
    const rules = kindTokenRules();
    expect(rules).toHaveLength(Object.keys(KIND_COLORS).length);
    expect(rules.find(r => r.scope === 'entity.name.npc.dnd-dsl')?.settings.foreground).toBe(KIND_COLORS.npc);
  });
});
