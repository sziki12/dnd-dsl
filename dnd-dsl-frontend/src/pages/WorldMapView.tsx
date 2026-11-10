import { useCallback, useContext, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import type { SerializedLocation, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { isHiddenVariable } from '@dnd-language/evaluation/dnd-dsl-party.js';

import { DslContext } from '../contexts/DslContext.js';
import { canonicalKeys } from '../common/location-identity';
import { useLocationIndex } from '../common/useLocationIndex';
import VariableEditor from '../common/VariableEditor';
import MapFlow from './MapFlow';
import MapSettingsPanel from './MapSettingsPanel';
import { useReferenceResolver, useStableGraph, WORLD_MAP_KEY } from './map-flow-support';
import { buildWorldGraph } from './map-graph';
import { collectExitTags } from './exit-tags';
import { toggleExpanded } from './map-view-settings';
import { useMapViewSettings } from './useMapViewSettings';
import { useMapImage } from './useMapImage';

const allLocations = (list: readonly SerializedLocation[]): SerializedLocation[] =>
  list.flatMap(location => [location, ...allLocations(location.sublocations)]);

const WorldMapView = () => {
  const { worldState, adventure, world } = useContext(DslContext);
  const [viewSettings, setViewSettings, settingsReady] = useMapViewSettings(adventure, world, WORLD_MAP_KEY);
  const mapImage = useMapImage(adventure, WORLD_MAP_KEY);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const resolve = useReferenceResolver();

  const worldNode = worldState?.World;
  const locations = worldNode?.locations;
  // The system's own variables (the current party's pointer) are not the author's to edit here.
  const variables = worldNode?.variables.filter(variable => !isHiddenVariable(variable.target)) ?? [];
  // Held back until the saved settings arrive, so the groups the DM left open are built open the first time.
  const graph = useStableGraph(useMemo(
    () => (locations && settingsReady ? buildWorldGraph(locations, viewSettings.expanded, resolve) : undefined),
    [locations, settingsReady, viewSettings.expanded, resolve],
  ));
  const exitTagList = useMemo(
    () => collectExitTags({ exits: [], sublocations: locations ? allLocations(locations) : [] }),
    [locations],
  );

  // A node's id is the key of its location. The saved list may still hold bare names, which become keys on this write.
  const index = useLocationIndex();
  const toggleGroup = useCallback(
    (id: string) => {
      const open = index ? canonicalKeys(index, viewSettings.expanded) : viewSettings.expanded;
      setViewSettings({ ...viewSettings, expanded: toggleExpanded(open, id) });
    },
    [index, viewSettings, setViewSettings],
  );

  return (
    <div className="h-full w-full flex flex-col lg:flex-row" style={{ background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      {/* Left pane: the world's own variables */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ borderRight: '1px solid var(--bd-divider)', minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className="pane-tab active">
              <CodeOutlinedIcon style={{ fontSize: 13 }} /> Variables
              <span className="cnt">{variables.length}</span>
            </button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div className="var-banner">
            <h1>{worldNode?.name ?? world}</h1>
          </div>
          <div style={{ padding: '8px 0' }}>
            {worldNode && variables.map((variable: SerializedVariableDecl, i: number) => (
              <VariableEditor key={variable.target} variable={variable} owner={[{ kind: 'world' }]} index={i + 1} />
            ))}
            {worldNode && variables.length === 0 && (
              <div className="npc-stub">The world declares no variables.</div>
            )}
          </div>
        </div>
      </div>

      {/* Right pane: the map */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className="pane-tab active">
              <RoomOutlinedIcon style={{ fontSize: 13 }} /> Map
            </button>
          </div>
          <button
            type="button"
            className={'pane-tab ' + (settingsOpen ? 'active' : '')}
            style={{ marginLeft: 'auto' }}
            title="Map settings"
            onClick={() => setSettingsOpen(open => !open)}
          >
            <TuneOutlinedIcon style={{ fontSize: 14 }} /> Customize
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <ReactFlowProvider>
            <MapFlow
              scopeKey={worldNode ? WORLD_MAP_KEY : undefined}
              graph={graph}
              mode="map"
              settings={viewSettings}
              settingsReady={settingsReady}
              mapImage={mapImage.image}
              onToggleGroup={toggleGroup}
            />
          </ReactFlowProvider>
          {locations && locations.length === 0 && (
            <div className="npc-stub" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              This world has no locations yet.
            </div>
          )}
          {/* Outside ReactFlow: its scroll prevention would otherwise swallow the wheel over the panel. */}
          {settingsOpen && (
            <MapSettingsPanel
              scope="world"
              settings={viewSettings}
              mode="map"
              image={{ hasImage: mapImage.image !== null, busy: mapImage.busy, error: mapImage.error, onReplace: mapImage.replace }}
              exitTags={exitTagList}
              onChange={setViewSettings}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default WorldMapView;
