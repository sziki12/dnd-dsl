import { useContext, type ReactNode } from 'react';
import { DslContext } from '../../contexts/DslContext';
import { Hint, panel } from './file-ui';
import FolderBrowser from './FolderBrowser';
import { WorldForm, WorldList } from './world-picker';

const noop = () => undefined;
const allow = () => true;

function Centered({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 60 }}>
      <div style={{ ...panel, width: 520, maxWidth: '90%', padding: 16 }}>
        {title && <div style={{ fontWeight: 600, color: 'var(--fg-bright)', marginBottom: 12 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

/**
 * What a page shows until there is a world to show: the server is not reached yet, no source folder is chosen,
 * or the folder has no world open. Choosing arrives through the server's broadcasts, so nothing here has to navigate.
 */
export default function NoWorldGate({ children }: { children: ReactNode }) {
  const { sourceFolder, adventure, world } = useContext(DslContext);

  if (sourceFolder === undefined) return <Centered><Hint>Connecting to the server...</Hint></Centered>;

  if (sourceFolder === null) {
    return (
      <Centered title="Choose the folder for your adventures">
        <Hint>
          It holds one folder per adventure with the worlds inside. Pick an existing one, or type a new path to create it.
          You can change it later from the File menu.
        </Hint>
        <FolderBrowser onDone={noop} />
      </Centered>
    );
  }

  if (!adventure || !world) {
    return (
      <Centered title="Open a world">
        <Hint>No world is open in {sourceFolder}.</Hint>
        <WorldList onDone={noop} confirmDiscard={allow} />
        <div style={{ borderTop: '1px solid var(--bd-soft)', margin: '12px 0' }} />
        <div style={{ fontWeight: 600, color: 'var(--fg-bright)', marginBottom: 8 }}>Or start a new one</div>
        <WorldForm mode="new" onDone={noop} confirmDiscard={allow} />
      </Centered>
    );
  }

  return <>{children}</>;
}
