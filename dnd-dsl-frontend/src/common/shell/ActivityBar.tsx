import { useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import RoomOutlinedIcon from '@mui/icons-material/RoomOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import TerminalOutlinedIcon from '@mui/icons-material/TerminalOutlined';
import { DslContext } from '../../contexts/DslContext';
import { locationRoute } from '../location-identity';
import { useLocationRoute } from '../useLocationIndex';

export default function ActivityBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const locationNames = useLocationRoute();
  const { worldState } = useContext(DslContext);

  const firstLocation = worldState?.World?.locations[0]?.name;
  const fallbackLocation = locationNames ?? (firstLocation === undefined ? undefined : [firstLocation]);

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
      onClick: () => fallbackLocation && navigate(locationRoute(fallbackLocation)),
      disabled: !fallbackLocation,
    },
    {
      id: 'map',
      icon: <MapOutlinedIcon />,
      label: 'World map',
      active: pathname === '/map',
      onClick: () => navigate('/map'),
      disabled: !worldState,
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
      id: 'factions',
      icon: <GroupsOutlinedIcon />,
      label: 'Factions',
      active: pathname === '/factions',
      onClick: () => navigate('/factions'),
      disabled: !worldState,
    },
    {
      id: 'quests',
      icon: <FlagOutlinedIcon />,
      label: 'Quests',
      active: pathname === '/quests' || pathname.startsWith('/quests/'),
      onClick: () => navigate('/quests'),
      disabled: !worldState,
    },
    {
      id: 'events',
      icon: <BoltOutlinedIcon />,
      label: 'Events',
      active: pathname === '/events' || pathname.startsWith('/events/'),
      onClick: () => navigate('/events'),
      disabled: !worldState,
    },
    {
      id: 'script',
      icon: <TerminalOutlinedIcon />,
      label: 'Script',
      active: pathname === '/script',
      onClick: () => navigate('/script'),
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
