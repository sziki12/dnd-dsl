import { useContext } from 'react';
import { DslContext } from '../contexts/DslContext';
import { evaluateExpression, inferKind, type EvalResult } from '../common/expression-evaluator';
import EnumValueSelect from '../common/EnumValueSelect';
import type { SerializedNpc, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

function renderValueToken(value: EvalResult | null | undefined) {
  if (value === null || value === undefined) return <span className="tok-comment italic">?</span>;
  const kind = inferKind(value);
  if (kind === 'string') return <span className="tok-string">"{value as string}"</span>;
  if (kind === 'int') return <span className="tok-number">{value as number}</span>;
  if (kind === 'bool') return <span className="tok-keyword">{String(value)}</span>;
  return <span className="tok-operator">{String(value)}</span>;
}

export default function NpcsView() {
  const { worldState } = useContext(DslContext);
  const npcs: SerializedNpc[] = worldState?.World?.npcs ?? [];

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      <div className="pane-hd">
        <div className="pane-tabs"><span className="pane-tab active">NPCs<span className="cnt">{npcs.length}</span></span></div>
      </div>

      {npcs.length === 0 && <div className="npc-stub">No NPCs declared in this world.</div>}

      {npcs.map(npc => (
        <div key={npc.name} style={{ borderBottom: '1px solid var(--bd-divider)', padding: '8px 0' }}>
          <div className="var-banner"><h1>{npc.name}</h1></div>
          {npc.description && (
            <div style={{ padding: '0 12px 6px', color: 'var(--fg-secondary)', fontSize: 12 }}>{npc.description}</div>
          )}
          {npc.variables.map((variable: SerializedVariableDecl, i: number) => {
            const value = evaluateExpression(variable.value, { variableName: variable.target, worldState });
            const kind = inferKind(value);
            return (
              <div key={variable.target} className="var-row">
                <div className="gutter">{i + 1}</div>
                <div className="declaration">
                  <span className="tok-keyword">{kind === 'unknown' ? 'let' : kind}</span>
                  <span className="tok-variable">{variable.target}</span>
                  <span className="tok-operator">=</span>
                  {renderValueToken(value)}
                  <EnumValueSelect
                    variable={variable}
                    owner={{ kind: 'npc', name: npc.name }}
                    currentValue={value}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
