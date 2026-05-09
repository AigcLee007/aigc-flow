import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brush, Eraser, RotateCcw, Sparkles, X } from 'lucide-react';
import { getImageEditRetryMessage } from '../utils/imageEditStatus';

export type MaskOutputMode = 'transparent-edit' | 'white-edit';
type MaskTool = 'brush' | 'eraser';

interface ImageRepaintOverlayProps {
  imageUrl: string;
  mode?: 'inpaint' | 'erase';
  onConfirm: (payload: { mask: string; prompt: string; maskMode: MaskOutputMode }) => Promise<void> | void;
  onCancel: () => void;
}

const DEFAULT_ERASE_PROMPT =
  'Remove the selected area seamlessly and reconstruct the background naturally. Preserve the rest of the image.';

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

export const ImageRepaintOverlay: React.FC<ImageRepaintOverlayProps> = ({
  imageUrl,
  mode = 'inpaint',
  onConfirm,
  onCancel,
}) => {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<MaskTool>('brush');
  const [maskMode, setMaskMode] = useState<MaskOutputMode>('transparent-edit');
  const [brushSize, setBrushSize] = useState(48);
  const [prompt, setPrompt] = useState(mode === 'erase' ? DEFAULT_ERASE_PROMPT : '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasMask, setHasMask] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const naturalWidth = img.naturalWidth || img.width;
      const naturalHeight = img.naturalHeight || img.height;
      imageRef.current = img;
      setImageSize({ width: naturalWidth, height: naturalHeight });

      const maxWidth = Math.min(window.innerWidth * 0.84, 1180);
      const maxHeight = Math.min(window.innerHeight * 0.7, 760);
      const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1.8);
      setDisplaySize({
        width: Math.max(320, Math.round(naturalWidth * scale)),
        height: Math.max(220, Math.round(naturalHeight * scale)),
      });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height) return;
    const preview = previewCanvasRef.current;
    const mask = maskCanvasRef.current;
    if (!preview || !mask) return;

    [preview, mask].forEach((canvas) => {
      canvas.width = imageSize.width;
      canvas.height = imageSize.height;
    });

    const previewCtx = preview.getContext('2d');
    const maskCtx = mask.getContext('2d');
    if (!previewCtx || !maskCtx) return;

    previewCtx.clearRect(0, 0, preview.width, preview.height);

    // Internal mask format: transparent pixels are editable, opaque white pixels are preserved.
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.fillStyle = '#fff';
    maskCtx.fillRect(0, 0, mask.width, mask.height);
    setHasMask(false);
  }, [imageSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const getCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const drawSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const preview = previewCanvasRef.current;
      const mask = maskCanvasRef.current;
      const previewCtx = preview?.getContext('2d');
      const maskCtx = mask?.getContext('2d');
      if (!preview || !mask || !previewCtx || !maskCtx) return;

      const drawLine = (ctx: CanvasRenderingContext2D) => {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      };

      if (tool === 'brush') {
        previewCtx.globalCompositeOperation = 'source-over';
        previewCtx.strokeStyle = 'rgba(255, 36, 36, 0.46)';
        drawLine(previewCtx);

        maskCtx.globalCompositeOperation = 'destination-out';
        maskCtx.strokeStyle = 'rgba(0,0,0,1)';
        drawLine(maskCtx);
        setHasMask(true);
        return;
      }

      previewCtx.globalCompositeOperation = 'destination-out';
      previewCtx.strokeStyle = 'rgba(0,0,0,1)';
      drawLine(previewCtx);

      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.strokeStyle = '#fff';
      drawLine(maskCtx);
    },
    [brushSize, tool],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = getCanvasPoint(event);
      if (!point) return;
      drawingRef.current = true;
      lastPointRef.current = point;
      drawSegment(point, { x: point.x + 0.1, y: point.y + 0.1 });
    },
    [drawSegment, getCanvasPoint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const point = getCanvasPoint(event);
      const last = lastPointRef.current;
      if (!point || !last) return;
      drawSegment(last, point);
      lastPointRef.current = point;
    },
    [drawSegment, getCanvasPoint],
  );

  const stopDrawing = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    drawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  const handleClear = useCallback(() => {
    const preview = previewCanvasRef.current;
    const mask = maskCanvasRef.current;
    const previewCtx = preview?.getContext('2d');
    const maskCtx = mask?.getContext('2d');
    if (!preview || !mask || !previewCtx || !maskCtx) return;
    previewCtx.clearRect(0, 0, preview.width, preview.height);
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.fillStyle = '#fff';
    maskCtx.fillRect(0, 0, mask.width, mask.height);
    setHasMask(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!maskCanvasRef.current || submitting) return;
    if (!hasMask) {
      setErrorMessage('请先用画笔涂抹需要 AI 处理的区域');
      return;
    }

    const finalPrompt = mode === 'erase' ? DEFAULT_ERASE_PROMPT : prompt.trim();
    if (!finalPrompt) {
      setErrorMessage('请输入重绘提示词');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      await onConfirm({
        mask: exportMaskDataUrl(maskCanvasRef.current, maskMode),
        prompt: finalPrompt,
        maskMode,
      });
    } catch (error: unknown) {
      setErrorMessage(getImageEditRetryMessage(error, 'AI 编辑提交失败'));
      setSubmitting(false);
    }
  }, [hasMask, maskMode, mode, onConfirm, prompt, submitting]);

  const title = mode === 'erase' ? 'AI 擦除' : '重绘';
  const description =
    mode === 'erase'
      ? '涂抹要移除的区域，AI 会补全背景并生成新的下游图片节点。'
      : '涂抹要重绘的区域，并描述希望生成的新内容。';

  return createPortal(
    <div style={overlayStyle} className="nodrag nopan nowheel">
      <div style={topBarStyle}>
        <button type="button" style={iconButtonStyle} onClick={onCancel} title="关闭">
          <X size={24} />
        </button>
        <div style={dividerStyle} />
        <button
          type="button"
          style={tool === 'brush' ? activeToolStyle : toolButtonStyle}
          onClick={() => setTool('brush')}
          title="画笔"
        >
          <Brush size={22} />
        </button>
        <button
          type="button"
          style={tool === 'eraser' ? activeToolStyle : toolButtonStyle}
          onClick={() => setTool('eraser')}
          title="橡皮"
        >
          <Eraser size={22} />
        </button>
        <div style={dividerStyle} />
        <div style={sliderWrapStyle}>
          <span style={{ width: 48, color: '#f8fafc', fontWeight: 700 }}>{brushSize}px</span>
          <input
            type="range"
            min={8}
            max={120}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
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
        <button type="button" style={toolButtonStyle} onClick={handleClear} title="清空">
          <RotateCcw size={21} />
        </button>
        <button
          type="button"
          style={{ ...saveButtonStyle, opacity: submitting ? 0.72 : 1 }}
          disabled={submitting}
          onClick={handleConfirm}
        >
          <Sparkles size={18} />
          {submitting ? '处理中...' : '生成'}
        </button>
      </div>

      <div style={stageWrapStyle}>
        <div style={{ ...stageStyle, width: displaySize.width, height: displaySize.height }}>
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
          <canvas
            ref={previewCanvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: tool === 'eraser' ? 'cell' : 'crosshair',
              touchAction: 'none',
            }}
          />
          <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
        </div>
      </div>

      <div style={bottomPanelStyle}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 17, fontWeight: 800 }}>{title}</div>
          <div style={{ color: 'rgba(226,232,240,0.68)', fontSize: 13, marginTop: 4 }}>{description}</div>
        </div>
        {mode === 'inpaint' && (
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你想在涂抹区域生成的内容"
            style={promptStyle}
          />
        )}
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
    'radial-gradient(circle at 50% 35%, rgba(12,18,28,0.78), rgba(0,0,0,0.94) 58%, #000 100%)',
  color: '#fff',
};

const topBarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderRadius: 999,
  background: 'rgba(32,32,32,0.96)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
  zIndex: 2,
};

const iconButtonStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  border: 'none',
  borderRadius: '50%',
  background: 'transparent',
  color: '#f8fafc',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};

const toolButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  background: 'rgba(255,255,255,0.04)',
};

const activeToolStyle: React.CSSProperties = {
  ...iconButtonStyle,
  background: 'rgba(255,255,255,0.16)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
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

const stageStyle: React.CSSProperties = {
  position: 'relative',
  borderRadius: 4,
  overflow: 'hidden',
  outline: '2px solid rgba(14,165,233,0.85)',
  boxShadow: '0 28px 90px rgba(0,0,0,0.5)',
  background: '#111',
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
