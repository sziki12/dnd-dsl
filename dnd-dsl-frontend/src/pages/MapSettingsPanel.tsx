import { useRef, type ReactNode } from 'react';
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import { IMAGE_ACCEPT, validateImageFile } from './map-image';
import {
  DEFAULT_COLORS,
  defaultSettings,
  resolveColor,
  setColor,
  type ColorScope,
  type MapViewSettings,
  type NodeSizeMode,
  type StyleKind,
  type ViewMode,
} from './map-view-settings';

const COLOUR_ROWS: { scope: ColorScope; label: string; indent?: boolean }[] = [
  { scope: 'all', label: 'Everything' },
  { scope: 'nodes', label: 'All nodes' },
  { scope: 'root', label: 'This location', indent: true },
  { scope: 'sub', label: 'Sublocations', indent: true },
  { scope: 'entry', label: 'Entry sublocation', indent: true },
  { scope: 'external', label: 'Exit targets', indent: true },
  { scope: 'edges', label: 'All edges' },
  { scope: 'exit', label: 'Exits', indent: true },
  { scope: 'sublocation', label: 'Sublocation links', indent: true },
];

const isKind = (scope: ColorScope): scope is StyleKind => scope !== 'all' && scope !== 'nodes' && scope !== 'edges';

/** What the picker shows for a scope that has no colour of its own. */
function pickerColor(settings: MapViewSettings, scope: ColorScope): string {
  if (isKind(scope)) return resolveColor(settings.colors, scope) ?? DEFAULT_COLORS[scope];
  if (scope === 'nodes') return settings.colors.all ?? DEFAULT_COLORS.sub;
  if (scope === 'edges') return settings.colors.all ?? DEFAULT_COLORS.exit;
  return DEFAULT_COLORS.sub;
}

function stateLabel(settings: MapViewSettings, scope: ColorScope): string {
  if (settings.colors[scope]) return 'custom';
  if (isKind(scope) && resolveColor(settings.colors, scope)) return 'inherited';
  return 'default';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ms-section">
      <div className="ms-section-title">{title}</div>
      {children}
    </div>
  );
}

function CheckRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={'ms-row' + (disabled ? ' disabled' : '')}>
      <span className="ms-label">{label}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    </label>
  );
}

function SliderRow({ label, value, min, max, step, suffix, disabled, onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; disabled?: boolean; onChange: (value: number) => void;
}) {
  return (
    <label className={'ms-row' + (disabled ? ' disabled' : '')}>
      <span className="ms-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} />
      <span className="ms-value">{value}{suffix}</span>
    </label>
  );
}

/**
 * Live view settings for the map. Every change calls onChange straight away, and MapFlow turns it into CSS
 * variables and classes, so the map updates as a slider moves or a colour is dragged.
 */
export default function MapSettingsPanel({ settings, mode, image, onChange, onClose }: {
  settings: MapViewSettings;
  mode: ViewMode;
  image: { hasImage: boolean; busy: boolean; error: string | null; onReplace: (file: File) => void };
  onChange: (next: MapViewSettings) => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const treeMode = mode !== 'map';

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    // A file that cannot be used is reported by the upload itself, without asking about the old image first.
    if (image.hasImage && validateImageFile(file) === undefined
      && !window.confirm(`Replace this location's map image with "${file.name}"? The current image file is deleted.`)) return;
    image.onReplace(file);
  };
  const patchNodes = (patch: Partial<MapViewSettings['nodes']>) => onChange({ ...settings, nodes: { ...settings.nodes, ...patch } });

  return (
    <div className="map-settings" role="dialog" aria-label="Map settings">
      <div className="ms-head">
        <span>Map settings</span>
        <button type="button" className="ms-icon-btn" title="Close" onClick={onClose}>
          <CloseOutlinedIcon style={{ fontSize: 16 }} />
        </button>
      </div>

      <Section title="Map image">
        <div className="ms-row">
          <button type="button" className="ms-reset" disabled={image.busy} onClick={() => fileInput.current?.click()}>
            {image.busy ? 'Uploading...' : image.hasImage ? 'Replace image...' : 'Upload image...'}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = ''; // so choosing the same file again still counts
            chooseFile(file);
          }}
        />
        {image.error && <p className="ms-note ms-error">{image.error}</p>}
        <p className="ms-note">PNG, JPEG, WebP or GIF, up to 25 MB. Replacing deletes the old file.</p>
      </Section>

      <Section title="Edges">
        <CheckRow label="Show exit names" checked={settings.labels} onChange={labels => onChange({ ...settings, labels })} />
        <CheckRow label="Show edges" checked={settings.edges.visible} onChange={visible => onChange({ ...settings, edges: { visible } })} />
      </Section>

      <Section title="Nodes">
        <CheckRow label="Show nodes" checked={settings.nodes.visible} disabled={treeMode} onChange={visible => patchNodes({ visible })} />
        <SliderRow
          label="Opacity" value={Math.round(settings.nodes.opacity * 100)} min={0} max={100} step={5} suffix="%" disabled={treeMode}
          onChange={value => patchNodes({ opacity: value / 100 })}
        />
        <label className="ms-row">
          <span className="ms-label">Size</span>
          <select value={settings.nodes.sizeMode} onChange={e => patchNodes({ sizeMode: e.target.value as NodeSizeMode })}>
            <option value="map">Scales with the map</option>
            <option value="screen">Fixed on screen</option>
          </select>
        </label>
        <SliderRow
          label="Scale" value={Math.round(settings.nodes.size * 100)} min={50} max={200} step={5} suffix="%"
          onChange={value => patchNodes({ size: value / 100 })}
        />
        {treeMode && <p className="ms-note">Show and opacity apply on the Map tab.</p>}
      </Section>

      <Section title="Colours">
        {COLOUR_ROWS.map(({ scope, label, indent }) => (
          <div key={scope} className="ms-row" style={indent ? { paddingLeft: 14 } : undefined}>
            <span className="ms-label">{label}</span>
            <span className="ms-state">{stateLabel(settings, scope)}</span>
            <input
              type="color"
              value={settings.colors[scope] ?? pickerColor(settings, scope)}
              onChange={e => onChange(setColor(settings, scope, e.target.value))}
            />
            <button
              type="button"
              className="ms-icon-btn"
              title="Back to the default"
              disabled={!settings.colors[scope]}
              style={settings.colors[scope] ? undefined : { visibility: 'hidden' }}
              onClick={() => onChange(setColor(settings, scope, undefined))}
            >
              <CloseOutlinedIcon style={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
        <p className="ms-note">A colour for a wider group replaces the narrower ones under it.</p>
      </Section>

      <div className="ms-foot">
        <button type="button" className="ms-reset" onClick={() => onChange(defaultSettings())}>Reset to defaults</button>
      </div>
    </div>
  );
}
