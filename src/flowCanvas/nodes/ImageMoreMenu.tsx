import React from 'react';
import {
  BadgeCheck,
  Eraser,
  Grid3X3,
  ImageOff,
  Maximize2,
  PencilLine,
  Scaling,
  Sparkles,
} from 'lucide-react';

export type ImageMoreMenuAction =
  | 'outpaint'
  | 'erase'
  | 'annotate'
  | 'removeBackground'
  | 'split'
  | 'enhance'
  | 'resize'
  | 'compliance';

interface ImageMoreMenuProps {
  onSelect: (action: ImageMoreMenuAction, payload?: { gridSize?: number }) => void;
}

const menuRows: Array<{
  id: ImageMoreMenuAction;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}> = [
  { id: 'outpaint', label: '扩图', icon: <Maximize2 size={24} /> },
  { id: 'erase', label: '擦除', icon: <Eraser size={24} /> },
  { id: 'annotate', label: '标注', icon: <PencilLine size={24} /> },
  { id: 'enhance', label: '增强', icon: <Sparkles size={24} /> },
  { id: 'resize', label: '调整像素', icon: <Scaling size={24} /> },
  { id: 'removeBackground', label: '抠图', icon: <ImageOff size={24} /> },
];

export const ImageMoreMenu: React.FC<ImageMoreMenuProps> = ({ onSelect }) => {
  return (
    <div
      className="nodrag nopan nowheel"
      style={{
        position: 'absolute',
        top: 'calc(100% + 14px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 338,
        padding: '18px 20px 20px',
        borderRadius: 24,
        background: 'rgba(40,40,40,0.98)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 22px 64px rgba(0,0,0,0.52)',
        backdropFilter: 'blur(18px)',
        zIndex: 260,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          border: '9px solid transparent',
          borderBottomColor: 'rgba(40,40,40,0.98)',
        }}
      />

      <div style={{ display: 'grid', gap: 18 }}>
        {menuRows.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={row.disabled}
            onClick={() => onSelect(row.id)}
            style={rowButtonStyle(row.disabled)}
            onMouseEnter={(event) => {
              if (!row.disabled) event.currentTarget.style.background = 'rgba(255,255,255,0.07)';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent';
            }}
          >
            <span style={{ display: 'flex', color: row.disabled ? 'rgba(226,232,240,0.4)' : '#f8fafc' }}>
              {row.icon}
            </span>
            <span>{row.label}</span>
            {row.disabled && <span style={disabledTextStyle}>待接入</span>}
          </button>
        ))}

        <div style={quickSplitStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <Grid3X3 size={24} />
            <span style={{ fontWeight: 800 }}>快速切分</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {[2, 3, 4].map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onSelect('split', { gridSize: size })}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#d1d5db',
                  cursor: 'pointer',
                  fontSize: 18,
                  fontWeight: 800,
                  padding: 0,
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.color = '#d1d5db';
                }}
              >
                {size}x{size}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled
          style={{
            ...rowButtonStyle(true),
            marginTop: -2,
          }}
        >
          <span style={{ position: 'relative', display: 'flex' }}>
            <BadgeCheck size={24} />
            <span
              style={{
                position: 'absolute',
                top: -7,
                right: -7,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#0ea5e9',
              }}
            />
          </span>
          <span>Seedance 2.0 合规验证</span>
        </button>
      </div>
    </div>
  );
};

const rowButtonStyle = (disabled?: boolean): React.CSSProperties => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '4px 6px',
  border: 'none',
  borderRadius: 12,
  background: 'transparent',
  color: disabled ? 'rgba(226,232,240,0.42)' : '#f8fafc',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 20,
  fontWeight: 800,
  textAlign: 'left',
});

const disabledTextStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 15,
  fontWeight: 600,
  color: 'rgba(226,232,240,0.38)',
};

const quickSplitStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  color: '#f8fafc',
  fontSize: 20,
  padding: '4px 6px',
};