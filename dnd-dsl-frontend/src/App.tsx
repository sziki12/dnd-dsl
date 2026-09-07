import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LocationView from './pages/LocationView';
import { DslEditor } from './pages/DslEditor';
import { ContextWrapper } from './contexts/ContextWrapper';
import type { JSX, ReactNode } from 'react';
import PageWrapper from './common/PageWrapper';
import ReminderToast from './common/ReminderToast';

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

function createRoute({path, name, element, }:{path:string, name:string, element:JSX.Element})
{
  return  <Route path={path} element={<PageWrapper name={name}>{element}</PageWrapper>}  />
}

function App() {
  return (
    <ContextWrapper>
      <BrowserRouter>
        <Routes>
          {createRoute({path:"/", element:<Home />, name:"Home Page"})}
          {createRoute({path:"/location/:locationName", element:<LocationView />, name:"Location Page"})}
          {createRoute({path:"/editor", element:<DslEditor />, name:"Editor Page"})}
        </Routes>
      </BrowserRouter>
      <ReminderToast />
    </ContextWrapper>
  );
}

export default App
