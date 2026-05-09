import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Expand, Sparkles, X } from 'lucide-react';
import type { MaskOutputMode } from './ImageRepaintOverlay';
import { getImageEditRetryMessage } from '../utils/imageEditStatus';

export type OutpaintDirection = 'left' | 'right' | 'top' | 'bottom' | 'all';

interface ImageOutpaintOverlayProps {
  imageUrl: string;
  onConfirm: (payload: {
    image: string;
    mask: string;
    prompt: string;
    direction: OutpaintDirection;
    maskMode: MaskOutputMode;
  }) => Promise<void> | void;
  onCancel: () => void;
}

const directionOptions: Array<{
  id: OutpaintDirection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'left', label: '向左', icon: <ArrowLeft size={20} /> },
  { id: 'right', label: '向右', icon: <ArrowRight size={20} /> },
  { id: 'top', label: '向上', icon: <ArrowUp size={20} /> },
  { id: 'bottom', label: '向下', icon: <ArrowDown size={20} /> },
  { id: 'all', label: '四周', icon: <Expand size={20} /> },
];

const exportMaskDataUrl = (source: HTMLCanvasElement, mode: MaskOutputMode) => {
  if (mode === 'transparent-edit') return source.toDataURL('image/png');

  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const srcCtx = source.getContext('2d');
  const outCtx = out.getContext('2d');
  if (!srcCtx || !outCtx) return source.toDataURL('image/png');

  const src = srcCtx.getImageData(0, 0, source.width, source.height);
  const dst = outCtx.createImageData(source.width, source.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const isEditable = src.data[i + 3] < 8;
    const value = isEditable ? 255 : 0;
    dst.data[i] = value;
    dst.data[i + 1] = value;
    dst.data[i + 2] = value;
    dst.data[i + 3] = 255;
  }
  outCtx.putImageData(dst, 0, 0);
  return out.toDataURL('image/png');
};

export const ImageOutpaintOverlay: React.FC<ImageOutpaintOverlayProps> = ({
  imageUrl,
  onConfirm,
  onCancel,
}) => {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportImageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exportMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [direction, setDirection] = useState<OutpaintDirection>('all');
  const [maskMode, setMaskMode] = useState<MaskOutputMode>('transparent-edit');
  const [expandRatio, setExpandRatio] = useState(0.32);
  const [prompt, setPrompt] = useState('Extend the image naturally. Preserve the subject, lighting, perspective, and style.');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const layout = useMemo(() => {
    const width = imageSize.width;
    const height = imageSize.height;
    const expandX = Math.round(width * expandRatio);
    const expandY = Math.round(height * expandRatio);
    const left = direction === 'left' || direction === 'all' ? expandX : 0;
    const right = direction === 'right' || direction === 'all' ? expandX : 0;
    const top = direction === 'top' || direction === 'all' ? expandY : 0;
    const bottom = direction === 'bottom' || direction === 'all' ? expandY : 0;

    return {
      width: width + left + right,
      height: height + top + bottom,
      imageX: left,
      imageY: top,
      imageWidth: width,
      imageHeight: height,
    };
  }, [direction, expandRatio, imageSize]);

  const displaySize = useMemo(() => {
    if (!layout.width || !layout.height) return { width: 0, height: 0 };
    const maxWidth = Math.min(window.innerWidth * 0.84, 1180);
    const maxHeight = Math.min(window.innerHeight * 0.68, 720);
    const scale = Math.min(maxWidth / layout.width, maxHeight / layout.height, 1.6);
    return {
      width: Math.max(340, Math.round(layout.width * scale)),
      height: Math.max(240, Math.round(layout.height * scale)),
    };
  }, [layout.height, layout.width]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageSize({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const renderCanvases = useCallback(() => {
    const img = imageRef.current;
    const preview = previewCanvasRef.current;
    const exportImage = exportImageCanvasRef.current;
    const exportMask = exportMaskCanvasRef.current;
    if (!img || !preview || !exportImage || !exportMask || !layout.width || !layout.height) return;

    [preview, exportImage, exportMask].forEach((canvas) => {
      canvas.width = layout.width;
      canvas.height = layout.height;
    });

    const previewCtx = preview.getContext('2d');
    const imageCtx = exportImage.getContext('2d');
    const maskCtx = exportMask.getContext('2d');
    if (!previewCtx || !imageCtx || !maskCtx) return;

    previewCtx.clearRect(0, 0, preview.width, preview.height);
    const tile = 24;
    for (let y = 0; y < preview.height; y += tile) {
      for (let x = 0; x < preview.width; x += tile) {
        previewCtx.fillStyle = (x / tile + y / tile) % 2 === 0 ? '#222' : '#2e2e2e';
        previewCtx.fillRect(x, y, tile, tile);
      }
    }
    previewCtx.fillStyle = 'rgba(14,165,233,0.13)';
    previewCtx.fillRect(0, 0, preview.width, preview.height);
    previewCtx.drawImage(img, layout.imageX, layout.imageY, layout.imageWidth, layout.imageHeight);
    previewCtx.strokeStyle = 'rgba(14,165,233,0.95)';
    previewCtx.lineWidth = Math.max(3, Math.round(layout.width / 320));
    previewCtx.strokeRect(1, 1, preview.width - 2, preview.height - 2);
    previewCtx.strokeStyle = 'rgba(255,255,255,0.72)';
    previewCtx.setLineDash([14, 10]);
    previewCtx.strokeRect(layout.imageX, layout.imageY, layout.imageWidth, layout.imageHeight);
    previewCtx.setLineDash([]);

    imageCtx.clearRect(0, 0, exportImage.width, exportImage.height);
    imageCtx.drawImage(img, layout.imageX, layout.imageY, layout.imageWidth, layout.imageHeight);

    // Internal mask format: transparent pixels are editable, opaque white pixels are preserved.
    maskCtx.clearRect(0, 0, exportMask.width, exportMask.height);
    maskCtx.fillStyle = '#fff';
    maskCtx.fillRect(layout.imageX, layout.imageY, layout.imageWidth, layout.imageHeight);
  }, [layout]);

  useEffect(() => {
    renderCanvases();
  }, [renderCanvases]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleConfirm = useCallback(async () => {
    const exportImage = exportImageCanvasRef.current;
    const exportMask = exportMaskCanvasRef.current;
    const finalPrompt = prompt.trim();
    if (!exportImage || !exportMask || submitting) return;
    if (!finalPrompt) {
      setErrorMessage('请输入扩图提示词');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      await onConfirm({
        image: exportImage.toDataURL('image/png'),
        mask: exportMaskDataUrl(exportMask, maskMode),
        prompt: finalPrompt,
        direction,
        maskMode,
      });
    } catch (error: unknown) {
      setErrorMessage(getImageEditRetryMessage(error, '扩图提交失败'));
      setSubmitting(false);
    }
  }, [direction, maskMode, onConfirm, prompt, submitting]);

  return createPortal(
    <div className="nodrag nopan nowheel" style={overlayStyle}>
      <div style={topBarStyle}>
        <button type="button" style={iconButtonStyle} onClick={onCancel} title="关闭">
          <X size={24} />
        </button>
        <div style={dividerStyle} />
        {directionOptions.map((item) => (
          <button
            key={item.id}
            type="button"
            style={direction === item.id ? activeDirectionStyle : directionButtonStyle}
            onClick={() => setDirection(item.id)}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <div style={dividerStyle} />
        <div style={sliderWrapStyle}>
          <span style={{ color: '#f8fafc', fontWeight: 800 }}>{Math.round(expandRatio * 100)}%</span>
          <input
            type="range"
            min={15}
            max={70}
            value={Math.round(expandRatio * 100)}
            onChange={(event) => setExpandRatio(Number(event.target.value) / 100)}
            style={{ accentColor: '#0ea5e9', width: 150 }}
          />
        </div>
        <select
          value={maskMode}
          onChange={(event) => setMaskMode(event.target.value as MaskOutputMode)}
          title="Mask 输出模式"
          style={maskSelectStyle}
        >
          <option value="transparent-edit">透明=编辑区</option>
          <option value="white-edit">白色=编辑区</option>
        </select>
        <button type="button" style={saveButtonStyle} disabled={submitting} onClick={handleConfirm}>
          <Sparkles size={18} />
          {submitting ? '处理中...' : '生成'}
        </button>
      </div>

      <div style={stageWrapStyle}>
        <canvas
          ref={previewCanvasRef}
          style={{
            width: displaySize.width,
            height: displaySize.height,
            borderRadius: 6,
            boxShadow: '0 28px 90px rgba(0,0,0,0.5)',
          }}
        />
        <canvas ref={exportImageCanvasRef} style={{ display: 'none' }} />
        <canvas ref={exportMaskCanvasRef} style={{ display: 'none' }} />
      </div>

      <div style={bottomPanelStyle}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 17, fontWeight: 800 }}>扩图</div>
          <div style={{ color: 'rgba(226,232,240,0.68)', fontSize: 13, marginTop: 4 }}>
            选择扩展方向和幅度，AI 会补全透明区域并生成新的下游图片节点。
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述扩展区域应该补出的内容"
          style={promptStyle}
        />
        {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
      </div>
    </div>,
    document.body,
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background:
    'radial-gradient(circle at 50% 34%, rgba(12,18,28,0.78), rgba(0,0,0,0.94) 58%, #000 100%)',
  color: '#fff',
};

const topBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 16px',
  borderRadius: 999,
  background: 'rgba(32,32,32,0.96)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
  zIndex: 2,
};

const iconButtonStyle: React.CSSProperties = {
  height: 44,
  minWidth: 44,
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: '#f8fafc',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
};

const directionButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  padding: '0 13px',
  background: 'rgba(255,255,255,0.04)',
  fontSize: 14,
  fontWeight: 800,
};

const activeDirectionStyle: React.CSSProperties = {
  ...directionButtonStyle,
  background: 'rgba(255,255,255,0.17)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
};

const maskSelectStyle: React.CSSProperties = {
  height: 38,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  outline: 'none',
  padding: '0 12px',
  fontSize: 13,
  fontWeight: 800,
};

const saveButtonStyle: React.CSSProperties = {
  height: 48,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: 'none',
  borderRadius: 999,
  padding: '0 24px',
  background: '#fff',
  color: '#171717',
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 800,
};

const dividerStyle: React.CSSProperties = {
  width: 1,
  height: 32,
  background: 'rgba(255,255,255,0.14)',
};

const sliderWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const stageWrapStyle: React.CSSProperties = {
  position: 'absolute',
  inset: '92px 28px 178px',
  display: 'grid',
  placeItems: 'center',
};

const bottomPanelStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 24,
  transform: 'translateX(-50%)',
  width: 'min(980px, calc(100vw - 48px))',
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr)',
  gap: 16,
  alignItems: 'stretch',
  padding: 16,
  borderRadius: 24,
  background: 'rgba(32,32,32,0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
};

const promptStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 74,
  resize: 'none',
  border: '1px solid rgba(255,255,255,0.1)',
  outline: 'none',
  borderRadius: 16,
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  padding: '12px 14px',
  fontSize: 15,
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  color: '#fecaca',
  fontSize: 13,
  fontWeight: 700,
};
