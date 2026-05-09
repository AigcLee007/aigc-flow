import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, RotateCcw, SunMedium, Thermometer, X } from 'lucide-react';
import { LightingThreeScene } from './LightingThreeScene';
import { getImageEditRetryMessage } from '../utils/imageEditStatus';

export type LightDirection = 'left' | 'top' | 'right' | 'front' | 'bottom' | 'back';

interface ImageLightingOverlayProps {
  imageUrl: string;
  anchorRect?: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
  onConfirm: (payload: {
    prompt: string;
    brightness: number;
    colorTemperature: number;
    direction: LightDirection;
    rimLight: boolean;
  }) => Promise<void> | void;
  onCancel: () => void;
}

type LightVector = { x: number; y: number; z: number };

const directionOptions: Array<{ id: LightDirection; label: string; vector: LightVector }> = [
  { id: 'left', label: '左侧', vector: { x: -0.95, y: 0, z: 0.22 } },
  { id: 'top', label: '顶部', vector: { x: 0, y: -0.95, z: 0.22 } },
  { id: 'right', label: '右侧', vector: { x: 0.95, y: 0, z: 0.22 } },
  { id: 'front', label: '前方', vector: { x: -0.42, y: 0.48, z: 0.76 } },
  { id: 'bottom', label: '底部', vector: { x: 0, y: 0.95, z: 0.22 } },
  { id: 'back', label: '后方', vector: { x: 0.42, y: 0.48, z: -0.76 } },
];

const brightnessStops = [10, 50, 100];
const colorTemperatureStops = [2000, 3000, 4000, 5600, 7000, 8000];

const normalizeVector = (vector: LightVector): LightVector => {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const snapToNearest = (value: number, options: number[]) =>
  options.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), options[0]);

const closestDirection = (vector: LightVector): LightDirection => {
  let best = directionOptions[0];
  let bestScore = -Infinity;
  directionOptions.forEach((item) => {
    const option = normalizeVector(item.vector);
    const score = option.x * vector.x + option.y * vector.y + option.z * vector.z;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });
  return best.id;
};

const getDirectionCopy = (direction: LightDirection) => {
  const map: Record<LightDirection, string> = {
    left: 'from the left side',
    top: 'from above',
    right: 'from the right side',
    front: 'from the front',
    bottom: 'from below',
    back: 'from behind',
  };
  return map[direction];
};

const getKelvinTone = (temperature: number) => {
  if (temperature <= 4300) return 'warm golden';
  if (temperature >= 6500) return 'cool daylight';
  return 'neutral studio';
};

export const ImageLightingOverlay: React.FC<ImageLightingOverlayProps> = ({ imageUrl, anchorRect, onConfirm, onCancel }) => {
  const [viewMode, setViewMode] = useState<'perspective' | 'front'>('front');
  const [brightness, setBrightness] = useState(50);
  const [colorTemperature, setColorTemperature] = useState(5600);
  const [direction, setDirection] = useState<LightDirection>('left');
  const [lightVector, setLightVector] = useState<LightVector>(normalizeVector(directionOptions[0].vector));
  const [rimLight, setRimLight] = useState(false);
  const [rimHintOpen, setRimHintOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const setDirectionWithVector = useCallback((nextDirection: LightDirection) => {
    const option = directionOptions.find((item) => item.id === nextDirection) || directionOptions[0];
    setDirection(nextDirection);
    setLightVector(normalizeVector(option.vector));
  }, []);

  const prompt = useMemo(() => {
    const intensity = brightness >= 85 ? 'strong' : brightness >= 45 ? 'balanced' : 'soft';
    const rim = rimLight
      ? ' Add rim light using a locked three-point back projection setup from behind the subject, with rear-left, rear-right, and rear-top accent lights to outline the subject edges without changing the main light direction.'
      : '';
    return [
      `Relight this image with ${intensity} ${getKelvinTone(colorTemperature)} light ${getDirectionCopy(direction)}.`,
      `Brightness ${brightness}%, color temperature ${colorTemperature}K.`,
      `Use a light position vector x=${lightVector.x.toFixed(2)}, y=${lightVector.y.toFixed(2)}, z=${lightVector.z.toFixed(2)}.`,
      'Preserve the original subject, identity, composition, background, and realism.',
      rim,
    ].filter(Boolean).join(' ');
  }, [brightness, colorTemperature, direction, lightVector, rimLight]);

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage('');
    try {
      await onConfirm({ prompt, brightness, colorTemperature, direction, rimLight });
    } catch (error: unknown) {
      setErrorMessage(getImageEditRetryMessage(error, '打光提交失败'));
      setSubmitting(false);
    }
  }, [brightness, colorTemperature, direction, onConfirm, prompt, rimLight, submitting]);

  const reset = () => {
    setBrightness(50);
    setColorTemperature(5600);
    setDirectionWithVector('left');
    setRimLight(false);
    setViewMode('front');
  };
  const anchoredPanelStyle = useMemo(() => getAnchoredPanelStyle(anchorRect, 720, 404), [anchorRect]);

  return createPortal(
    <div className="nodrag nopan nowheel" style={overlayStyle} onMouseDown={onCancel}>
      <div style={{ ...panelStyle, ...anchoredPanelStyle }} onMouseDown={(event) => event.stopPropagation()}>
        <div style={visualPanelStyle}>
          <div style={viewSwitchStyle}>
            <button type="button" style={viewMode === 'perspective' ? activeSegmentStyle : segmentStyle} onClick={() => setViewMode('perspective')}>透视</button>
            <button type="button" style={viewMode === 'front' ? activeSegmentStyle : segmentStyle} onClick={() => setViewMode('front')}>正面</button>
          </div>
          <div style={sceneShellStyle}>
            <Suspense fallback={<div style={threeFallbackStyle}>加载 3D 预览...</div>}>
              <LightingThreeScene
                imageUrl={imageUrl}
                brightness={brightness}
                colorTemperature={colorTemperature}
                viewMode={viewMode}
                lightVector={lightVector}
                onDragVector={(nextVector) => {
                  setLightVector(nextVector);
                  setDirection(closestDirection(nextVector));
                }}
              />
            </Suspense>
          </div>
          <div style={visualFooterStyle}>
            <span style={sourceBadgeStyle}>主光源</span>
            <button type="button" style={resetButtonStyle} onClick={reset}><RotateCcw size={13} />重置</button>
          </div>
        </div>

        <div style={controlPanelStyle}>
          <button type="button" style={closeButtonStyle} onClick={onCancel} title="关闭"><X size={20} /></button>
          <div style={headingStyle}>全局</div>
          <ControlSlider
            icon={<SunMedium size={15} />}
            label="亮度"
            value={brightness}
            min={10}
            max={100}
            unit="%"
            stops={brightnessStops}
            onChange={(value) => setBrightness(snapToNearest(value, brightnessStops))}
          />
          <ControlSlider
            icon={<Thermometer size={15} />}
            label="色温"
            value={colorTemperature}
            min={2000}
            max={8000}
            step={100}
            unit="K"
            warm
            stops={colorTemperatureStops}
            onChange={(value) => setColorTemperature(snapToNearest(value, colorTemperatureStops))}
          />

          <div style={separatorStyle} />
          <div style={headingStyle}>主光源</div>
          <div style={directionGridStyle}>
            {directionOptions.map((item) => (
              <button
                key={item.id}
                type="button"
                style={direction === item.id ? activeDirectionStyle : directionButtonStyle}
                onClick={() => setDirectionWithVector(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div style={separatorStyle} />
          <div style={rimRowStyle}>
            <div>
              <span style={rimTitleStyle}>轮廓光</span>
              <span
                style={hintWrapStyle}
                onMouseEnter={() => setRimHintOpen(true)}
                onMouseLeave={() => setRimHintOpen(false)}
              >
                <span style={hintDotStyle}>?</span>
                <span style={{ ...hintTooltipStyle, opacity: rimHintOpen ? 1 : 0, transform: rimHintOpen ? 'translateY(0)' : 'translateY(6px)' }}>轮廓光仅支持主光位于正位（前/左/右/顶/底）及 45° 标准光位，锁定为背部三点投射</span>
              </span>
            </div>
            <button type="button" style={rimLight ? switchOnStyle : switchStyle} onClick={() => setRimLight((value) => !value)} aria-label="切换轮廓光">
              <span style={rimLight ? switchKnobOnStyle : switchKnobStyle} />
            </button>
          </div>

          {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
          <button type="button" style={submitRowStyle} disabled={submitting} onClick={handleConfirm}>
            <span style={pointsStyle}>◎ 20</span>
            <span style={submitButtonStyle}>{submitting ? '...' : <ArrowUp size={21} />}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const ControlSlider: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  warm?: boolean;
  stops?: number[];
  onChange: (value: number) => void;
}> = ({ icon, label, value, min, max, step = 1, unit, warm, stops = [], onChange }) => (
  <div style={{ display: 'grid', gap: 8 }}>
    <div style={sliderHeaderStyle}><span style={labelWithIconStyle}>{icon}{label}</span></div>
    <div style={sliderRowStyle}>
      <div style={{ position: 'relative', display: 'grid', alignItems: 'center' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          style={{ ...rangeStyle, background: warm ? 'linear-gradient(90deg, #9a5d26, #f2d86b, #83c9d2)' : 'linear-gradient(90deg, #3a3a3a, #f8fafc)' }}
        />
        <div style={sliderStopsStyle}>
          {stops.map((stop) => (
            <span key={stop} style={{ ...sliderStopStyle, left: `${((stop - min) / (max - min)) * 100}%`, opacity: stop === value ? 0.9 : 0.32 }} />
          ))}
        </div>
      </div>
      <div style={valuePillStyle}>{value}<span style={{ color: 'rgba(248,250,252,0.56)' }}>{unit}</span></div>
    </div>
  </div>
);

const getAnchoredPanelStyle = (
  anchorRect: ImageLightingOverlayProps['anchorRect'],
  width: number,
  height: number,
): React.CSSProperties => {
  if (!anchorRect || typeof window === 'undefined') {
    return { position: 'relative' };
  }
  const margin = 16;
  const gap = 12;
  const preferredTop = anchorRect.bottom + gap;
  const top = Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin));
  const left = Math.max(
    margin,
    Math.min(window.innerWidth - width - margin, anchorRect.left + anchorRect.width / 2 - width / 2),
  );
  return {
    position: 'fixed',
    left,
    top,
    transform: 'none',
  };
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.02)',
  pointerEvents: 'auto',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(720px, calc(100vw - 32px))',
  height: 404,
  boxSizing: 'border-box',
  overflow: 'hidden',
  display: 'grid',
  gridTemplateColumns: '384px 1fr',
  gap: 14,
  padding: 12,
  borderRadius: 18,
  background: 'rgba(31,31,31,0.98)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 22px 64px rgba(0,0,0,0.48)',
  color: '#f8fafc',
};

const visualPanelStyle: React.CSSProperties = {
  position: 'relative',
  minHeight: 0,
  borderRadius: 13,
  overflow: 'hidden',
  background: 'linear-gradient(145deg, #2b2b2b, #242424)',
  border: '1px solid rgba(255,255,255,0.08)',
  display: 'grid',
  placeItems: 'center',
};

const sceneShellStyle: React.CSSProperties = {
  width: 318,
  height: 318,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.12), rgba(255,255,255,0.03) 44%, rgba(0,0,0,0.24) 100%)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.045), inset -28px 30px 80px rgba(0,0,0,0.24)',
};
const threeFallbackStyle: React.CSSProperties = {
  width: 280,
  height: 280,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  color: 'rgba(248,250,252,0.58)',
  fontSize: 13,
  fontWeight: 800,
  background: 'rgba(255,255,255,0.04)',
};

const viewSwitchStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 4,
  padding: 4,
  borderRadius: 999,
  background: 'rgba(255,255,255,0.08)',
  zIndex: 5,
};

const segmentStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: 'rgba(248,250,252,0.55)',
  padding: '5px 14px',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
};

const activeSegmentStyle: React.CSSProperties = { ...segmentStyle, background: 'rgba(255,255,255,0.18)', color: '#fff' };

const visualFooterStyle: React.CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const sourceBadgeStyle: React.CSSProperties = {
  padding: '6px 16px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.08)',
  color: '#e5e7eb',
  fontSize: 13,
  fontWeight: 800,
};

const resetButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: 'transparent',
  color: 'rgba(248,250,252,0.44)',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 750,
};

const controlPanelStyle: React.CSSProperties = { position: 'relative', minHeight: 0, padding: '6px 2px 54px 0', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'visible' };
const closeButtonStyle: React.CSSProperties = { position: 'absolute', top: -2, right: 0, width: 30, height: 30, border: 'none', borderRadius: '50%', background: 'transparent', color: 'rgba(248,250,252,0.54)', display: 'grid', placeItems: 'center', cursor: 'pointer' };
const headingStyle: React.CSSProperties = { fontSize: 17, fontWeight: 900, color: '#fff' };
const sliderHeaderStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#d1d5db' };
const labelWithIconStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7 };
const sliderRowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 86px', gap: 12, alignItems: 'center' };
const rangeStyle: React.CSSProperties = { width: '100%', height: 7, borderRadius: 999, outline: 'none', accentColor: '#f8fafc', cursor: 'pointer' };
const sliderStopsStyle: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: 17, height: 7, pointerEvents: 'none' };
const sliderStopStyle: React.CSSProperties = { position: 'absolute', width: 3, height: 3, borderRadius: '50%', background: '#fff', transform: 'translateX(-50%)' };
const valuePillStyle: React.CSSProperties = { height: 31, borderRadius: 10, background: 'rgba(255,255,255,0.075)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, color: '#fff', fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums' };
const separatorStyle: React.CSSProperties = { height: 1, background: 'rgba(255,255,255,0.08)', margin: '-1px 0 0' };
const directionGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 };
const directionButtonStyle: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.055)', borderRadius: 10, background: 'rgba(255,255,255,0.045)', color: 'rgba(248,250,252,0.62)', padding: '7px 0', cursor: 'pointer', fontSize: 13, fontWeight: 850 };
const activeDirectionStyle: React.CSSProperties = { ...directionButtonStyle, background: 'rgba(14,165,233,0.18)', borderColor: 'rgba(14,165,233,0.38)', color: '#e0f2fe' };
const rimRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 98, minHeight: 32 };
const rimTitleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 900 };
const hintWrapStyle: React.CSSProperties = { position: 'relative', display: 'inline-flex', alignItems: 'center' };
const hintDotStyle: React.CSSProperties = { display: 'inline-grid', placeItems: 'center', width: 14, height: 14, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.18)', marginLeft: 5, color: 'rgba(255,255,255,0.44)', fontSize: 10, cursor: 'help' };
const hintTooltipStyle: React.CSSProperties = { position: 'absolute', left: -170, bottom: 'calc(100% + 12px)', width: 430, borderRadius: 16, padding: '14px 18px', background: 'rgba(52,52,52,0.96)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 18px 50px rgba(0,0,0,0.42)', color: '#fff', fontSize: 15, lineHeight: 1.55, fontWeight: 850, opacity: 0, transform: 'translateY(6px)', transition: 'opacity 0.15s ease, transform 0.15s ease', pointerEvents: 'none', zIndex: 20 };
const switchStyle: React.CSSProperties = { width: 48, height: 28, borderRadius: 999, border: 'none', padding: 3, background: 'rgba(255,255,255,0.18)', cursor: 'pointer', display: 'flex', justifyContent: 'flex-start' };
const switchOnStyle: React.CSSProperties = { ...switchStyle, background: 'rgba(255,255,255,0.82)', justifyContent: 'flex-end' };
const switchKnobStyle: React.CSSProperties = { width: 22, height: 22, borderRadius: '50%', background: '#f8fafc', display: 'block' };
const switchKnobOnStyle: React.CSSProperties = { ...switchKnobStyle, background: '#0f172a' };
const submitRowStyle: React.CSSProperties = { position: 'absolute', right: 0, bottom: 0, width: 78, height: 40, borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'radial-gradient(94% 150% at 50% 20%, #1a1a1a 0%, #626664 100%)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 4px 10px', zIndex: 4 };
const pointsStyle: React.CSSProperties = { fontSize: 13, fontWeight: 850 };
const submitButtonStyle: React.CSSProperties = { width: 31, height: 31, borderRadius: '50%', background: '#fff', color: '#111', display: 'grid', placeItems: 'center' };
const errorStyle: React.CSSProperties = { color: '#fecaca', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.24)', borderRadius: 12, padding: '8px 10px', fontSize: 12 };

