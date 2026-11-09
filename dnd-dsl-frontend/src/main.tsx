//import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

import '@xyflow/react/dist/base.css';
import '@xyflow/react/dist/style.css';
import './index.css';
import './theme/darkplus.css';
import { applyKindColorVars } from './common/kind-colors';

applyKindColorVars();

createRoot(document.getElementById('root')!).render(
  //<StrictMode>
    <App />
  //</StrictMode>,
)
