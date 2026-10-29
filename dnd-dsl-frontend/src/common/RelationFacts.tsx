import { Link } from 'react-router-dom';
import VariableEditor from './VariableEditor';
import { factOwner, targetRoute, type FactView } from './relation-facts';
import type { StatePath } from '@dnd-language/evaluation/dnd-dsl-state-path.js';

/** The relation facts written in one entity: a line per fact, then that fact's own variables as editable rows. */
export default function RelationFacts({ host, facts }: { host: StatePath; facts: FactView[] }) {
  return (
    <>
      {facts.map(({ segment, variables }) => (
        <div key={`${segment.predicate}:${segment.targetKind}:${segment.targetName}`}>
          <div className="chain-note">
            <span className="label">{segment.predicate}</span>
            <Link className="entity-link" to={targetRoute(segment)}>{segment.targetName}</Link>
          </div>
          {variables.map((variable, i) => (
            <VariableEditor
              key={variable.target}
              variable={variable}
              owner={factOwner(host, segment)}
              index={i + 1}
            />
          ))}
        </div>
      ))}
    </>
  );
}
