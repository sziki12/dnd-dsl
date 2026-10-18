import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import { SUFFIX_MAX, findRule, removeTagRule, setTagStyle, type ExitTag, type TagRule, type TagStyle } from './exit-tags';

const WIDTHS = [1, 2, 3, 4, 6];
const OPACITIES = [1, 0.75, 0.5, 0.25];
const FALLBACK_COLOR = '#9d9d9d';

const keyOf = (entry: { tag: string; value?: string }) => `${entry.tag}\u0000${entry.value ?? ''}`;

/** The preset choices, plus the stored value when it is not one of them, so a select never shows the wrong thing. */
function withCurrent(options: number[], current: number | undefined): number[] {
  return current === undefined || options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

function TagEditor({ entry, rule, unused, hasValues, onChange }: {
  entry: ExitTag;
  rule: TagRule | undefined;
  unused: boolean;
  /** For a tag-wide entry: other entries list the values seen with this tag. */
  hasValues: boolean;
  onChange: (rules: (current: ReadonlyArray<TagRule>) => TagRule[]) => void;
}) {
  const style: TagStyle = rule?.style ?? {};
  const set = (patch: Partial<TagStyle>) => onChange(current => setTagStyle(current, entry.tag, entry.value, patch));
  const choice = (value: string) => (value === '' ? undefined : Number(value));

  return (
    <details className="ms-tag" style={entry.value !== undefined ? { marginLeft: 14 } : undefined}>
      <summary>
        <span className="ms-label">
          {entry.value === undefined ? entry.tag : `${entry.tag} = ${entry.value}`}
          {entry.value === undefined && hasValues && <span className="ms-state"> any value</span>}
        </span>
        {unused && <span className="ms-state">not used here</span>}
        {rule && <span className="ms-tag-dot" style={{ background: style.color ?? 'var(--accent)' }} title="Has a style" />}
      </summary>

      <div className="ms-tag-body">
        <div className="ms-row">
          <span className="ms-label">Colour</span>
          <input type="color" value={style.color ?? FALLBACK_COLOR} onChange={e => set({ color: e.target.value })} />
          <button
            type="button" className="ms-icon-btn" title="Back to the default"
            style={style.color ? undefined : { visibility: 'hidden' }} onClick={() => set({ color: undefined })}
          >
            <CloseOutlinedIcon style={{ fontSize: 14 }} />
          </button>
        </div>
        <label className="ms-row">
          <span className="ms-label">Width</span>
          <select value={style.width ?? ''} onChange={e => set({ width: choice(e.target.value) })}>
            <option value="">Default</option>
            {withCurrent(WIDTHS, style.width).map(w => <option key={w} value={w}>{w} px</option>)}
          </select>
        </label>
        <label className="ms-row">
          <span className="ms-label">Line</span>
          <select
            value={style.dash === undefined ? '' : style.dash ? 'dashed' : 'solid'}
            onChange={e => set({ dash: e.target.value === '' ? undefined : e.target.value === 'dashed' })}
          >
            <option value="">Default</option>
            <option value="dashed">Dashed</option>
            <option value="solid">Solid</option>
          </select>
        </label>
        <label className="ms-row">
          <span className="ms-label">Opacity</span>
          <select value={style.opacity ?? ''} onChange={e => set({ opacity: choice(e.target.value) })}>
            <option value="">Default</option>
            {withCurrent(OPACITIES, style.opacity).map(o => <option key={o} value={o}>{Math.round(o * 100)}%</option>)}
          </select>
        </label>
        <label className="ms-row">
          <span className="ms-label">After the name</span>
          <input
            type="text" className="ms-text" maxLength={SUFFIX_MAX} value={style.suffix ?? ''} placeholder="a sign"
            onChange={e => set({ suffix: e.target.value })}
          />
        </label>
        {rule && (
          <div className="ms-row">
            <button type="button" className="ms-reset" onClick={() => onChange(current => removeTagRule(current, entry.tag, entry.value))}>
              Remove style
            </button>
          </div>
        )}
      </div>
    </details>
  );
}

/**
 * Styles for exits by their tags. Lists every tag the exits of this location use (and each value seen with it),
 * plus any stored rule whose tag no exit here has now, so nothing has to be typed and nothing is lost silently.
 */
export default function ExitTagStyles({ seen, rules, onChange }: {
  seen: ExitTag[];
  rules: TagRule[];
  onChange: (rules: TagRule[]) => void;
}) {
  const seenKeys = new Set(seen.map(keyOf));
  const leftOver: ExitTag[] = rules.filter(r => !seenKeys.has(keyOf(r))).map(r => ({ tag: r.tag, value: r.value }));
  const entries = [...seen.map(entry => ({ entry, unused: false })), ...leftOver.map(entry => ({ entry, unused: true }))];
  const valuedTags = new Set(entries.filter(e => e.entry.value !== undefined).map(e => e.entry.tag));
  // The editors hand over a function of the rules so two quick edits in a row never undo each other.
  const apply = (change: (current: ReadonlyArray<TagRule>) => TagRule[]) => onChange(change(rules));

  if (entries.length === 0) {
    return <p className="ms-note">No exit here has a tag. Add one to an exit in the world, e.g. <code>["Hidden": true]</code>, to style it.</p>;
  }
  return (
    <>
      {entries.map(({ entry, unused }) => (
        <TagEditor
          key={keyOf(entry)}
          entry={entry}
          rule={findRule(rules, entry.tag, entry.value)}
          unused={unused}
          hasValues={valuedTags.has(entry.tag)}
          onChange={apply}
        />
      ))}
      <p className="ms-note">A style for one value wins over the tag-wide style. If two tags set the same thing, the style created last wins.</p>
    </>
  );
}
