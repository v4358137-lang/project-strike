import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

export const AudioSystem = () => {
  const { camera } = useThree();
  const listenerRef = useRef<THREE.AudioListener | null>(null);

  useEffect(() => {
    if (!listenerRef.current) {
      listenerRef.current = new THREE.AudioListener();
      camera.add(listenerRef.current);
    }
    
    return () => {
      if (listenerRef.current) {
        camera.remove(listenerRef.current);
      }
    };
  }, [camera]);

  // In the future, this system will load sounds and expose methods
  // to play positional audio on demand.
  
  return null;
};
