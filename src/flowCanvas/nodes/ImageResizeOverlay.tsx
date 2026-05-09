import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Link, Link2Off, X } from 'lucide-react';
import { canvasToBlobUrl, getImageNaturalSize } from '../utils/imageUtils';

interface ImageResizeOverlayProps {
  imageUrl: string;
  initialWidth?: number;
  initialHeight?: number;
  onConfirm: (resultUrl: string, naturalWidth: number, naturalHeight: number) => void;
  onCancel: () => void;
}

const clampDimension = (value: number) => Math.min(Math.max(Math.round(value), 16), 8192);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

export const ImageResizeOverlay: React.FC<ImageResizeOverlayProps> = ({
  imageUrl,
  initialWidth,
  initialHeight,
  onConfirm,
  onCancel,
}) => {
  const [naturalSize, setNaturalSize] = useState({ width: initialWidth || 1024, height: initialHeight || 1024 });
  const [width, setWidth] = useState(initialWidth || 1024);
  const [height, setHeight] = useState(initialHeight || 1024);
  const [locked, setLocked] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const initializedRef = useRef(false);

  const ratio = useMemo(() => naturalSize.width / naturalSize.height || 1, [naturalSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  useEffect(() => {
    if (initialWidth && initialHeight) return;
    getImageNaturalSize(imageUrl).then((size) => {
      if (initializedRef.current) return;
      initializedRef.current = true;
      setNaturalSize({ width: size.w, height: size.h });
      setWidth(size.w);
      setHeight(size.h);
    }).catch(() => undefined);
  }, [imageUrl, initialHeight, initialWidth]);

  const updateWidth = (value: number) => {
    const nextWidth = clampDimension(value);
    setWidth(nextWidth);
    if (locked) setHeight(clampDimension(nextWidth / ratio));
  };

  const updateHeight = (value: number) => {
    const nextHeight = clampDimension(value);
    setHeight(nextHeight);
    if (locked) setWidth(clampDimension(nextHeight * ratio));
  };

  const applyScale = (scale: number) => {
    updateWidth(naturalSize.width * scale);
    if (!locked) setHeight(clampDimension(naturalSize.height * scale));
  };

  const handleConfirm = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const img = await loadImage(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      const resultUrl = await canvasToBlobUrl(canvas);
      onConfirm(resultUrl, width, height);
    } finally {
      setIsSaving(false);
    }
  }, [height, imageUrl, isSaving, onConfirm, width]);

  return createPortal(
    <div
      className="nodrag nopan nowheel"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5,7,13,0.92)',
        color: '#fff',
      }}
    >
      <div
        style={{
          width: 720,
          maxWidth: '92vw',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 260px',
          gap: 20,
          padding: 20,
          borderRadius: 18,
          background: 'rgba(28,28,38,0.96)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={imageUrl}
            alt="调整像素预览"
            style={{
              maxWidth: '100%',
              maxHeight: '60vh',
              objectFit: 'contain',
              borderRadius: 10,
              background: '#0f172a',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>调整像素</div>
            <button
              type="button"
              onClick={onCancel}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>
          </div>

          <label style={{ display: 'grid', gap: 7, color: '#94a3b8', fontSize: 12 }}>
            宽度
            <input
              type="number"
              min={16}
              max={8192}
              value={width}
              onChange={(event) => updateWidth(Number(event.target.value))}
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: 7, color: '#94a3b8', fontSize: 12 }}>
            高度
            <input
              type="number"
              min={16}
              max={8192}
              value={height}
              onChange={(event) => updateHeight(Number(event.target.value))}
              style={inputStyle}
            />
          </label>

          <button
            type="button"
            onClick={() => setLocked((value) => !value)}
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              background: locked ? 'rgba(14,165,233,0.16)' : 'rgba(255,255,255,0.05)',
              color: locked ? '#bae6fd' : '#cbd5e1',
              borderRadius: 10,
              padding: '9px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
          >
            {locked ? <Link size={16} /> : <Link2Off size={16} />}
            {locked ? '锁定比例' : '自由比例'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[0.5, 1, 2].map((scale) => (
              <button
                key={scale}
                type="button"
                onClick={() => applyScale(scale)}
                style={chipStyle}
              >
                {scale === 1 ? '原始' : `${scale}x`}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={secondaryButtonStyle}>取消</button>
            <button type="button" onClick={handleConfirm} disabled={isSaving} style={primaryButtonStyle(isSaving)}>
              <Check size={16} />
              {isSaving ? '处理中' : '生成节点'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  fontSize: 14,
  outline: 'none',
};

const chipStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.05)',
  color: '#e2e8f0',
  borderRadius: 10,
  padding: '8px 0',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'rgba(255,255,255,0.06)',
  color: '#e2e8f0',
  borderRadius: 10,
  padding: '10px 14px',
  cursor: 'pointer',
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: 'none',
  background: disabled ? 'rgba(148,163,184,0.22)' : 'linear-gradient(135deg, #0ea5e9, #2563eb)',
  color: '#fff',
  borderRadius: 10,
  padding: '10px 14px',
  cursor: disabled ? 'wait' : 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontWeight: 700,
});
