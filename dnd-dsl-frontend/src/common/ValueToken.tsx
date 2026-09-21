import { inferKind, isObjectResult, type EvalResult } from './expression-evaluator';

const MAX_LIST_ITEMS = 6;
const MAX_OBJECT_FIELDS = 3;

/** The one renderer for an evaluated value, shared by every entity view. Lists show their
 *  first few items and a `+N` for the rest; a record inside a list is shown compactly. */
export function renderValueToken(value: EvalResult | null | undefined) {
  if (value === null || value === undefined) return <span className="tok-comment italic">?</span>;

  if (Array.isArray(value)) {
    const shown = value.slice(0, MAX_LIST_ITEMS);
    return (
      <span>
        <span className="tok-operator">[</span>
        {shown.map((item, i) => (
          <span key={i}>
            {i > 0 && <span className="tok-operator">, </span>}
            {renderValueToken(item)}
          </span>
        ))}
        {value.length > MAX_LIST_ITEMS && <span className="tok-comment"> +{value.length - MAX_LIST_ITEMS}</span>}
        <span className="tok-operator">]</span>
      </span>
    );
  }

  if (isObjectResult(value)) {
    const fields = Object.entries(value.staticProperties);
    const shown = fields.slice(0, MAX_OBJECT_FIELDS);
    return (
      <span>
        <span className="tok-operator">{'{ '}</span>
        {shown.map(([name, fieldValue], i) => (
          <span key={name}>
            {i > 0 && <span className="tok-operator">, </span>}
            <span className="tok-variable">{name}</span>
            <span className="tok-operator">: </span>
            {renderValueToken(fieldValue)}
          </span>
        ))}
        {fields.length > MAX_OBJECT_FIELDS && <span className="tok-comment"> +{fields.length - MAX_OBJECT_FIELDS}</span>}
        <span className="tok-operator">{' }'}</span>
      </span>
    );
  }

  const kind = inferKind(value);
  if (kind === 'string') return <span className="tok-string">"{value as string}"</span>;
  if (kind === 'int') return <span className="tok-number">{value as number}</span>;
  if (kind === 'bool') return <span className="tok-keyword">{String(value)}</span>;
  return <span className="tok-operator">{String(value)}</span>;
}
