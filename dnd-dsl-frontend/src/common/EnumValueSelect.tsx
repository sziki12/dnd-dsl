import { useContext, type ChangeEvent, type MouseEvent } from 'react';
import { DslContext } from '../contexts/DslContext';
import type { StatePathSegment } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import type { SerializedEnum, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

/**
 * A dropdown for an enum-typed `let`. Present only when the variable carries a
 * `: EnumName` annotation. Changing it issues an ASSIGN_VARIABLE command with the
 * value name as a plain string.
 */
export default function EnumValueSelect({ variable, owner, currentValue }: {
  variable: SerializedVariableDecl;
  owner: StatePathSegment;
  currentValue: unknown;
}) {
  const { getByReference, execute } = useContext(DslContext);

  if (!variable.enumType) return null;
  const enumDecl = getByReference<SerializedEnum>(variable.enumType);
  if (!enumDecl) return null;

  const stop = (e: MouseEvent) => e.stopPropagation();
  const onChange = (e: ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    execute({
      type: 'ASSIGN_VARIABLE',
      path: [owner, { kind: 'variable', target: variable.target ?? '' }],
      newValue: e.target.value,
    });
  };

  return (
    <select
      value={typeof currentValue === 'string' ? currentValue : ''}
      onClick={stop}
      onChange={onChange}
      style={{
        background: 'var(--bg-panel)',
        color: 'var(--fg-primary)',
        border: '1px solid var(--bd-soft)',
        borderRadius: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        padding: '0 4px',
      }}
    >
      {enumDecl.values.map(v => (
        <option key={v.name} value={v.name}>{v.name}</option>
      ))}
    </select>
  );
}
