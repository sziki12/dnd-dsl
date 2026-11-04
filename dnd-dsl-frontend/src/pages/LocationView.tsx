import { useMemo, useState, useEffect, useContext } from 'react';

import { ReactFlowProvider } from '@xyflow/react';
import { evaluateExpression, isObjectResult, type SerialisedObjectDeclaration } from '../common/expression-evaluator';
import { renderValueToken } from '../common/ValueToken';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';

import { useParams } from 'react-router-dom';
import { DslContext } from '../contexts/DslContext.js';
import type { SerializedModel, SerializedLocation, SerializedVariableDecl } from '@dnd-language/evaluation/dnd-dsl-serialized-types.js';
import { findLocation } from '../common/location-tree';
import VariableEditor from '../common/VariableEditor';
import MapSettingsPanel from './MapSettingsPanel';
import MapFlow from './MapFlow';
import { useReferenceResolver, useStableGraph } from './map-flow-support';
import { buildLocationGraph } from './map-graph';
import { useMapViewSettings } from './useMapViewSettings';
import { useMapImage } from './useMapImage';
import { collectExitTags } from './exit-tags';

const LocationView = () => {
  let {locationName} = useParams()
  const {worldState, adventure, world} = useContext(DslContext)

  let [locationData, setLocationData] = useState<SerializedLocation | undefined>(undefined)
  const [leftTab, setLeftTab] = useState<'variables' | 'npcs'>('variables')
  const [viewMode, setViewMode] = useState<'map' | 'tree'>('map')
  // Live view settings of the map: per location, saved on the server, applied as they change.
  const [viewSettings, setViewSettings, settingsReady] = useMapViewSettings(adventure, world, locationName ?? '')
  // The location's background image, and the means to replace it (from the settings panel).
  const mapImage = useMapImage(adventure, locationName ?? '')
  // The tags the exits shown on the map carry, so the settings panel can offer a style for each.
  const exitTagList = useMemo(() => collectExitTags(locationData), [locationData])
  const resolve = useReferenceResolver()
  const graph = useStableGraph(useMemo(() => (locationData ? buildLocationGraph(locationData, resolve) : undefined), [locationData, resolve]))
  const [settingsOpen, setSettingsOpen] = useState(false)

  // What the doc panel below the tree currently shows - `path` is a dot-joined name
  // path (unique across nesting depth, stable across worldState updates, since it's
  // built from declaration names rather than object identity) used only to detect
  // "is this the same row clicked again"; `decl` is what the panel displays.
  type DocTarget = Pick<SerializedVariableDecl, 'target' | 'isComputed'>
  const [selectedVariable, setSelectedVariable] = useState<{ path: string; decl: DocTarget } | null>(null)

  // Clicking an already-selected row deselects it instead of re-selecting it.
  const toggleSelected = (path: string, decl: DocTarget) => {
    setSelectedVariable(prev => (prev?.path === path ? null : { path, decl }))
  }

  const renderObjectProps = (obj: SerialisedObjectDeclaration, parentPath: string) => (
    <div style={{ marginLeft: 16, marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
      {Object.entries(obj.staticProperties).map(([propName, propValue]) => {
        const path = `${parentPath}.${propName}`
        const isSelected = selectedVariable?.path === path
        const decl: DocTarget = { target: propName, isComputed: undefined }
        return isObjectResult(propValue) ? (
          <div key={propName}>
            <div className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, decl)}>
              <span className="tok-keyword">object</span>
              <span className="tok-variable">{propName}</span>
            </div>
            {renderObjectProps(propValue, path)}
          </div>
        ) : (
          <div key={propName} className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, decl)}>
            <span className="tok-variable">{propName}</span>
            <span className="tok-operator">=</span>
            {renderValueToken(propValue)}
          </div>
        )
      })}
      {obj.computedPropertyDecls.map((propDecl) => {
        const propValue = evaluateExpression(propDecl.value, { variableName: propDecl.target, worldState })
        const path = `${parentPath}.${propDecl.target}`
        const isSelected = selectedVariable?.path === path
        return isObjectResult(propValue) ? (
          <div key={propDecl.target}>
            <div className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, propDecl)}>
              <span className="tok-comment">computed</span>
              <span className="tok-variable">{propDecl.target}</span>
            </div>
            {renderObjectProps(propValue, path)}
          </div>
        ) : (
          <div key={propDecl.target} className={"var-prop " + (isSelected ? 'selected' : '')} onClick={() => toggleSelected(path, propDecl)}>
            <span className="tok-comment">computed</span>
            <span className="tok-variable">{propDecl.target}</span>
            <span className="tok-operator">=</span>
            {renderValueToken(propValue)}
          </div>
        )
      })}
    </div>
  )

  useEffect(()=>{

    const newLocation = getLocationData(worldState, locationName ?? "Location")
    if(typeof(newLocation) == "undefined")
      return
    setLocationData(newLocation)
    setSelectedVariable(null)
  },[worldState, locationName])

  return (
    <div className="h-full w-full flex flex-col lg:flex-row" style={{ background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      {/* Left pane: Variables / NPCs */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ borderRight: '1px solid var(--bd-divider)', minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className={"pane-tab " + (leftTab === 'variables' ? 'active' : '')} onClick={() => setLeftTab('variables')}>
              <CodeOutlinedIcon style={{ fontSize: 13 }} /> Variables
              <span className="cnt">{locationData?.variables.length ?? 0}</span>
            </button>
            <button className={"pane-tab " + (leftTab === 'npcs' ? 'active' : '')} onClick={() => setLeftTab('npcs')}>
              <PersonOutlineIcon style={{ fontSize: 13 }} /> NPCs
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {leftTab === 'variables' ? (
            <>
              <div className="var-banner">
                <h1>{locationName}</h1>
              </div>
              <div style={{ padding: '8px 0' }}>
                {locationData && locationData.variables.map((variable: SerializedVariableDecl, i: number) => {
                  const isComputed = variable.isComputed === 'computed'
                  const path = variable.target ?? ''
                  const isSelected = selectedVariable?.path === path

                  if (isComputed) {
                    // Live view of the current value - re-evaluated on every render, so it
                    // reflects any worldState change (local command or another page's, via
                    // DslContext.applyCommandResponse / the /state-sync broadcast).
                    const value = evaluateExpression(variable.value, { variableName: variable.target, worldState })
                    const valueObj = isObjectResult(value) ? value : undefined

                    return (
                      <div key={variable.target}>
                        <div
                          className={"var-row " + (isSelected ? 'selected' : '')}
                          onClick={() => toggleSelected(path, variable)}
                        >
                          <div className="gutter">{i + 1}</div>
                          <div className="declaration">
                            <span className="tok-comment">computed</span>
                            <span className="tok-variable">{variable.target}</span>
                            {!valueObj && (
                              <>
                                <span className="tok-operator">=</span>
                                {renderValueToken(value)}
                              </>
                            )}
                          </div>
                        </div>
                        {valueObj && renderObjectProps(valueObj, path)}
                      </div>
                    )
                  }

                  return (
                    <VariableEditor
                      key={variable.target}
                      variable={variable}
                      owner={[{ kind: 'location', name: locationData.name }]}
                      index={i + 1}
                      selection={{ selected: selectedVariable?.path ?? null, toggle: toggleSelected }}
                    />
                  )
                })}
              </div>

              {selectedVariable && (
                <div className="var-doc">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="tok-type">{selectedVariable.decl.isComputed === 'computed' ? 'computed' : 'let'}</span>
                    <span className="tok-variable">{selectedVariable.decl.target}</span>
                  </div>
                  <div className="meta">
                    <span><strong>computed:</strong> {selectedVariable.decl.isComputed === 'computed' ? 'yes' : 'no'}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="npc-stub">
              No NPC data available - not supported by the current DSL grammar yet.
            </div>
          )}
        </div>
      </div>

      {/* Right pane: Map / Tree */}
      <div className="flex-1 flex flex-col min-w-75 max-w-full" style={{ minHeight: 0 }}>
        <div className="pane-hd">
          <div className="pane-tabs">
            <button className={"pane-tab " + (viewMode === 'map' ? 'active' : '')} onClick={() => setViewMode('map')}>
              <RoomOutlinedIcon style={{ fontSize: 13 }} /> Map
            </button>
            <button className={"pane-tab " + (viewMode === 'tree' ? 'active' : '')} onClick={() => setViewMode('tree')}>
              <AccountTreeOutlinedIcon style={{ fontSize: 13 }} /> Tree
            </button>
          </div>
          <button
            type="button"
            className={"pane-tab " + (settingsOpen ? 'active' : '')}
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
              scopeKey={locationData?.name}
              graph={graph}
              treeRoot={locationData?.name}
              mode={viewMode}
              settings={viewSettings}
              settingsReady={settingsReady}
              mapImage={mapImage.image}
            />
          </ReactFlowProvider>
          {/* Outside ReactFlow: its scroll prevention would otherwise swallow the wheel over the panel. */}
          {settingsOpen && (
            <MapSettingsPanel
              settings={viewSettings}
              mode={viewMode}
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

const getLocationData = (worldState: SerializedModel | undefined, locationName: string) => {
  if (worldState?.World == undefined) return undefined;
  return findLocation(worldState.World.locations, locationName);
}

export default LocationView;