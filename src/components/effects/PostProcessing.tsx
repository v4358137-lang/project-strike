/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { EffectComposer, Bloom, N8AO, ToneMapping } from '@react-three/postprocessing';
/* eslint-enable @typescript-eslint/ban-ts-comment */
import { useSettingsStore } from '../../store/useSettingsStore';

export const PostProcessing = () => {
  const { graphicsQuality } = useSettingsStore();

  if (graphicsQuality === 'low') {
    return null; // Skip post processing for maximum performance
  }

  return (
    <EffectComposer disableNormalPass multisampling={8}>
      {/* Ambient Occlusion for highly realistic shadowing in corners/crevices */}
      {(graphicsQuality === 'high' || graphicsQuality === 'ultra') ? (
        <N8AO aoRadius={3} intensity={2} halfRes={false} color="#000000" />
      ) : null}
      
      {/* High Quality Bloom for realistic lighting bleeding */}
      <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} intensity={1.5} mipmapBlur />

      {/* Tone mapping for realistic colors */}
      <ToneMapping />
    </EffectComposer>
  );
};
