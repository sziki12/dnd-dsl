import type { ChangeEvent, MouseEvent } from 'react';
import type { EditorType } from './value-conversion';

const LABELS: Record<Exclude<EditorType, 'state'>, string> = {
  text: 'text',
  number: 'number',
  boolean: 'bool',
  list: 'list',
};

/**
 * The inferred type of a value, as a dropdown. Choosing another type is how the DM changes a
 * dynamically typed variable: the caller converts the value and writes it.
 * `stateName` adds the declared state as an option and is passed only when the declaration has one.
 */
export default function TypeSelect({ type, stateName, onChange }: {
  type: EditorType | undefined;
  stateName?: string;
  onChange: (to: EditorType) => void;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  const handle = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    onChange(e.target.value as EditorType);
  };

  return (
    <select
      className="tok-keyword"
      value={type ?? ''}
      onClick={stop}
      onChange={handle}
      style={{
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        padding: '0 2px',
        cursor: 'pointer',
      }}
    >
      {type === undefined && <option value="" disabled>?</option>}
      {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map(key => (
        <option key={key} value={key}>{LABELS[key]}</option>
      ))}
      {stateName && <option value="state">{stateName}</option>}
    </select>
  );
}
