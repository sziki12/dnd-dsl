import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { DslContext, type ScriptRunResult } from '../contexts/DslContext';
import { ScriptStateContext, type ScriptHistoryItem } from '../contexts/ScriptStateContext';
import { useScriptEditor } from '../common/useScriptEditor';

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

const panel = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--bd-soft)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
} as const;

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
            style={{ ...panel, flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}
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

          {result && <ScriptOutput result={result} />}
        </div>

        {history.length > 0 && (
          <div style={{ width: 220, borderLeft: '1px solid var(--bd-divider)', overflow: 'auto', padding: 8 }}>
            <div style={{ color: 'var(--fg-secondary)', fontSize: 11, marginBottom: 6 }}>History</div>
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => setValue(h.source)}
                title={h.source}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
                  background: 'transparent', border: '1px solid var(--bd-soft)', borderRadius: 3,
                  color: h.result.ok ? 'var(--fg-primary)' : 'var(--error)',
                  fontFamily: 'var(--font-mono)', fontSize: 11, padding: '4px 6px', cursor: 'pointer',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {h.source.replace(HEADER_LINE, '').trim().split('\n')[0] || '(empty)'}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScriptOutput({ result }: { result: ScriptRunResult }) {
  if (!result.ok) {
    return (
      <pre style={{ ...panel, margin: 0, padding: 10, color: 'var(--error)', whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
        {result.error}
      </pre>
    );
  }
  const printed = result.printedValue ?? [];
  const hasReturn = result.returnValue !== undefined;
  const hasWrites = !!result.writes?.length;
  return (
    <div style={{ ...panel, padding: 10, maxHeight: 180, overflow: 'auto' }}>
      {printed.map((v, i) => (
        <div key={`print-${i}`}>
          <span style={{ color: 'var(--fg-secondary)' }}>print </span>
          <span className="tok-number">{JSON.stringify(v)}</span>
        </div>
      ))}
      {hasReturn && (
        <div style={{ marginTop: printed.length ? 8 : 0, marginBottom: hasWrites ? 8 : 0 }}>
          <span style={{ color: 'var(--fg-secondary)' }}>returned </span>
          <span className="tok-number">{JSON.stringify(result.returnValue)}</span>
        </div>
      )}
      {hasWrites
        ? result.writes!.map((w, i) => (
            <div key={i}>
              <span style={{ color: 'var(--fg-secondary)' }}>set </span>
              <span className="tok-variable">{formatPath(w.path)}</span>
              <span style={{ color: 'var(--fg-secondary)' }}> = </span>
              <span className="tok-number">{JSON.stringify(w.value)}</span>
            </div>
          ))
        : !hasReturn && printed.length === 0 && (
            <span style={{ color: 'var(--fg-secondary)' }}>ok, no changes</span>
          )}
    </div>
  );
}
