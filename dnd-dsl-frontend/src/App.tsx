import { BrowserRouter, Route, Routes } from 'react-router-dom';
import NpcsView from './pages/NpcsView';
import FactionsView from './pages/FactionsView';
import EventsView from './pages/EventsView';
import QuestsView from './pages/QuestsView';
import { ContextWrapper } from './contexts/ContextWrapper';
import { lazy, Suspense, type JSX, type ReactNode } from 'react';

// The map pages bring the graph library, the editor pages bring Monaco: neither is downloaded until visited.
const LocationView = lazy(() => import('./pages/LocationView'));
const WorldMapView = lazy(() => import('./pages/WorldMapView'));
const ScriptView = lazy(() => import('./pages/ScriptView'));
const DslEditor = lazy(() => import('./pages/DslEditor').then(m => ({ default: m.DslEditor })));
import PageWrapper from './common/PageWrapper';
import ReminderToast from './common/ReminderToast';
import CommandErrorToast from './common/CommandErrorToast';

//import '@xyflow/react/dist/style.css';


function Home() {
  return <h1>Home Page</h1>;
}

function About() {
  return <h1>About Page</h1>;
}

function Contact() {
  return <h1>Contact Page</h1>;
}

function createRoute({path, element, }:{path:string, element:JSX.Element})
{
  return  <Route path={path} element={<PageWrapper><Suspense fallback={null}>{element}</Suspense></PageWrapper>}  />
}

function App() {
  return (
    <ContextWrapper>
      <BrowserRouter>
        <Routes>
          {createRoute({path:"/", element:<Home />})}
          {createRoute({path:"/location/*", element:<LocationView />})}
          {createRoute({path:"/map", element:<WorldMapView />})}
          {createRoute({path:"/npcs", element:<NpcsView />})}
          {createRoute({path:"/factions", element:<FactionsView />})}
          {createRoute({path:"/quests", element:<QuestsView />})}
          {createRoute({path:"/quests/:questName", element:<QuestsView />})}
          {createRoute({path:"/events", element:<EventsView />})}
          {createRoute({path:"/events/:eventName", element:<EventsView />})}
          {createRoute({path:"/script", element:<ScriptView />})}
          {createRoute({path:"/editor", element:<DslEditor />})}
        </Routes>
      </BrowserRouter>
      <ReminderToast />
      <CommandErrorToast />
    </ContextWrapper>
  );
}

export default App
