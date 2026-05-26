import React from 'react';
import { Window } from '@wailsio/runtime';

const TitleBar: React.FC = () => {
  const handleDrag = () => {
    Window.Drag();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '32px',
        zIndex: 1000,
      }}
      onMouseDown={handleDrag}
    />
  );
};

export default TitleBar;