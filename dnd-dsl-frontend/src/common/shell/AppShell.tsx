import type { ReactNode } from 'react';
import TitleBar from './TitleBar';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import TabStrip from './TabStrip';
import StatusBar from './StatusBar';

export default function AppShell({ pageName, children }: { pageName: string; children: ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: 'var(--activity-w) var(--sidebar-w) 1fr',
        gridTemplateRows: 'var(--titlebar-h) 1fr var(--status-h)',
        gridTemplateAreas: '"titlebar titlebar titlebar" "activitybar sidebar main" "statusbar statusbar statusbar"',
        background: 'var(--bg-editor)',
      }}
    >
      <div style={{ gridArea: 'titlebar' }}>
        <TitleBar pageName={pageName} />
      </div>
      <div style={{ gridArea: 'activitybar' }}>
        <ActivityBar />
      </div>
      <div style={{ gridArea: 'sidebar', minHeight: 0 }}>
        <Sidebar />
      </div>
      <div style={{ gridArea: 'main', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <TabStrip />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {children}
        </div>
      </div>
      <div style={{ gridArea: 'statusbar' }}>
        <StatusBar />
      </div>
    </div>
  );
}
