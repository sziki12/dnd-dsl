import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { DslContext, type ScriptRunResult } from '../contexts/DslContext';
import { ScriptStateContext, type ScriptHistoryItem } from '../contexts/ScriptStateContext';
import { useScriptEditor } from '../common/useScriptEditor';
import { useResizablePane } from '../common/useResizablePane';
import type { ScriptEvent } from '@dnd-language/evaluation/dnd-dsl-commands';

const HEADER_LINE = /^\s*reference\s+world\b.*$/m;

/** `encodeStatePath` output -> a readable `location "X" . var` string. */
function formatPath(encoded: string): string {
  try {
    const segs = JSON.parse(encoded) as { kind: string; name?: string; target?: string }[];
    return segs
      .map(s =>
        s.kind === 'variable' ? `. ${s.target}`
        : s.kind === 'world' ? 'world'
        : `${s.kind} "${s.name}"`,
      )
      .join(' ');
  } catch {
    return encoded;
  }
}

/** "2 print · 1 write · 1 trigger" - a one-line count of a run's events, for the
 *  history sidebar. Empty string when there's nothing to summarize. */
function summarizeEvents(events?: ScriptEvent[]): string {
  if (!events?.length) return '';
  const counts = { print: 0, write: 0, trigger: 0 };
  for (const e of events) counts[e.kind]++;
  const plural = (n: number, label: string) => `${n} ${label}${n === 1 ? '' : 's'}`;
  return (['print', 'write', 'trigger'] as const)
    .filter(kind => counts[kind] > 0)
    .map(kind => plural(counts[kind], kind))
    .join(' · ');
}

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--bd-soft)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
} as const;

/** A draggable divider - `axis: 'row'` for a horizontal split (drag up/down),
 *  `'col'` for a vertical one (drag left/right). */
function ResizeHandle({ axis, onMouseDown }: { axis: 'row' | 'col'; onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        cursor: axis === 'row' ? 'ns-resize' : 'ew-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(axis === 'row' ? { height: 8, width: '100%' } : { width: 8, height: '100%' }),
      }}
    >
      <div style={{ background: 'var(--bd-divider)', ...(axis === 'row' ? { width: '100%', height: 1 } : { height: '100%', width: 1 }) }} />
    </div>
  );
}

export default function ScriptView() {
  const { worldState, adventure, world, runScript } = useContext(DslContext);
  const scriptState = useContext(ScriptStateContext);
  const worldName = worldState?.World?.name;
  const header = useMemo(() => (worldName ? `reference world "${worldName}"\n\n` : ''), [worldName]);

  // Restore the page state stashed on the last navigation away (same world only).
  const restored = useMemo(() => {
    const s = scriptState.readState();
    return s.world === world ? s : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistSource = useCallback(
    (text: string) => scriptState.writeState({ world, source: text }),
    [scriptState, world],
  );

  const { containerRef, getValue, setValue, ready } = useScriptEditor(
    adventure,
    world,
    restored?.source || header,
    persistSource,
  );

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScriptRunResult | null>(restored?.result ?? null);
  const [history, setHistory] = useState<ScriptHistoryItem[]>(restored?.history ?? []);

  // Dragged sizes persist across visits (localStorage) - the handle sits on the
  // output panel's top edge and the history sidebar's left edge, so both grow
  // toward 'up'/'left'.
  const [outputHeight, onOutputHandleDown] = useResizablePane('dnd-dsl-script-output-h', 180, { min: 80, max: 600, direction: 'up' });
  const [historyWidth, onHistoryHandleDown] = useResizablePane('dnd-dsl-script-history-w', 220, { min: 140, max: 480, direction: 'left' });

  useEffect(() => {
    scriptState.writeState({ world, history, result });
  }, [scriptState, world, history, result]);

  const run = async () => {
    if (running || !ready) return;
    const source = getValue();
    if (source.replace(HEADER_LINE, '').trim().length === 0) {
      setResult({ ok: false, error: 'Write a statement below the header.' });
      return;
    }
    setRunning(true);
    const res = await runScript(source);
    setRunning(false);
    setResult(res);
    setHistory(prev => [{ source, result: res }, ...prev].slice(0, 20));
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)', color: 'var(--fg-primary)' }}>
      <div className="pane-hd">
        <div className="pane-tabs"><span className="pane-tab active">Script</span></div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 12, gap: 8, minWidth: 0 }}>
          <div
            ref={containerRef}
            onKeyDownCapture={e => {
              if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void run(); }
            }}
            style={{ ...panel, flex: 1, minHeight: 80, overflow: 'hidden', padding: 0 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => void run()}
              disabled={running || !ready || !worldName}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3,
                padding: '4px 12px', fontSize: 12, cursor: running || !ready ? 'default' : 'pointer',
                opacity: running || !ready || !worldName ? 0.5 : 1,
              }}
            >
              <PlayArrowIcon style={{ fontSize: 16 }} />
              {running ? 'Running…' : 'Run'}
            </button>
            <span style={{ color: 'var(--fg-secondary)', fontSize: 11 }}>Ctrl+Enter to run script | Ctrl+Space for suggestions</span>
          </div>

          {result && (
            <>
              <ResizeHandle axis="row" onMouseDown={onOutputHandleDown} />
              <ScriptOutput result={result} height={outputHeight} />
            </>
          )}
        </div>

        {history.length > 0 && (
          <ResizeHandle axis="col" onMouseDown={onHistoryHandleDown} />
        )}
        {history.length > 0 && (
          <div style={{ width: historyWidth, flexShrink: 0, overflow: 'auto', padding: 8 }}>
            <div style={{ color: 'var(--fg-secondary)', fontSize: 11, marginBottom: 6 }}>History</div>
            {history.map((h, i) => {
              const summary = h.result.ok ? summarizeEvents(h.result.events) : '';
              return (
                <button
                  key={i}
                  onClick={() => setValue(h.source)}
                  title={h.source}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
                    background: 'transparent', border: '1px solid var(--bd-soft)', borderRadius: 3,
                    color: h.result.ok ? 'var(--fg-primary)' : 'var(--error)',
                    fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 6px', cursor: 'pointer',
                  }}
                >
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.source.replace(HEADER_LINE, '').trim().split('\n')[0] || '(empty)'}
                  </div>
                  {summary && (
                    <div style={{ color: 'var(--fg-secondary)', fontSize: 10, marginTop: 2 }}>{summary}</div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type EventNode = ScriptEvent & { children?: EventNode[] };

/** Rebuilds the flat, depth-tagged `events` list into a tree, so a `trigger`'s own
 *  cascade (writes/prints, and any triggers it fires in turn) nests under it instead
 *  of reading as a flat list with no link back to what caused it. See `ScriptEvent`'s
 *  doc comment (`dnd-dsl-commands.ts`) for how `depth` encodes this unambiguously. */
function buildEventTree(events: ScriptEvent[]): EventNode[] {
  const root: EventNode[] = [];
  const openTriggers: EventNode[] = []; // openTriggers[d] = the open trigger node at depth d+1
  for (const e of events) {
    const node: EventNode = e.kind === 'trigger' ? { ...e, children: [] } : { ...e };
    const targetDepth = e.kind === 'trigger' ? e.depth - 1 : e.depth;
    openTriggers.length = Math.max(0, targetDepth);
    const parent = openTriggers.length === 0 ? root : openTriggers[openTriggers.length - 1].children!;
    parent.push(node);
    if (e.kind === 'trigger') openTriggers.push(node);
  }
  return root;
}

/** One row of script output. A `trigger` row is a disclosure toggle over its own
 *  cascade, expanded by default. */
function EventRow({ node }: { node: EventNode }) {
  const [expanded, setExpanded] = useState(true);

  if (node.kind === 'print') {
    return (
      <div>
        <span style={{ color: 'var(--fg-secondary)' }}>print </span>
        <span className="tok-number">{JSON.stringify(node.value)}</span>
      </div>
    );
  }
  if (node.kind === 'write') {
    return (
      <div>
        <span style={{ color: 'var(--fg-secondary)' }}>set </span>
        <span className="tok-variable">{formatPath(node.path)}</span>
        <span style={{ color: 'var(--fg-secondary)' }}> = </span>
        <span className="tok-number">{JSON.stringify(node.value)}</span>
      </div>
    );
  }

  const hasChildren = !!node.children?.length;
  return (
    <div>
      <div
        onClick={() => hasChildren && setExpanded(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: hasChildren ? 'pointer' : 'default' }}
      >
        <span style={{ color: 'var(--fg-secondary)', fontSize: 10, width: 10, display: 'inline-block' }}>
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span className="tok-variable">{node.eventName}</span>
        <span style={{ color: 'var(--fg-secondary)' }}> event triggered</span>
      </div>
      {hasChildren && expanded && (
        <div style={{ marginLeft: 14, paddingLeft: 8, borderLeft: '1px solid var(--bd-soft)' }}>
          {node.children!.map((child, i) => <EventRow key={i} node={child} />)}
        </div>
      )}
    </div>
  );
}

function ScriptOutput({ result, height }: { result: ScriptRunResult; height: number }) {
  if (!result.ok) {
    return (
      <pre style={{ ...panel, margin: 0, padding: 10, color: 'var(--error)', whiteSpace: 'pre-wrap', height, overflow: 'auto' }}>
        {result.error}
      </pre>
    );
  }
  const events = result.events ?? [];
  const hasReturn = result.returnValue !== undefined;
  return (
    <div style={{ ...panel, padding: 10, height, overflow: 'auto' }}>
      {buildEventTree(events).map((node, i) => <EventRow key={i} node={node} />)}
      {hasReturn && (
        <div style={{ marginTop: events.length ? 8 : 0 }}>
          <span style={{ color: 'var(--fg-secondary)' }}>returned </span>
          <span className="tok-number">{JSON.stringify(result.returnValue)}</span>
        </div>
      )}
      {!hasReturn && events.length === 0 && (
        <span style={{ color: 'var(--fg-secondary)' }}>ok, no changes</span>
      )}
    </div>
  );
}
