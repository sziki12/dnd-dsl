import { useContext } from 'react';
import { DslContext } from '../contexts/DslContext';
import VariableEditor from '../common/VariableEditor';
import RelationFacts from '../common/RelationFacts';
import { factsOf } from '../common/relation-facts';
import type { SerializedNpc, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

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
          {npc.variables.map((variable: SerializedVariableDecl, i: number) => (
            <VariableEditor
              key={variable.target}
              variable={variable}
              owner={[{ kind: 'npc', name: npc.name }]}
              index={i + 1}
            />
          ))}
          <RelationFacts host={[{ kind: 'npc', name: npc.name }]} facts={factsOf(worldState, npc)} />
        </div>
      ))}
    </div>
  );
}
