type Segment = { kind: string; name?: string; target?: string; questName?: string };

/**
 * An `encodeStatePath` key as the DSL would write it: `location "Dungeon 1" -> "Entrance" . Torches`. A sublocation is a
 * run of location segments, so the names after the first are joined with `->`; an objective names its quest, since
 * objectives of different quests may share a name.
 */
export function statePathText(encoded: string): string {
  try {
    const segments = JSON.parse(encoded) as Segment[];
    return segments
      .map((segment, index) => {
        switch (segment.kind) {
          case 'variable': return `. ${segment.target}`;
          case 'world': return 'world';
          case 'location': return segments[index - 1]?.kind === 'location' ? `-> "${segment.name}"` : `location "${segment.name}"`;
          case 'objective': return segment.questName === undefined ? `objective "${segment.name}"` : `quest "${segment.questName}" -> "${segment.name}"`;
          default: return `${segment.kind} "${segment.name}"`;
        }
      })
      .join(' ');
  } catch {
    return encoded;
  }
}
