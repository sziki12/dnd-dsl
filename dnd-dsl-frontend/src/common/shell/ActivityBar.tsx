import { useContext } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import { DslContext } from '../../contexts/DslContext';

export default function ActivityBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { locationName } = useParams();
  const { worldState } = useContext(DslContext);

  const fallbackLocation = locationName ?? worldState?.World?.locations[0]?.name;

  const items = [
    {
      id: 'home',
      icon: <HomeOutlinedIcon />,
      label: 'Home',
      active: pathname === '/',
      onClick: () => navigate('/'),
      disabled: false,
    },
    {
      id: 'locations',
      icon: <RoomOutlinedIcon />,
      label: 'Locations',
      active: pathname.startsWith('/location/'),
      onClick: () => fallbackLocation && navigate(`/location/${encodeURIComponent(fallbackLocation)}`),
      disabled: !fallbackLocation,
    },
    {
      id: 'npcs',
      icon: <PersonOutlineIcon />,
      label: 'NPCs',
      active: pathname === '/npcs',
      onClick: () => navigate('/npcs'),
      disabled: !worldState,
    },
    {
      id: 'editor',
      icon: <CodeOutlinedIcon />,
      label: 'Editor',
      active: pathname === '/editor',
      onClick: () => navigate('/editor'),
      disabled: false,
    },
  ];

  return (
    <div className="shell-activitybar">
      {items.map((item) => (
        <button
          key={item.id}
          title={item.label}
          disabled={item.disabled}
          onClick={item.onClick}
          style={{
            width: 'var(--activity-w)',
            height: 48,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: item.active ? 'var(--fg-bright)' : 'var(--fg-secondary)',
            position: 'relative',
            opacity: item.disabled ? 0.4 : 1,
            cursor: item.disabled ? 'default' : 'pointer',
          }}
        >
          {item.active && (
            <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--fg-bright)' }} />
          )}
          {item.icon}
        </button>
      ))}
    </div>
  );
}
