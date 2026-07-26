import React, { useContext, useEffect, useRef } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';
import { FileContext } from '../contexts/FileContext';

export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);
  const fileContext = useContext(FileContext);

  useEffect(() => {
    if(!fileContext.loaded)
      return

    if (containerRef.current) {
        monacoContext.startEditor(containerRef.current);
    }
    console.log('Editor handleKeyDown registered');
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            e.stopPropagation();
            console.log('Ctrl+S pressed, saving file...');
            monacoContext.saveFile();
        }
    };
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        monacoContext.disposeEditor();
    };
  }, [fileContext.loaded]);

  return <div ref={containerRef} className='h-full w-full' />;
};