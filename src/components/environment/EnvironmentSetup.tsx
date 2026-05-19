import { Sky } from '@react-three/drei';

export const EnvironmentSetup = () => {
  return (
    <>
      <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
      <ambientLight intensity={0.2} />
      <directionalLight
        castShadow
        position={[100, 20, 100]}
        intensity={1.5}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      
      <hemisphereLight color="#ffffff" groundColor="#444444" intensity={0.4} />
      <fog attach="fog" args={['#0a0f1a', 20, 150]} />
    </>
  );
};
