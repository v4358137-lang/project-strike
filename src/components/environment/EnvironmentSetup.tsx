import { Environment, Sky } from '@react-three/drei';

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
      
      {/* 
        HDRI Environment for realistic reflections. 
        Will use a default preset but can be customized later.
      */}
      <Environment preset="city" />
      
      {/* Basic volumetric fog for cinematic feel */}
      <fog attach="fog" args={['#87CEEB', 20, 100]} />
    </>
  );
};
