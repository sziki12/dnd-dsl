import { BrowserRouter, Route, Routes } from 'react-router-dom';
import LocationView from './pages/LocationView';
import { DslEditor } from './pages/DslEditor';
import { ContextWrapper } from './contexts/ContextWrapper';

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

function App() {
  return (
    <ContextWrapper>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/location" element={<LocationView />} />
          <Route path="/editor" element={<DslEditor />} />
        </Routes>
      </BrowserRouter>
    </ContextWrapper>
  );
}

export default App
