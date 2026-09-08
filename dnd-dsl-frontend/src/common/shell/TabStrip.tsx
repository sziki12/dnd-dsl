import { useContext } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import { DslContext } from '../../contexts/DslContext';

export default function TabStrip() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { locationName } = useParams();
  const { worldState } = useContext(DslContext);

  const fallbackLocation = locationName ?? worldState?.World?.locations[0]?.name;
  const isLocationRoute = pathname.startsWith('/location/');

  const tabs = [
    { id: 'home', icon: <HomeOutlinedIcon style={{ fontSize: 14 }} />, label: 'Home', active: pathname === '/', onClick: () => navigate('/'), disabled: false },
    {
      id: 'location',
      icon: <RoomOutlinedIcon style={{ fontSize: 14 }} />,
      label: isLocationRoute && locationName ? `${locationName}.loc.dnd` : 'Location',
      active: isLocationRoute,
      onClick: () => fallbackLocation && navigate(`/location/${encodeURIComponent(fallbackLocation)}`),
      disabled: !fallbackLocation,
    },
    { id: 'npcs', icon: <PersonOutlineIcon style={{ fontSize: 14 }} />, label: 'NPCs', active: pathname === '/npcs', onClick: () => navigate('/npcs'), disabled: !worldState },
    { id: 'editor', icon: <CodeOutlinedIcon style={{ fontSize: 14 }} />, label: 'Editor', active: pathname === '/editor', onClick: () => navigate('/editor'), disabled: false },
  ];

  return (
    <div className="shell-tabstrip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          onClick={tab.disabled ? undefined : tab.onClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '0 14px', fontSize: 13,
            color: tab.active ? 'var(--fg-primary)' : 'var(--fg-secondary)',
            background: tab.active ? 'var(--bg-tab-active)' : 'var(--bg-tab-inact)',
            borderRight: '1px solid var(--bd-divider)',
            borderTop: tab.active ? '1px solid var(--accent)' : '1px solid transparent',
            opacity: tab.disabled ? 0.4 : 1,
            cursor: tab.disabled ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </div>
      ))}
      <div style={{ flex: 1, background: 'var(--bg-titlebar)', borderBottom: '1px solid var(--bd-divider)' }} />
    </div>
  );
}
