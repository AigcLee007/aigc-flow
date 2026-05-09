import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Send, X } from 'lucide-react';
import { MultiAngleThreeScene } from './MultiAngleThreeScene';
import { getImageEditRetryMessage } from '../utils/imageEditStatus';

export type MultiAngleId = 'front' | 'left45' | 'right45' | 'left90' | 'right90' | 'back' | 'top' | 'low';

interface ImageMultiAngleOverlayProps {
  imageUrl: string;
  anchorRect?: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
  onConfirm: (payload: {
    prompt: string;
    angleId: MultiAngleId;
    angleLabel: string;
    mode: 'subject' | 'camera';
    rotation: number;
    tilt: number;
    zoom: number;
    zoomLabel: string;
  }) => Promise<void> | void;
  onCancel: () => void;
}

const angleOptions: Array<{
  id: MultiAngleId;
  label: string;
  short: string;
  promptHint: string;
  rotation: number;
  tilt: number;
}> = [
  { id: 'front', label: '正面', short: '正', promptHint: 'front view', rotation: 0, tilt: 0 },
  { id: 'left45', label: '左侧 45°', short: '左45', promptHint: '45-degree left side view', rotation: -45, tilt: 0 },
  { id: 'right45', label: '右侧 45°', short: '右45', promptHint: '45-degree right side view', rotation: 45, tilt: 0 },
  { id: 'left90', label: '左侧 90°', short: '左90', promptHint: '90-degree left side profile view', rotation: -90, tilt: 0 },
  { id: 'right90', label: '右侧 90°', short: '右90', promptHint: '90-degree right side profile view', rotation: 90, tilt: 0 },
  { id: 'back', label: '背面', short: '背', promptHint: 'back view', rotation: 90, tilt: 0 },
  { id: 'top', label: '俯视', short: '俯', promptHint: 'top-down overhead view', rotation: 0, tilt: 60 },
  { id: 'low', label: '仰视', short: '仰', promptHint: 'low-angle upward view', rotation: 0, tilt: -30 },
];

const zoomStops = [0, 50, 100];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snapToNearest = (value: number, options: number[]) =>
  options.reduce((best, item) => (Math.abs(item - value) < Math.abs(best - value) ? item : best), options[0]);

const getZoomLabel = (zoom: number) => {
  if (zoom <= 25) return '特写';
  if (zoom >= 75) return '广角';
  return '中等';
};

const buildPrompt = (
  angle: (typeof angleOptions)[number],
  detail: string,
  transform: { mode: 'subject' | 'camera'; rotation: number; tilt: number; zoom: number },
) => [
  `Generate the same subject from a ${angle.promptHint}.`,
  `Use ${transform.mode === 'subject' ? 'subject transform' : 'camera transform'} controls: rotation ${Math.round(transform.rotation)} degrees, tilt ${Math.round(transform.tilt)} degrees, framing ${getZoomLabel(transform.zoom)}.`,
  'Preserve the subject identity, outfit, material, color palette, lighting style, and visual quality.',
  'Keep the output believable as a consistent alternate camera angle.',
  detail.trim(),
].filter(Boolean).join(' ');

export const ImageMultiAngleOverlay: React.FC<ImageMultiAngleOverlayProps> = ({ imageUrl, anchorRect, onConfirm, onCancel }) => {
  const [selectedAngle, setSelectedAngle] = useState<MultiAngleId>('left45');
  const [mode, setMode] = useState<'subject' | 'camera'>('subject');
  const [rotation, setRotation] = useState(-45);
  const [tilt, setTilt] = useState(0);
  const [zoom, setZoom] = useState(50);
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const activeAngle = useMemo(() => angleOptions.find((item) => item.id === selectedAngle) || angleOptions[0], [selectedAngle]);
  const prompt = useMemo(() => buildPrompt(activeAngle, detail, { mode, rotation, tilt, zoom }), [activeAngle, detail, mode, rotation, tilt, zoom]);

  const selectAngle = useCallback((angleId: MultiAngleId) => {
    const nextAngle = angleOptions.find((item) => item.id === angleId) || angleOptions[0];
    setSelectedAngle(nextAngle.id);
    setRotation(clamp(nextAngle.rotation, -90, 90));
    setTilt(clamp(nextAngle.tilt, -30, 60));
  }, []);

  const nudge = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (direction === 'left') setRotation((value) => clamp(value - 15, -90, 90));
    if (direction === 'right') setRotation((value) => clamp(value + 15, -90, 90));
    if (direction === 'up') setTilt((value) => clamp(value + 15, -30, 60));
    if (direction === 'down') setTilt((value) => clamp(value - 15, -30, 60));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage('');
    try {
      await onConfirm({ prompt, angleId: activeAngle.id, angleLabel: activeAngle.label, mode, rotation, tilt, zoom, zoomLabel: getZoomLabel(zoom) });
    } catch (error: unknown) {
      setErrorMessage(getImageEditRetryMessage(error, '多角度提交失败'));
      setSubmitting(false);
    }
  }, [activeAngle, mode, onConfirm, prompt, rotation, submitting, tilt, zoom]);

  const reset = () => {
    selectAngle('left45');
    setMode('subject');
    setZoom(50);
    setDetail('');
  };
  const anchoredPanelStyle = useMemo(() => getAnchoredPanelStyle(anchorRect, 640, 386), [anchorRect]);

  return createPortal(
    <div className="nodrag nopan nowheel" style={overlayStyle} onMouseDown={onCancel}>
      <div style={{ ...panelStyle, ...anchoredPanelStyle }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" style={closeButtonStyle} onClick={onCancel} title="关闭"><X size={20} /></button>

        <div style={headerBarStyle}>
          <div style={titleStyle}>拖拽方块调整角度</div>
          <button type="button" style={resetButtonStyle} onClick={reset}><RefreshCw size={13} />重置</button>
        </div>

        <div style={stageStyle}>
          <div style={modeSwitchStyle}>
            <button type="button" style={mode === 'subject' ? activeModeStyle : modeButtonStyle} onClick={() => setMode('subject')}>主体</button>
            <button type="button" style={mode === 'camera' ? activeModeStyle : modeButtonStyle} onClick={() => setMode('camera')}>摄像头</button>
          </div>

          <div style={sceneBoxStyle}>
            <Suspense fallback={<div style={threeFallbackStyle}>加载 3D 预览...</div>}>
              <MultiAngleThreeScene
                imageUrl={imageUrl}
                mode={mode}
                rotation={rotation}
                tilt={tilt}
                zoom={zoom}
                onDrag={(deltaX, deltaY) => {
                  setRotation((value) => clamp(value + deltaX * 0.45, -90, 90));
                  setTilt((value) => clamp(value + deltaY * 0.45, -30, 60));
                }}
              />
            </Suspense>
            {mode === 'camera' && (
              <div style={nudgeWrapStyle}>
                <button type="button" style={{ ...nudgeButtonStyle, top: 0, left: '50%', transform: 'translate(-50%, -50%)' }} onClick={() => nudge('up')}><ArrowUp size={13} /></button>
                <button type="button" style={{ ...nudgeButtonStyle, bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' }} onClick={() => nudge('down')}><ArrowDown size={13} /></button>
                <button type="button" style={{ ...nudgeButtonStyle, left: 0, top: '50%', transform: 'translate(-50%, -50%)' }} onClick={() => nudge('left')}><ArrowLeft size={13} /></button>
                <button type="button" style={{ ...nudgeButtonStyle, right: 0, top: '50%', transform: 'translate(50%, -50%)' }} onClick={() => nudge('right')}><ArrowRight size={13} /></button>
              </div>
            )}
            <div style={angleBadgeStyle}>{activeAngle.label}</div>
          </div>
        </div>

        <div style={controlStyle}>
          <div style={sectionTitleStyle}>视角</div>
          <div style={angleChipGridStyle}>
            {angleOptions.map((angle) => (
              <button key={angle.id} type="button" style={angle.id === selectedAngle ? activeAngleChipStyle : angleChipStyle} onClick={() => selectAngle(angle.id)}>
                {angle.short}
              </button>
            ))}
          </div>

          <div style={sectionTitleStyle}>控制</div>
          <div style={controlGroupStyle}>
            <ControlSlider label="旋转" value={rotation} min={-90} max={90} suffix="°" onChange={(value) => setRotation(clamp(value, -90, 90))} />
            <ControlSlider label="倾斜" value={tilt} min={-30} max={60} suffix="°" onChange={(value) => setTilt(clamp(value, -30, 60))} />
            <ControlSlider label="缩放" value={zoom} min={0} max={100} suffix={getZoomLabel(zoom)} stops={zoomStops} onChange={(value) => setZoom(snapToNearest(value, zoomStops))} />
          </div>

          <div style={footerRowStyle}>
            <textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="可选：补充背景、构图、镜头距离" style={textareaStyle} />
            <button type="button" style={submitRowStyle} disabled={submitting} onClick={handleConfirm}>
              <span style={pointsStyle}>◎ 20</span>
              <span style={submitButtonStyle}>{submitting ? '...' : <Send size={18} />}</span>
            </button>
          </div>
          {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
};

const ControlSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  stops?: number[];
  onChange: (value: number) => void;
}> = ({ label, value, min, max, suffix, stops = [], onChange }) => (
  <div style={sliderLineStyle}>
    <span style={sliderTextStyle}>{label}</span>
    <div style={{ position: 'relative', display: 'grid', alignItems: 'center' }}>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} style={rangeStyle} />
      {stops.length > 0 && (
        <div style={controlStopsStyle}>
          {stops.map((stop) => <span key={stop} style={{ ...controlStopStyle, left: `${((stop - min) / (max - min)) * 100}%`, opacity: stop === value ? 0.9 : 0.32 }} />)}
        </div>
      )}
    </div>
    <span style={sliderValueStyle}>{suffix.includes('°') ? `${Math.round(value)}${suffix}` : suffix}</span>
  </div>
);

const getAnchoredPanelStyle = (
  anchorRect: ImageMultiAngleOverlayProps['anchorRect'],
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

const overlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.02)', pointerEvents: 'auto' };
const panelStyle: React.CSSProperties = { position: 'relative', width: 'min(640px, calc(100vw - 32px))', height: 386, boxSizing: 'border-box', overflow: 'hidden', display: 'grid', gridTemplateColumns: '304px 1fr', gridTemplateRows: '32px 1fr', gap: '8px 16px', padding: 12, borderRadius: 16, background: 'rgba(31,31,31,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 22px 64px rgba(0,0,0,0.48)', color: '#f8fafc' };
const closeButtonStyle: React.CSSProperties = { position: 'absolute', top: 14, right: 14, width: 30, height: 30, border: 'none', borderRadius: '50%', background: 'transparent', color: 'rgba(248,250,252,0.52)', display: 'grid', placeItems: 'center', cursor: 'pointer', zIndex: 4 };
const headerBarStyle: React.CSSProperties = { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 36px 0 4px' };
const stageStyle: React.CSSProperties = { position: 'relative', minHeight: 0, borderRadius: 12, padding: '44px 10px 10px', overflow: 'hidden', background: 'linear-gradient(145deg, #292929, #232323)', border: '1px solid rgba(255,255,255,0.08)' };
const titleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 900 };
const resetButtonStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 999, background: 'transparent', color: 'rgba(248,250,252,0.46)', padding: '6px 8px', cursor: 'pointer', fontWeight: 800, fontSize: 12 };
const modeSwitchStyle: React.CSSProperties = { position: 'absolute', top: 10, left: 14, right: 14, display: 'flex', gap: 3, padding: 3, borderRadius: 10, background: 'rgba(255,255,255,0.07)', zIndex: 3 };
const modeButtonStyle: React.CSSProperties = { flex: 1, border: 'none', borderRadius: 8, background: 'transparent', color: 'rgba(248,250,252,0.56)', padding: '6px 0', fontSize: 13, fontWeight: 900, cursor: 'pointer' };
const activeModeStyle: React.CSSProperties = { ...modeButtonStyle, color: '#fff', background: 'rgba(255,255,255,0.17)' };
const sceneBoxStyle: React.CSSProperties = { position: 'relative', width: 260, height: 226, margin: '0 auto', display: 'grid', placeItems: 'center', borderRadius: 12, background: 'rgba(0,0,0,0.12)' };
const threeFallbackStyle: React.CSSProperties = { width: 230, height: 196, borderRadius: 12, display: 'grid', placeItems: 'center', color: 'rgba(248,250,252,0.58)', fontSize: 13, fontWeight: 800, background: 'rgba(255,255,255,0.04)' };
const nudgeWrapStyle: React.CSSProperties = { position: 'absolute', left: 26, right: 26, top: 30, bottom: 30, pointerEvents: 'none' };
const nudgeButtonStyle: React.CSSProperties = { position: 'absolute', width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e5e7eb', display: 'grid', placeItems: 'center', cursor: 'pointer', pointerEvents: 'auto' };
const angleBadgeStyle: React.CSSProperties = { position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', borderRadius: 999, padding: '5px 13px', background: 'rgba(255,255,255,0.08)', color: '#e5e7eb', fontSize: 12, fontWeight: 850 };
const controlStyle: React.CSSProperties = { position: 'relative', minHeight: 0, padding: '2px 0 0', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' };
const angleChipGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 };
const angleChipStyle: React.CSSProperties = { border: '1px solid rgba(255,255,255,0.055)', borderRadius: 9, background: 'rgba(255,255,255,0.045)', color: 'rgba(248,250,252,0.62)', padding: '7px 0', cursor: 'pointer', fontSize: 12, fontWeight: 850 };
const activeAngleChipStyle: React.CSSProperties = { ...angleChipStyle, color: '#e0f2fe', background: 'rgba(14,165,233,0.18)', borderColor: 'rgba(14,165,233,0.38)' };
const sectionTitleStyle: React.CSSProperties = { color: '#fff', fontWeight: 900, fontSize: 16 };
const controlGroupStyle: React.CSSProperties = { display: 'grid', gap: 6, padding: '0' };
const sliderLineStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '44px minmax(120px, 1fr) 56px', gap: 10, alignItems: 'center', minHeight: 27 };
const sliderTextStyle: React.CSSProperties = { color: '#a8b0bd', fontSize: 13, fontWeight: 850 };
const rangeStyle: React.CSSProperties = { width: '100%', height: 7, borderRadius: 999, accentColor: '#fff', cursor: 'pointer', background: 'linear-gradient(90deg, #3a3a3a, #efefef)' };
const controlStopsStyle: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: 16, height: 6, pointerEvents: 'none' };
const controlStopStyle: React.CSSProperties = { position: 'absolute', width: 3, height: 3, borderRadius: '50%', background: '#fff', transform: 'translateX(-50%)' };
const sliderValueStyle: React.CSSProperties = { textAlign: 'right', color: '#e0f2fe', fontSize: 14, fontWeight: 900, fontVariantNumeric: 'tabular-nums' };
const footerRowStyle: React.CSSProperties = { marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 78px', gap: 8, alignItems: 'center', minHeight: 44 };
const textareaStyle: React.CSSProperties = { height: 42, resize: 'none', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, background: 'rgba(255,255,255,0.04)', color: '#e5e7eb', outline: 'none', padding: '8px 10px', fontSize: 12, lineHeight: 1.32, fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const submitRowStyle: React.CSSProperties = { width: 78, height: 40, borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'radial-gradient(94% 150% at 50% 20%, #1a1a1a 0%, #626664 100%)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 4px 10px' };
const pointsStyle: React.CSSProperties = { fontSize: 13, fontWeight: 850 };
const submitButtonStyle: React.CSSProperties = { width: 31, height: 31, borderRadius: '50%', background: '#fff', color: '#111', display: 'grid', placeItems: 'center' };
const errorStyle: React.CSSProperties = { color: '#fecaca', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.24)', borderRadius: 12, padding: '8px 10px', fontSize: 12 };

