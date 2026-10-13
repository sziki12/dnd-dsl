import { Fragment, useContext } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext';
import { evaluateExpression, inferKind } from '../common/expression-evaluator';
import { renderValueToken } from '../common/ValueToken';
import EnumValueSelect from '../common/EnumValueSelect';
import EntityLink from '../common/EntityLink';
import StatusBadge from '../common/StatusBadge';
import { questDependencies, statusOf, type QuestDependency } from '@dnd-language/evaluation/dnd-dsl-world-graph.js';
import { STATUS_VARIABLE } from '@dnd-language/evaluation/dnd-dsl-status.js';
import type { StatePathSegment } from '@dnd-language/evaluation/dnd-dsl-state-path.js';
import type { SerializedModel, SerializedQuest, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';

const PAGE_STYLE = { height: '100%', overflow: 'auto', background: 'var(--bg-editor)', color: 'var(--fg-primary)' } as const;

/** An entity's own variables, as the NPCs page lays them out. `Status` is shown as a badge instead. */
function VariableRows({ variables, owner, worldState }: {
  variables: SerializedVariableDecl[];
  owner: StatePathSegment;
  worldState: SerializedModel;
}) {
  return variables
    .filter(variable => (variable.target ?? variable.name) !== STATUS_VARIABLE)
    .map((variable, i) => {
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
            <EnumValueSelect variable={variable} owner={owner} currentValue={value} />
          </div>
        </div>
      );
    });
}

function Dependencies({ label, dependencies }: { label: string; dependencies: QuestDependency[] }) {
  if (dependencies.length === 0) return null;
  return (
    <div className="chain-note">
      <span className="label">{label}</span>
      {dependencies.map((dependency, i) => (
        <Fragment key={`${dependency.target}:${dependency.name}:${dependency.requires}`}>
          {i > 0 && ', '}
          {dependency.target} <EntityLink kind="quest" name={dependency.quest}>"{dependency.name}"</EntityLink> {dependency.requires}
        </Fragment>
      ))}
    </div>
  );
}

/** One quest with its objectives. The overview links the name to the quest's page; `detailed` is that page, which adds the variables. */
function QuestBlock({ quest, worldState, detailed }: { quest: SerializedQuest; worldState: SerializedModel; detailed: boolean }) {
  return (
    <div className="quest-block">
      <div className="var-banner">
        <h1>
          {detailed ? quest.name : <EntityLink kind="quest" name={quest.name} />}
          <StatusBadge status={statusOf(worldState, quest)} />
        </h1>
      </div>
      {quest.description && <div className="quest-desc">{quest.description}</div>}

      <Dependencies label="Unlock waits on" dependencies={questDependencies(worldState, quest.enabled)} />
      <Dependencies label="Completion waits on" dependencies={questDependencies(worldState, quest.requierement)} />

      {detailed && <VariableRows variables={quest.variables} owner={{ kind: 'quest', name: quest.name }} worldState={worldState} />}

      <div className="objective-list">
        {quest.objectives.map(objective => (
          <div key={objective.name} className="objective">
            <div className="head">
              <span>{objective.name}</span>
              <StatusBadge status={statusOf(worldState, objective)} />
            </div>
            {objective.description && <div className="desc">{objective.description}</div>}
            {detailed && (
              <VariableRows
                variables={objective.variables}
                owner={{ kind: 'objective', questName: quest.name, name: objective.name }}
                worldState={worldState}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** `/quests` is every quest with its objectives, `/quests/:questName` one quest in full. */
export default function QuestsView() {
  const { questName } = useParams();
  const { worldState } = useContext(DslContext);
  const quests: SerializedQuest[] = worldState?.World?.quests ?? [];

  if (questName === undefined) {
    return (
      <div style={PAGE_STYLE}>
        <div className="pane-hd">
          <div className="pane-tabs"><span className="pane-tab active">Quests<span className="cnt">{quests.length}</span></span></div>
        </div>
        {!worldState && <div className="npc-stub">No world loaded.</div>}
        {worldState && quests.length === 0 && <div className="npc-stub">No quests declared in this world.</div>}
        {worldState && quests.map(quest => <QuestBlock key={quest.name} quest={quest} worldState={worldState} detailed={false} />)}
      </div>
    );
  }

  const quest = quests.find(q => q.name === questName);
  return (
    <div style={PAGE_STYLE}>
      <div className="pane-hd">
        <div className="pane-tabs"><span className="pane-tab active">Quest</span></div>
        <Link className="entity-link back-link" to="/quests">&larr; All quests</Link>
      </div>
      {!worldState && <div className="npc-stub">No world loaded.</div>}
      {worldState && !quest && <div className="npc-stub">No quest named "{questName}" in this world.</div>}
      {worldState && quest && <QuestBlock quest={quest} worldState={worldState} detailed />}
    </div>
  );
}
