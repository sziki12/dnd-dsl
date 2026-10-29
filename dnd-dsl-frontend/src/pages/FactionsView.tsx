import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext';
import VariableEditor from '../common/VariableEditor';
import RelationFacts from '../common/RelationFacts';
import { factsOf, membersOfFaction } from '../common/relation-facts';
import type { SerializedFaction, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

export default function FactionsView() {
  const { worldState } = useContext(DslContext);
  const factions: SerializedFaction[] = worldState?.World?.factions ?? [];

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      <div className="pane-hd">
        <div className="pane-tabs"><span className="pane-tab active">Factions<span className="cnt">{factions.length}</span></span></div>
      </div>

      {factions.length === 0 && <div className="npc-stub">No factions declared in this world.</div>}

      {factions.map(faction => {
        const members = membersOfFaction(worldState, faction.name);
        return (
          <div key={faction.name} style={{ borderBottom: '1px solid var(--bd-divider)', padding: '8px 0' }}>
            <div className="var-banner"><h1>{faction.name}</h1></div>
            {faction.description && (
              <div style={{ padding: '0 12px 6px', color: 'var(--fg-secondary)', fontSize: 12 }}>{faction.description}</div>
            )}
            <div className="chain-note">
              <span className="label">Members</span>
              {members.length === 0
                ? 'none'
                : members.map((member, i) => (
                    <span key={member}>
                      {i > 0 && ', '}
                      <Link className="entity-link" to="/npcs">{member}</Link>
                    </span>
                  ))}
            </div>
            {faction.variables.map((variable: SerializedVariableDecl, i: number) => (
              <VariableEditor
                key={variable.target}
                variable={variable}
                owner={[{ kind: 'faction', name: faction.name }]}
                index={i + 1}
              />
            ))}
            <RelationFacts host={[{ kind: 'faction', name: faction.name }]} facts={factsOf(worldState, faction)} />
          </div>
        );
      })}
    </div>
  );
}
