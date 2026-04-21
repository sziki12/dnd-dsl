import React, { useContext, useEffect, useRef } from 'react';
import { MonacoContext } from '../contexts/MonacoContext';


export const DslEditor = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoContext = useContext(MonacoContext);

  useEffect(() => {
    if (containerRef.current) {
        monacoContext.startEditor(containerRef.current);
    }
    return () => {
        monacoContext.disposeEditor();
    }
  }, [containerRef.current]);

  return <div ref={containerRef} style={{ height: '500px' }} />;
};