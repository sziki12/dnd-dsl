import { useContext, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { DslContext } from '../contexts/DslContext';
import { evaluateExpression, isObjectResult, type EvalResult } from './expression-evaluator';
import { renderValueToken } from './ValueToken';
import TypeSelect from './TypeSelect';
import {
  convertValue,
  editorTypeOf,
  newListItem,
  parseNumber,
  removeAt,
  replaceAt,
  sanitizeList,
  type EditorType,
  type Storable,
} from './value-conversion';
import { STATUS_VARIABLE } from '@dnd-language/evaluation/dnd-dsl-status.js';
import type { StatePath } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import type { SerializedEnum, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

const stop = (e: MouseEvent) => e.stopPropagation();

const inputStyle: CSSProperties = {
  background: 'var(--bg-panel)',
  color: 'var(--fg-primary)',
  border: '1px solid var(--bd-soft)',
  borderRadius: 3,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  padding: '0 4px',
};

const buttonStyle: CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  lineHeight: 1.3,
};

/** Lets a view highlight a clicked row and show a detail panel for it. */
export type RowSelection = {
  selected: string | null;
  toggle: (key: string, decl: Pick<SerializedVariableDecl, 'target' | 'isComputed'>) => void;
};

type EnumInfo = { name?: string; members?: readonly string[] };

type ObjectBody = { $type?: string; exp?: unknown; variables?: SerializedVariableDecl[] };

/** The `object ... end` block a variable's value is, looking through the Expression wrappers; undefined for
 *  an object that comes from a reference, which cannot be edited leaf by leaf. */
function objectVariables(expr: unknown): SerializedVariableDecl[] | undefined {
  let node = expr as ObjectBody | undefined;
  while (node && typeof node === 'object' && node.$type === 'Expression') node = node.exp as ObjectBody | undefined;
  return node?.$type === 'ObjectDeclaration' ? node.variables : undefined;
}

/**
 * One `let` as an editable row. The type is inferred from the evaluated value and shown as a dropdown;
 * the input follows it. A change is one ASSIGN_VARIABLE (a whole list is sent as one array).
 * Computed variables and quest/objective Status stay read-only. An object shows its variables
 * as nested rows, because only leaves can be written.
 */
export default function VariableEditor({ variable, owner, index, depth = 0, selection }: {
  variable: SerializedVariableDecl;
  /** Path of the container the variable sits in: the entity, plus one variable segment per enclosing object. */
  owner: StatePath;
  index?: number;
  depth?: number;
  selection?: RowSelection;
}) {
  const { worldState, execute, getByReference } = useContext(DslContext);

  const name = variable.target ?? '';
  const path: StatePath = [...owner, { kind: 'variable', target: name }];
  const value = evaluateExpression(variable.value, { variableName: name, worldState });
  const indent: CSSProperties = { paddingLeft: depth * 16 };

  // Dot-joined variable names below the entity, the key a view's selection tracks.
  const key = path.slice(1).map(segment => (segment.kind === 'variable' ? segment.target : '')).join('.');

  const row = (content: React.ReactNode) => (
    <div
      className={'var-row' + (selection?.selected === key ? ' selected' : '')}
      onClick={selection ? () => selection.toggle(key, variable) : undefined}
    >
      <div className="gutter">{index}</div>
      <div className="declaration" style={indent}>{content}</div>
    </div>
  );

  const ownerKind = owner.length === 1 ? owner[0].kind : undefined;
  const isStatus = name === STATUS_VARIABLE && (ownerKind === 'quest' || ownerKind === 'objective');
  if (variable.isComputed === 'computed' || isStatus) {
    return row(
      <>
        <span className="tok-comment">{isStatus ? 'status' : 'computed'}</span>
        <span className="tok-variable">{name}</span>
        <span className="tok-operator">=</span>
        {renderValueToken(value)}
      </>,
    );
  }

  const nested = isObjectResult(value) ? objectVariables(variable.value) : undefined;
  if (nested) {
    return (
      <>
        {row(
          <>
            <span className="tok-keyword">object</span>
            <span className="tok-variable">{name}</span>
          </>,
        )}
        {nested.map((child, i) => (
          <VariableEditor
            key={child.target}
            variable={child}
            owner={path}
            index={i + 1}
            depth={depth + 1}
            selection={selection}
          />
        ))}
      </>
    );
  }

  const enumDecl = variable.enumType ? getByReference<SerializedEnum>(variable.enumType) : undefined;
  const enumInfo: EnumInfo = {
    name: enumDecl?.name,
    members: enumDecl?.values.map(v => v.name),
  };
  // For `Kind[]` the enum describes the items, not the list itself.
  const ownEnum: EnumInfo = variable.isList ? {} : enumInfo;
  const itemEnum: EnumInfo = variable.isList ? enumInfo : {};

  const commit = (newValue: Storable) => { void execute({ type: 'ASSIGN_VARIABLE', path, newValue }); };
  const type = editorTypeOf(value, ownEnum.members);

  return row(
    <>
      <TypeSelect
        type={type}
        enumName={ownEnum.name}
        onChange={to => commit(convertValue(value, to, ownEnum.members))}
      />
      <span className="tok-variable">{name}</span>
      <span className="tok-operator">=</span>
      {type
        ? <ValueInput value={value} type={type} enumInfo={ownEnum} itemEnum={itemEnum} onCommit={commit} />
        : renderValueToken(value)}
    </>,
  );
}

/** The input for one value of a known type. A list renders its items with this same component. */
function ValueInput({ value, type, enumInfo, itemEnum, onCommit }: {
  value: unknown;
  type: EditorType;
  enumInfo: EnumInfo;
  /** The enum list items are drawn from, for a `Kind[]` variable. */
  itemEnum: EnumInfo;
  onCommit: (next: Storable) => void;
}) {
  switch (type) {
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onClick={stop}
          onChange={e => onCommit(e.target.checked)}
        />
      );
    case 'enum':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onClick={stop}
          onChange={e => { e.stopPropagation(); onCommit(e.target.value); }}
          style={inputStyle}
        >
          {(enumInfo.members ?? []).map(member => <option key={member} value={member}>{member}</option>)}
        </select>
      );
    case 'number':
      return (
        <DraftInput
          value={String(value)}
          numeric
          onCommit={text => {
            const parsed = parseNumber(text);
            if (parsed !== undefined && parsed !== value) onCommit(parsed);
          }}
        />
      );
    case 'text':
      return <DraftInput value={String(value)} onCommit={onCommit} />;
    case 'list':
      return <ListInput items={Array.isArray(value) ? value : []} itemEnum={itemEnum} onCommit={onCommit} />;
  }
}

/** Text or number box that writes on blur or Enter, never per keystroke, so the shared undo history
 *  holds finished edits only. Escape drops the draft. */
function DraftInput({ value, numeric, onCommit }: {
  value: string;
  numeric?: boolean;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current) { cancelled.current = false; return; }
    if (text !== null && text !== value) onCommit(text);
  };

  return (
    <input
      type={numeric ? 'number' : 'text'}
      step={numeric ? 'any' : undefined}
      value={draft ?? value}
      onClick={stop}
      onChange={e => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
      }}
      style={{ ...inputStyle, width: numeric ? 90 : `${Math.max(8, (draft ?? value).length + 2)}ch` }}
    />
  );
}

function ListInput({ items, itemEnum, onCommit }: {
  items: Array<EvalResult | undefined>;
  itemEnum: EnumInfo;
  onCommit: (next: Storable) => void;
}) {
  // A list holding a record cannot be written back, so it stays read-only.
  const clean = sanitizeList(items);
  if (!clean) return renderValueToken(items);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      <span className="tok-operator">[</span>
      {clean.map((item, i) => {
        const itemType = editorTypeOf(item, itemEnum.members);
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <TypeSelect
              type={itemType}
              enumName={itemEnum.name}
              onChange={to => onCommit(replaceAt(clean, i, convertValue(item, to, itemEnum.members)))}
            />
            {itemType && (
              <ValueInput
                value={item}
                type={itemType}
                enumInfo={itemEnum}
                itemEnum={itemEnum}
                onCommit={next => onCommit(replaceAt(clean, i, next))}
              />
            )}
            <button type="button" title="Remove item" style={buttonStyle} onClick={e => { stop(e); onCommit(removeAt(clean, i)); }}>
              x
            </button>
          </span>
        );
      })}
      <button
        type="button"
        title="Add item"
        style={buttonStyle}
        onClick={e => { stop(e); onCommit([...clean, newListItem(clean, itemEnum.members)]); }}
      >
        +
      </button>
      <span className="tok-operator">]</span>
    </span>
  );
}
