import { create } from 'zustand';
import { useEffect } from 'react';

interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  shoot: boolean;
  ads: boolean;
  reload: boolean;
  weapon1: boolean;
  weapon2: boolean;
}

export const useInputStore = create<InputState>(() => ({
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  crouch: false,
  shoot: false,
  ads: false,
  reload: false,
  weapon1: false,
  weapon2: false,
}));

const actionByKey: Record<string, keyof InputState> = {
  KeyW: 'forward',
  KeyS: 'backward',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint',
  ControlLeft: 'crouch',
  KeyR: 'reload',
  Digit1: 'weapon1',
  Digit2: 'weapon2',
};

export const KeyboardManager = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = actionByKey[e.code];
      if (action) useInputStore.setState({ [action]: true });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const action = actionByKey[e.code];
      if (action) useInputStore.setState({ [action]: false });
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) useInputStore.setState({ shoot: true });
      if (e.button === 2) useInputStore.setState({ ads: true });
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 0) useInputStore.setState({ shoot: false });
      if (e.button === 2) useInputStore.setState({ ads: false });
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return null;
};
