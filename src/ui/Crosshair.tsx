import { useInputStore } from '../store/useInputStore';

export const Crosshair = () => {
  const { shoot, sprint, ads } = useInputStore();
  
  const spread = ads ? 0 : shoot ? 12 : sprint ? 16 : 4;

  if (ads) return null; // Hide crosshair when aiming down sights

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
      <div className="relative">
        {/* Center Dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white/80 rounded-full" />
        
        {/* Top Line */}
        <div 
          className="absolute left-1/2 w-[2px] h-3 bg-white/80 transition-all duration-100"
          style={{ transform: `translate(-50%, -${spread + 12}px)` }}
        />
        {/* Bottom Line */}
        <div 
          className="absolute left-1/2 w-[2px] h-3 bg-white/80 transition-all duration-100"
          style={{ transform: `translate(-50%, ${spread}px)` }}
        />
        {/* Left Line */}
        <div 
          className="absolute top-1/2 h-[2px] w-3 bg-white/80 transition-all duration-100"
          style={{ transform: `translate(-${spread + 12}px, -50%)` }}
        />
        {/* Right Line */}
        <div 
          className="absolute top-1/2 h-[2px] w-3 bg-white/80 transition-all duration-100"
          style={{ transform: `translate(${spread}px, -50%)` }}
        />
      </div>
    </div>
  );
};
