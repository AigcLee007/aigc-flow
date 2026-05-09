import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Move, X } from 'lucide-react';
import { canvasToBlobUrl } from '../utils/imageUtils';
import { fitMediaNodeToShortSide } from '../utils/nodeSizing';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropOverlayProps {
  imageUrl: string;
  onConfirm: (croppedUrl: string, width: number, height: number, naturalWidth: number, naturalHeight: number) => void;
  onCancel: () => void;
}

type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_CROP_SIZE = 32;

const presets = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = url;
  });
}

export const ImageCropOverlay: React.FC<ImageCropOverlayProps> = ({ imageUrl, onConfirm, onCancel }) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    crop: Rect;
  } | null>(null);

  const [imageBox, setImageBox] = useState<Rect | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const measureImage = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    const bounds = img.getBoundingClientRect();
    const nextBox = {
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
    setImageBox(nextBox);
    setCrop((current) => current || { x: 0, y: 0, width: nextBox.width, height: nextBox.height });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', measureImage);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', measureImage);
    };
  }, [measureImage, onCancel]);

  const updateCrop = useCallback(
    (mode: DragMode, startCrop: Rect, deltaX: number, deltaY: number) => {
      if (!imageBox) return startCrop;

      let next = { ...startCrop };

      if (mode === 'move') {
        next.x = clamp(startCrop.x + deltaX, 0, imageBox.width - startCrop.width);
        next.y = clamp(startCrop.y + deltaY, 0, imageBox.height - startCrop.height);
        return next;
      }

      if (mode.includes('e')) {
        next.width = clamp(startCrop.width + deltaX, MIN_CROP_SIZE, imageBox.width - startCrop.x);
      }
      if (mode.includes('s')) {
        next.height = clamp(startCrop.height + deltaY, MIN_CROP_SIZE, imageBox.height - startCrop.y);
      }
      if (mode.includes('w')) {
        const newX = clamp(startCrop.x + deltaX, 0, startCrop.x + startCrop.width - MIN_CROP_SIZE);
        next.width = startCrop.width + startCrop.x - newX;
        next.x = newX;
      }
      if (mode.includes('n')) {
        const newY = clamp(startCrop.y + deltaY, 0, startCrop.y + startCrop.height - MIN_CROP_SIZE);
        next.height = startCrop.height + startCrop.y - newY;
        next.y = newY;
      }

      if (aspectRatio) {
        const anchorRight = mode.includes('w') ? startCrop.x + startCrop.width : next.x;
        const anchorBottom = mode.includes('n') ? startCrop.y + startCrop.height : next.y;
        const horizontalDrag = mode.includes('e') || mode.includes('w');
        const verticalDrag = mode.includes('n') || mode.includes('s');

        if (horizontalDrag && !verticalDrag) {
          next.height = next.width / aspectRatio;
        } else {
          next.width = next.height * aspectRatio;
        }

        if (mode.includes('w')) next.x = anchorRight - next.width;
        if (mode.includes('n')) next.y = anchorBottom - next.height;

        if (next.x < 0) {
          next.x = 0;
          next.width = Math.min(anchorRight, imageBox.width);
          next.height = next.width / aspectRatio;
        }
        if (next.y < 0) {
          next.y = 0;
          next.height = Math.min(anchorBottom, imageBox.height);
          next.width = next.height * aspectRatio;
        }
        if (next.x + next.width > imageBox.width) {
          next.width = imageBox.width - next.x;
          next.height = next.width / aspectRatio;
        }
        if (next.y + next.height > imageBox.height) {
          next.height = imageBox.height - next.y;
          next.width = next.height * aspectRatio;
        }
      }

      next.width = clamp(next.width, MIN_CROP_SIZE, imageBox.width - next.x);
      next.height = clamp(next.height, MIN_CROP_SIZE, imageBox.height - next.y);
      next.x = clamp(next.x, 0, imageBox.width - next.width);
      next.y = clamp(next.y, 0, imageBox.height - next.height);

      return next;
    },
    [aspectRatio, imageBox],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const { mode, startX, startY, crop: startCrop } = dragRef.current;
      setCrop(updateCrop(mode, startCrop, event.clientX - startX, event.clientY - startY));
    };

    const onPointerUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [updateCrop]);

  const beginDrag = (mode: DragMode) => (event: React.PointerEvent) => {
    if (!crop) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      crop,
    };
  };

  const applyPreset = (ratio: number | null) => {
    if (!imageBox) return;
    setAspectRatio(ratio);

    if (!ratio) return;

    const maxWidth = imageBox.width;
    const maxHeight = imageBox.height;
    let width = maxWidth;
    let height = width / ratio;

    if (height > maxHeight) {
      height = maxHeight;
      width = height * ratio;
    }

    setCrop({
      x: (imageBox.width - width) / 2,
      y: (imageBox.height - height) / 2,
      width,
      height,
    });
  };

  const handleConfirm = async () => {
    if (!crop || !imageBox || isSaving) return;

    setIsSaving(true);
    try {
      const img = await loadImage(imageUrl);
      const scaleX = img.naturalWidth / imageBox.width;
      const scaleY = img.naturalHeight / imageBox.height;
      const sourceX = Math.round(crop.x * scaleX);
      const sourceY = Math.round(crop.y * scaleY);
      const sourceWidth = Math.round(crop.width * scaleX);
      const sourceHeight = Math.round(crop.height * scaleY);

      const canvas = document.createElement('canvas');
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');

      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      const croppedUrl = await canvasToBlobUrl(canvas);
      const nodeSize = fitMediaNodeToShortSide(sourceWidth, sourceHeight);
      onConfirm(croppedUrl, nodeSize.width, nodeSize.height, sourceWidth, sourceHeight);
    } finally {
      setIsSaving(false);
    }
  };

  const cropStyle: React.CSSProperties | undefined =
    imageBox && crop
      ? {
          position: 'fixed',
          left: imageBox.x + crop.x,
          top: imageBox.y + crop.y,
          width: crop.width,
          height: crop.height,
        }
      : undefined;

  const renderHandle = (mode: DragMode, style: React.CSSProperties) => (
    <div
      onPointerDown={beginDrag(mode)}
      style={{
        position: 'absolute',
        width: 18,
        height: 18,
        borderRadius: 6,
        border: '2px solid #fff',
        background: 'rgba(14, 165, 233, 0.9)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
        ...style,
      }}
    />
  );

  return createPortal(
    <div
      className="nodrag nopan nowheel"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(5, 7, 13, 0.94)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <button
        onClick={onCancel}
        aria-label="关闭裁剪"
        style={{
          position: 'fixed',
          top: 22,
          right: 22,
          width: 42,
          height: 42,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.08)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <X size={20} />
      </button>

      <img
        ref={imageRef}
        src={imageUrl}
        alt="待裁剪图片"
        draggable={false}
        onLoad={measureImage}
        style={{
          maxWidth: '88vw',
          maxHeight: '74vh',
          objectFit: 'contain',
          userSelect: 'none',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
        }}
      />

      {imageBox && crop && (
        <>
          <div style={{ position: 'fixed', left: imageBox.x, top: imageBox.y, width: imageBox.width, height: crop.y, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', left: imageBox.x, top: imageBox.y + crop.y + crop.height, width: imageBox.width, height: imageBox.height - crop.y - crop.height, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', left: imageBox.x, top: imageBox.y + crop.y, width: crop.x, height: crop.height, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'fixed', left: imageBox.x + crop.x + crop.width, top: imageBox.y + crop.y, width: imageBox.width - crop.x - crop.width, height: crop.height, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

          <div
            onPointerDown={beginDrag('move')}
            style={{
              ...cropStyle,
              border: '2px solid rgba(255,255,255,0.95)',
              outline: '1px dashed rgba(14,165,233,0.9)',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0)',
              cursor: 'move',
            }}
          >
            <div style={{ position: 'absolute', inset: '33.333% 0 auto 0', borderTop: '1px solid rgba(255,255,255,0.42)' }} />
            <div style={{ position: 'absolute', inset: '66.666% 0 auto 0', borderTop: '1px solid rgba(255,255,255,0.42)' }} />
            <div style={{ position: 'absolute', inset: '0 auto 0 33.333%', borderLeft: '1px solid rgba(255,255,255,0.42)' }} />
            <div style={{ position: 'absolute', inset: '0 auto 0 66.666%', borderLeft: '1px solid rgba(255,255,255,0.42)' }} />
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', color: 'rgba(255,255,255,0.75)' }}>
              <Move size={22} />
            </div>
            {renderHandle('nw', { left: -10, top: -10, cursor: 'nwse-resize' })}
            {renderHandle('ne', { right: -10, top: -10, cursor: 'nesw-resize' })}
            {renderHandle('sw', { left: -10, bottom: -10, cursor: 'nesw-resize' })}
            {renderHandle('se', { right: -10, bottom: -10, cursor: 'nwse-resize' })}
            {renderHandle('n', { left: '50%', top: -10, transform: 'translateX(-50%)', cursor: 'ns-resize' })}
            {renderHandle('s', { left: '50%', bottom: -10, transform: 'translateX(-50%)', cursor: 'ns-resize' })}
            {renderHandle('w', { left: -10, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' })}
            {renderHandle('e', { right: -10, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' })}
          </div>
        </>
      )}

      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 28,
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 14px',
          borderRadius: 18,
          background: 'rgba(28, 28, 38, 0.96)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset.value)}
              style={{
                border: '1px solid rgba(255,255,255,0.08)',
                background: aspectRatio === preset.value ? 'rgba(14,165,233,0.22)' : 'rgba(255,255,255,0.05)',
                color: aspectRatio === preset.value ? '#e0f2fe' : '#cbd5e1',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.12)' }} />

        <button
          onClick={onCancel}
          style={{
            border: 'none',
            background: 'rgba(255,255,255,0.06)',
            color: '#e2e8f0',
            borderRadius: 12,
            padding: '9px 14px',
            cursor: 'pointer',
          }}
        >
          取消
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSaving}
          style={{
            border: 'none',
            background: isSaving ? 'rgba(148,163,184,0.22)' : 'linear-gradient(135deg, #0ea5e9, #2563eb)',
            color: '#fff',
            borderRadius: 12,
            padding: '9px 16px',
            cursor: isSaving ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
          }}
        >
          <Check size={16} />
          {isSaving ? '处理中' : '确认裁剪'}
        </button>
      </div>
    </div>,
    document.body,
  );
};
