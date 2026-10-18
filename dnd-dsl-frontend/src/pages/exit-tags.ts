// Styling exits by their tags - pure, no React/ReactFlow dependency.
//
// An exit can carry tags: `exit "Back Door" to "Alley" ["Hidden": true] ["Locked"]`. A tag rule says how
// an exit with that tag looks (colour, width, dash, opacity, a short suffix on its name). Rules combine field
// by field: a rule for one value beats a tag-wide rule, otherwise the rule created later wins; the suffixes
// of all matching rules are added up.

export interface ExitTag {
  tag: string;
  /** The tag's value as text ("true", "3", "gold"), when it has a simple one. */
  value?: string;
}

export interface TagStyle {
  color?: string;
  width?: number;
  dash?: boolean;
  opacity?: number;
  suffix?: string;
}

/** `value` unset means the rule applies to the tag whatever its value. */
export interface TagRule {
  tag: string;
  value?: string;
  style: TagStyle;
}

export interface ResolvedTagStyle {
  color?: string;
  width?: number;
  dash?: boolean;
  opacity?: number;
  /** The suffixes of every matching rule, in order. */
  suffix: string;
}

export const WIDTH_MIN = 1;
export const WIDTH_MAX = 6;
export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;
export const SUFFIX_MAX = 6;
export const MAX_RULES = 50;
const TEXT_MAX = 100;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The simple value of a serialized constant (a number, a boolean or a string), else undefined. */
export function constantValue(expr: unknown): string | number | boolean | undefined {
  if (typeof expr !== 'object' || expr === null) return undefined;
  const node = expr as { $type?: string; val?: unknown; isNegative?: boolean; isNegated?: boolean };
  switch (node.$type) {
    case 'IntVal': return typeof node.val === 'number' ? (node.isNegative ? -node.val : node.val) : undefined;
    case 'BoolVal': {
      const value = node.val === true || node.val === 'true';
      return node.isNegated ? !value : value;
    }
    case 'StringVal': return typeof node.val === 'string' ? node.val : undefined;
    default: return undefined;
  }
}

/** An exit's tags as plain `{ tag, value? }` pairs. A value that is not a simple constant is left out, the tag stays. */
export function exitTags(identifiers: ReadonlyArray<{ tag?: unknown; value?: unknown }> | undefined): ExitTag[] {
  const tags: ExitTag[] = [];
  for (const identifier of identifiers ?? []) {
    if (typeof identifier.tag !== 'string' || identifier.tag === '') continue;
    const value = constantValue(identifier.value);
    tags.push(value === undefined ? { tag: identifier.tag } : { tag: identifier.tag, value: String(value) });
  }
  return tags;
}

type WithExits = { exits?: ReadonlyArray<{ identifiers?: ReadonlyArray<{ tag?: unknown; value?: unknown }> }> };

/**
 * Every tag used by the exits the map shows (the location's own and its direct sublocations'), for the panel to list.
 * For each tag name there is an entry for the tag itself ("any value"), then one per distinct value seen with it.
 */
export function collectExitTags(location: (WithExits & { sublocations?: ReadonlyArray<WithExits> }) | undefined): ExitTag[] {
  if (!location) return [];
  const byTag = new Map<string, Set<string>>();
  for (const owner of [location, ...(location.sublocations ?? [])]) {
    for (const exit of owner.exits ?? []) {
      for (const { tag, value } of exitTags(exit.identifiers)) {
        const values = byTag.get(tag) ?? new Set<string>();
        if (value !== undefined) values.add(value);
        byTag.set(tag, values);
      }
    }
  }
  const entries: ExitTag[] = [];
  for (const tag of [...byTag.keys()].sort()) {
    entries.push({ tag });
    for (const value of [...byTag.get(tag)!].sort()) entries.push({ tag, value });
  }
  return entries;
}

export function ruleMatches(rule: TagRule, tags: ReadonlyArray<ExitTag>): boolean {
  return tags.some(t => t.tag === rule.tag && (rule.value === undefined || t.value === rule.value));
}

/**
 * How an exit with these tags looks. Matching rules apply tag-wide ones first, then value-specific ones (the more
 * specific wins), each group in list order, later fields replacing earlier ones; suffixes are joined in that order.
 */
export function resolveTagStyle(rules: ReadonlyArray<TagRule>, tags: ReadonlyArray<ExitTag>): ResolvedTagStyle {
  const resolved: ResolvedTagStyle = { suffix: '' };
  const ordered = [...rules.filter(r => r.value === undefined), ...rules.filter(r => r.value !== undefined)];
  for (const rule of ordered) {
    if (!ruleMatches(rule, tags)) continue;
    const { color, width, dash, opacity, suffix } = rule.style;
    if (color !== undefined) resolved.color = color;
    if (width !== undefined) resolved.width = width;
    if (dash !== undefined) resolved.dash = dash;
    if (opacity !== undefined) resolved.opacity = opacity;
    if (suffix) resolved.suffix += suffix;
  }
  return resolved;
}

export function findRule(rules: ReadonlyArray<TagRule>, tag: string, value?: string): TagRule | undefined {
  return rules.find(r => r.tag === tag && r.value === value);
}

const isEmptyStyle = (style: TagStyle) =>
  style.color === undefined && style.width === undefined && style.dash === undefined && style.opacity === undefined && !style.suffix;

/**
 * Changes some fields of the rule for `tag` (and `value`), creating it when it is new. A field set to undefined is
 * cleared, and a rule left with nothing in it is removed. New rules go to the end, so they win over older ones.
 */
export function setTagStyle(rules: ReadonlyArray<TagRule>, tag: string, value: string | undefined, patch: Partial<TagStyle>): TagRule[] {
  const existing = findRule(rules, tag, value);
  const style: TagStyle = { ...existing?.style };
  for (const [key, field] of Object.entries(patch)) {
    if (field === undefined || field === '') delete style[key as keyof TagStyle];
    else (style as Record<string, unknown>)[key] = field;
  }
  const others = rules.filter(r => r !== existing);
  if (isEmptyStyle(style)) return others;
  const rule: TagRule = value === undefined ? { tag, style } : { tag, value, style };
  // Keep an existing rule where it is; only a new one is appended.
  return existing ? rules.map(r => (r === existing ? rule : r)) : [...others, rule];
}

export function removeTagRule(rules: ReadonlyArray<TagRule>, tag: string, value?: string): TagRule[] {
  return rules.filter(r => !(r.tag === tag && r.value === value));
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const text = (value: unknown) => (typeof value === 'string' && value !== '' && value.length <= TEXT_MAX ? value : undefined);

function sanitizeStyle(raw: unknown): TagStyle {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const style: TagStyle = {};
  if (typeof r.color === 'string' && HEX.test(r.color)) style.color = r.color.toLowerCase();
  if (typeof r.width === 'number' && Number.isFinite(r.width)) style.width = clamp(r.width, WIDTH_MIN, WIDTH_MAX);
  if (typeof r.dash === 'boolean') style.dash = r.dash;
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) style.opacity = clamp(r.opacity, OPACITY_MIN, OPACITY_MAX);
  if (typeof r.suffix === 'string') {
    // Control characters would only garble the label; the length keeps the suffix a hint, not a sentence.
    const suffix = Array.from(r.suffix).filter(ch => ch.codePointAt(0)! > 0x1f && ch !== '\u007f').slice(0, SUFFIX_MAX).join('');
    if (suffix.trim() !== '') style.suffix = suffix;
  }
  return style;
}

/** Stored rules become valid ones: entries without a usable tag or with nothing to apply are dropped, values clamped. */
export function sanitizeTagRules(raw: unknown): TagRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: TagRule[] = [];
  for (const item of raw) {
    if (rules.length >= MAX_RULES) break;
    if (typeof item !== 'object' || item === null) continue;
    const entry = item as Record<string, unknown>;
    const tag = text(entry.tag);
    if (tag === undefined) continue;
    const style = sanitizeStyle(entry.style);
    if (isEmptyStyle(style)) continue;
    const value = text(entry.value);
    rules.push(value === undefined ? { tag, style } : { tag, value, style });
  }
  return rules;
}

/** The distinct colours the rules use, as lower-case hex without "#", for the arrowhead definitions. */
export function markerColors(rules: ReadonlyArray<TagRule>): string[] {
  return [...new Set(rules.flatMap(r => (r.style.color ? [r.style.color.slice(1).toLowerCase()] : [])))];
}

export const arrowMarkerId = (hex: string) => `map-arrow-${hex}`;
