import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { DslContext } from '../../contexts/DslContext';

const itemStyle: React.CSSProperties = {
  padding: '0 10px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: '100%',
};

export default function StatusBar() {
  const { adventure, world, worldState, canUndo, canRedo, undo, redo } = useContext(DslContext);
  const { locationName } = useParams();

  const loaded = worldState !== undefined;

  return (
    <div className="shell-statusbar">
      <div style={itemStyle}>
        {adventure} / {world}
        {locationName && ` · ${locationName}`}
      </div>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: canUndo ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.5 }}
        disabled={!canUndo}
        onClick={undo}
        title="Undo"
      >
        <UndoIcon style={{ fontSize: 14 }} />
      </button>
      <button
        style={{ ...itemStyle, background: 'transparent', border: 0, color: 'inherit', cursor: canRedo ? 'pointer' : 'default', opacity: canRedo ? 1 : 0.5 }}
        disabled={!canRedo}
        onClick={redo}
        title="Redo"
      >
        <RedoIcon style={{ fontSize: 14 }} />
      </button>
      <div style={{ flex: 1 }} />
      <div style={itemStyle}>
        <FiberManualRecordIcon style={{ fontSize: 10, color: loaded ? 'var(--ok)' : 'var(--warn)' }} />
        {loaded ? 'World Loaded' : 'Loading…'}
      </div>
    </div>
  );
}
