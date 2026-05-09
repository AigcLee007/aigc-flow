import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Grid3X3, X } from 'lucide-react';
import { canvasToBlobUrl } from '../utils/imageUtils';

export interface ImageSplitPiece {
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  row: number;
  col: number;
}

interface ImageSplitOverlayProps {
  imageUrl: string;
  initialGridSize?: number;
  onConfirm: (pieces: ImageSplitPiece[], gridSize: number) => void;
  onCancel: () => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

export const ImageSplitOverlay: React.FC<ImageSplitOverlayProps> = ({ imageUrl, initialGridSize = 2, onConfirm, onCancel }) => {
  const [gridSize, setGridSize] = useState(initialGridSize);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleConfirm = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const img = await loadImage(imageUrl);
      const pieceWidth = Math.floor(img.naturalWidth / gridSize);
      const pieceHeight = Math.floor(img.naturalHeight / gridSize);
      const pieces: ImageSplitPiece[] = [];

      for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
          const sourceX = col * pieceWidth;
          const sourceY = row * pieceHeight;
          const sourceWidth = col === gridSize - 1 ? img.naturalWidth - sourceX : pieceWidth;
          const sourceHeight = row === gridSize - 1 ? img.naturalHeight - sourceY : pieceHeight;
          const canvas = document.createElement('canvas');
          canvas.width = sourceWidth;
          canvas.height = sourceHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas context unavailable');
          ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
          pieces.push({
            url: await canvasToBlobUrl(canvas),
            naturalWidth: sourceWidth,
            naturalHeight: sourceHeight,
            row,
            col,
          });
        }
      }

      onConfirm(pieces, gridSize);
    } finally {
      setIsSaving(false);
    }
  };

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
          width: 760,
          maxWidth: '92vw',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 240px',
          gap: 20,
          padding: 20,
          borderRadius: 18,
          background: 'rgba(28,28,38,0.96)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        }}
      >
        <div style={{ position: 'relative', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img
            src={imageUrl}
            alt="切分预览"
            style={{
              maxWidth: '100%',
              maxHeight: '62vh',
              objectFit: 'contain',
              borderRadius: 10,
              background: '#0f172a',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 'min(100%, 62vh)',
                aspectRatio: 1,
                opacity: 0,
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700 }}>
              <Grid3X3 size={18} />
              切分网格
            </div>
            <button type="button" onClick={onCancel} style={closeButtonStyle}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {[2, 3, 4].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setGridSize(size)}
                style={{
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: gridSize === size ? 'rgba(14,165,233,0.18)' : 'rgba(255,255,255,0.05)',
                  color: gridSize === size ? '#bae6fd' : '#e2e8f0',
                  borderRadius: 12,
                  padding: '12px 14px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: 700,
                }}
              >
                {size} × {size}
              </button>
            ))}
          </div>

          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6 }}>
            每个切片都会生成一个新的图片节点，并自动排列在原节点右侧。
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={secondaryButtonStyle}>取消</button>
            <button type="button" onClick={handleConfirm} disabled={isSaving} style={primaryButtonStyle(isSaving)}>
              <Check size={16} />
              {isSaving ? '处理中' : '生成切片'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const closeButtonStyle: React.CSSProperties = {
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
