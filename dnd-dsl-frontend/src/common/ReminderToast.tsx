import { useContext } from 'react';
import { DslContext } from '../contexts/DslContext';

const severityColor = { info: 'var(--accent)', warning: 'var(--warn)', urgent: 'var(--error)' } as const;

export default function ReminderToast() {
  const { firedReminders, execute, clearFiredReminder } = useContext(DslContext);

  if (firedReminders.length === 0) return null;

  const dismiss = async (id: string) => {
    await execute({ type: 'ACK_REMINDER', reminderId: id });
    clearFiredReminder(id);
  };

  return (
    <div style={{
      position: 'fixed', bottom: 'calc(var(--status-h) + 12px)', right: 12, zIndex: 1000,
      display: 'flex', flexDirection: 'column', gap: 8, width: 280,
    }}>
      {firedReminders.map(r => (
        <div key={r.id} style={{
          background: 'var(--bg-panel)', border: '1px solid var(--bd-soft)',
          borderLeft: `3px solid ${severityColor[r.severity]}`, borderRadius: 4,
          padding: '8px 10px', fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--fg-primary)',
        }}>
          <div style={{ marginBottom: 6 }}>{r.label}</div>
          <button
            style={{
              background: 'transparent', border: '1px solid var(--bd-soft)', borderRadius: 3,
              color: 'inherit', cursor: 'pointer', padding: '2px 8px', fontSize: 11,
            }}
            onClick={() => dismiss(r.id)}
          >
            Acknowledge
          </button>
        </div>
      ))}
    </div>
  );
}
