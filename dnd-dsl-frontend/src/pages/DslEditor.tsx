import React, { useContext, useEffect, useRef } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';
import { EditorContext } from '../contexts/EditorContext';

export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);
  const editorContext = useContext(EditorContext);

  useEffect(() => {
    if(!editorContext.loaded)
      return

    if (containerRef.current) {
        monacoContext.startEditor(containerRef.current);
    }
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            monacoContext.saveFile();
        }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        monacoContext.disposeEditor();
    };
  }, [editorContext.loaded]);

  return <div ref={containerRef} className='h-screen' />;
};