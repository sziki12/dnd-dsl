import { useContext, useState } from 'react';
import { useParams } from 'react-router-dom';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import { DslContext } from '../../contexts/DslContext';
import { BackendURL } from '../../contexts/BackendContext';
import { formatClock } from '@dnd-language/evaluation/dnd-dsl-clock';
import type { FiredReminder, ScheduledReminder } from '@dnd-language/evaluation/dnd-dsl-reminders';
import { getDisplayName, setDisplayName } from '../useStateSync';

const itemStyle: React.CSSProperties = {
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: '100%',
};

type Agenda = {
  now: number;
  upcoming: ScheduledReminder[];
  fired: FiredReminder[];
};

const severityColor = { info: 'var(--accent)', warning: 'var(--warn)', urgent: 'var(--error)' } as const;

export default function StatusBar() {
  const { adventure, world, worldState, canUndo, canRedo, undo, redo, execute, isController, controllerName, claimControl } = useContext(DslContext);
  const { locationName } = useParams();
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [controlOpen, setControlOpen] = useState(false);
  const [nameInput, setNameInput] = useState(getDisplayName());

  const loaded = worldState !== undefined;
  const clock = loaded ? formatClock((worldState as any).clock ?? 0) : formatClock(0);

  const refreshAgenda = async () => {
    const response = await fetch(`${BackendURL}/world/agenda`);
    setAgenda(await response.json());
  };

  const toggleAgenda = () => {
    if (!agendaOpen) refreshAgenda();
    setAgendaOpen(!agendaOpen);
  };

  const advance = async (amount: number, unit: 'round' | 'hour' | 'day') => {
    await execute({ type: 'ADVANCE_TIME', amount, unit });
    if (agendaOpen) refreshAgenda();
  };

  const ack = async (reminderId: string) => {
    await execute({ type: 'ACK_REMINDER', reminderId });
    refreshAgenda();
  };

  const saveDisplayName = () => setDisplayName(nameInput);

  return (
    <div className="shell-statusbar" style={{ position: 'relative' }}>
      <div style={itemStyle}>
        {adventure} / {world}
        {locationName && ` · ${locationName}`}
      </div>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: (canUndo && isController) ? 'pointer' : 'default', opacity: (canUndo && isController) ? 1 : 0.5 }}
        disabled={!canUndo || !isController}
        onClick={undo}
        title={isController ? 'Undo' : `Only ${controllerName ?? 'the controlling page'} can undo`}
      >
        <UndoIcon style={{ fontSize: 14 }} />
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: (canRedo && isController) ? 'pointer' : 'default', opacity: (canRedo && isController) ? 1 : 0.5 }}
        disabled={!canRedo || !isController}
        onClick={redo}
        title={isController ? 'Redo' : `Only ${controllerName ?? 'the controlling page'} can redo`}
      >
        <RedoIcon style={{ fontSize: 14 }} />
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: isController ? 'var(--ok)' : 'inherit', cursor: 'pointer' }}
        onClick={() => setControlOpen(o => !o)}
        title="Who can undo/redo across your open pages"
      >
        {isController ? <LockOpenOutlinedIcon style={{ fontSize: 14 }} /> : <LockOutlinedIcon style={{ fontSize: 14 }} />}
        {isController ? 'You have control' : `Controlled by ${controllerName ?? 'nobody'}`}
      </button>

      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: loaded ? 'pointer' : 'default', opacity: loaded ? 1 : 0.5 }}
        disabled={!loaded}
        onClick={toggleAgenda}
        title="Reminders and clock"
      >
        <AccessTimeOutlinedIcon style={{ fontSize: 14 }} />
        Day {clock.days}, {String(clock.hours).padStart(2, '0')}:{String(clock.minutes).padStart(2, '0')}
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: loaded ? 'pointer' : 'default', opacity: loaded ? 1 : 0.5 }}
        disabled={!loaded}
        onClick={() => advance(1, 'round')}
        title="Advance 1 round"
      >
        +1 round
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: loaded ? 'pointer' : 'default', opacity: loaded ? 1 : 0.5 }}
        disabled={!loaded}
        onClick={() => advance(1, 'hour')}
        title="Advance 1 hour"
      >
        +1 hour
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: loaded ? 'pointer' : 'default', opacity: loaded ? 1 : 0.5 }}
        disabled={!loaded}
        onClick={() => advance(1, 'day')}
        title="Advance 1 day"
      >
        +1 day
      </button>

      <div style={{ flex: 1 }} />
      <div style={itemStyle}>
        <FiberManualRecordIcon style={{ fontSize: 10, color: loaded ? 'var(--ok)' : 'var(--warn)' }} />
        {loaded ? 'World Loaded' : 'Loading…'}
      </div>

      {agendaOpen && agenda && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 10, marginBottom: 4,
          width: 320, maxHeight: 320, overflow: 'auto',
          background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderRadius: 4,
          padding: 8, fontSize: 12,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Upcoming</div>
          {agenda.upcoming.length === 0 && <div style={{ color: 'var(--fg-secondary)' }}>Nothing scheduled.</div>}
          {agenda.upcoming.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <FiberManualRecordIcon style={{ fontSize: 8, color: severityColor[r.severity] }} />
              <span style={{ flex: 1 }}>{r.label}</span>
              <span style={{ color: 'var(--fg-secondary)' }}>in {r.fireAtRound - agenda.now} rounds</span>
            </div>
          ))}

          <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>Fired</div>
          {agenda.fired.length === 0 && <div style={{ color: 'var(--fg-secondary)' }}>Nothing waiting on you.</div>}
          {agenda.fired.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <FiberManualRecordIcon style={{ fontSize: 8, color: severityColor[r.severity] }} />
              <span style={{ flex: 1 }}>{r.label}</span>
              <button
                style={{ background: 'transparent', border: '1px solid var(--bd-soft)', borderRadius: 3, color: 'inherit', cursor: 'pointer', padding: '1px 6px' }}
                onClick={() => ack(r.id)}
              >
                Acknowledge
              </button>
            </div>
          ))}
        </div>
      )}

      {controlOpen && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 90, marginBottom: 4,
          width: 220, background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)', borderRadius: 4,
          padding: 8, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ color: 'var(--fg-secondary)' }}>
            {isController ? 'You control Undo/Redo across your open pages.' : `${controllerName ?? 'Nobody'} controls Undo/Redo.`}
          </div>
          {!isController && (
            <button
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 3, padding: '4px 8px', cursor: 'pointer' }}
              onClick={() => { claimControl(); setControlOpen(false); }}
            >
              Take control
            </button>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--fg-secondary)' }}>
            Your name (shown to other pages)
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onBlur={saveDisplayName}
              onKeyDown={e => { if (e.key === 'Enter') { saveDisplayName(); setControlOpen(false); } }}
              style={{ background: 'var(--bg-editor)', border: '1px solid var(--bd-soft)', borderRadius: 3, color: 'inherit', padding: '3px 6px', fontFamily: 'var(--font-mono)' }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
