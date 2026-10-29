export type EditorType = 'text' | 'number' | 'boolean' | 'list' | 'state';

/** A value the overlay can hold: JSON-safe, with no null and no object. */
export type Storable = number | string | boolean | Storable[];

export function isStorable(value: unknown): value is Storable {
  switch (typeof value) {
    case 'number': return Number.isFinite(value);
    case 'string':
    case 'boolean': return true;
    case 'object': return Array.isArray(value) && value.every(isStorable);
    default: return false;
  }
}

/** `stateMembers` is the declared state's member names, passed only when the declaration has one. */
export function editorTypeOf(value: unknown, stateMembers?: readonly string[]): EditorType | undefined {
  if (typeof value === 'string') return stateMembers?.includes(value) ? 'state' : 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  return undefined;
}

export function defaultValue(type: EditorType, stateMembers?: readonly string[]): Storable {
  switch (type) {
    case 'text': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'list': return [];
    case 'state': return stateMembers?.[0] ?? '';
  }
}

export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

type Scalar = number | string | boolean;

/** The value itself, or the first item of a list (looking through nested lists). */
function scalarOf(value: unknown): Scalar | undefined {
  let current = value;
  while (Array.isArray(current)) current = current[0];
  return typeof current === 'number' || typeof current === 'string' || typeof current === 'boolean' ? current : undefined;
}

export function convertValue(value: unknown, to: EditorType, stateMembers?: readonly string[]): Storable {
  if (editorTypeOf(value, stateMembers) === to && isStorable(value)) return value;

  const scalar = scalarOf(value);
  switch (to) {
    case 'text':
      return scalar === undefined ? '' : String(scalar);
    case 'number':
      if (typeof scalar === 'number') return scalar;
      if (typeof scalar === 'boolean') return scalar ? 1 : 0;
      return typeof scalar === 'string' ? parseNumber(scalar) ?? 0 : 0;
    case 'boolean':
      if (typeof scalar === 'boolean') return scalar;
      if (typeof scalar === 'number') return scalar !== 0;
      return typeof scalar === 'string' && scalar.trim().toLowerCase() === 'true';
    case 'list':
      return scalar === undefined ? [] : [scalar];
    case 'state':
      return typeof scalar === 'string' && stateMembers?.includes(scalar) ? scalar : defaultValue('state', stateMembers);
  }
}

/** The list with every item storable, or undefined when an item (a record) cannot be stored.
 *  An item that could not be evaluated becomes an empty string so no null reaches the overlay. */
export function sanitizeList(items: readonly unknown[]): Storable[] | undefined {
  const clean: Storable[] = [];
  for (const item of items) {
    if (item === undefined) clean.push('');
    else if (Array.isArray(item)) {
      const nested = sanitizeList(item);
      if (!nested) return undefined;
      clean.push(nested);
    } else if (isStorable(item)) clean.push(item);
    else return undefined;
  }
  return clean;
}

/** What `+` appends: the same type as the last item, a declared state's first member, or empty text. */
export function newListItem(items: readonly Storable[], stateMembers?: readonly string[]): Storable {
  const last = items[items.length - 1];
  const type = editorTypeOf(last, stateMembers);
  if (type) return defaultValue(type, stateMembers);
  return stateMembers?.length ? defaultValue('state', stateMembers) : '';
}

export function replaceAt(items: readonly Storable[], index: number, value: Storable): Storable[] {
  return items.map((item, i) => (i === index ? value : item));
}

export function removeAt(items: readonly Storable[], index: number): Storable[] {
  return items.filter((_, i) => i !== index);
}
