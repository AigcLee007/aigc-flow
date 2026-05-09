import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ImageOff, Sparkles, X } from 'lucide-react';
import type { ImageEditType } from '../runtime/graphExecutor';
import { getImageEditRetryMessage } from '../utils/imageEditStatus';

interface ImageAiConfirmOverlayProps {
  editType: Extract<ImageEditType, 'enhance' | 'removeBackground'>;
  imageUrl: string;
  modelLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

const copyByType = {
  enhance: {
    title: '增强图片',
    action: '确认增强',
    description: 'AI 会提升图片细节、清晰度和整体质感，并生成新的下游图片节点。',
    icon: <Sparkles size={24} />,
  },
  removeBackground: {
    title: '抠图',
    action: '确认抠图',
    description: 'AI 会移除背景并尽量保留主体边缘，结果会生成新的下游图片节点。',
    icon: <ImageOff size={24} />,
  },
} satisfies Record<Extract<ImageEditType, 'enhance' | 'removeBackground'>, {
  title: string;
  action: string;
  description: string;
  icon: React.ReactNode;
}>;

export const ImageAiConfirmOverlay: React.FC<ImageAiConfirmOverlayProps> = ({
  editType,
  imageUrl,
  modelLabel,
  onConfirm,
  onCancel,
}) => {
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const copy = copyByType[editType];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage('');
    try {
      await onConfirm();
    } catch (error: unknown) {
      setErrorMessage(getImageEditRetryMessage(error, 'AI 编辑提交失败'));
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="nodrag nopan nowheel" style={overlayStyle}>
      <div style={panelStyle}>
        <button type="button" style={closeButtonStyle} onClick={onCancel} aria-label="关闭">
          <X size={20} />
        </button>
        <div style={headerStyle}>
          <div style={iconWrapStyle}>{copy.icon}</div>
          <div>
            <div style={titleStyle}>{copy.title}</div>
            <div style={descriptionStyle}>{copy.description}</div>
          </div>
        </div>

        <div style={previewWrapStyle}>
          <img src={imageUrl} alt="" draggable={false} style={previewImageStyle} />
        </div>

        <div style={noticeStyle}>
          <div>此操作会调用 AI 图片编辑模型，可能消耗点数。</div>
          <div>原图会保留在画布上，结果会作为新的图片节点连接到当前节点。</div>
          {modelLabel && <div>当前模型：{modelLabel}</div>}
        </div>

        {errorMessage && <div style={errorStyle}>{errorMessage}</div>}

        <div style={footerStyle}>
          <button type="button" style={cancelButtonStyle} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            style={{ ...confirmButtonStyle, opacity: submitting ? 0.72 : 1 }}
            disabled={submitting}
            onClick={handleConfirm}
          >
            {submitting ? '提交中...' : copy.action}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(0,0,0,0.62)',
  backdropFilter: 'blur(10px)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(520px, calc(100vw - 40px))',
  borderRadius: 28,
  padding: 22,
  background: 'rgba(34,34,34,0.98)',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 30px 90px rgba(0,0,0,0.55)',
  color: '#f8fafc',
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 36,
  height: 36,
  border: 'none',
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 14,
  alignItems: 'flex-start',
  paddingRight: 44,
};

const iconWrapStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.1)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
};

const descriptionStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 14,
  lineHeight: 1.6,
  color: 'rgba(226,232,240,0.72)',
};

const previewWrapStyle: React.CSSProperties = {
  marginTop: 18,
  height: 210,
  borderRadius: 20,
  overflow: 'hidden',
  background: '#111',
  border: '1px solid rgba(255,255,255,0.08)',
};

const previewImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  display: 'block',
};

const noticeStyle: React.CSSProperties = {
  marginTop: 16,
  display: 'grid',
  gap: 6,
  borderRadius: 16,
  padding: 14,
  background: 'rgba(14,165,233,0.09)',
  border: '1px solid rgba(14,165,233,0.18)',
  color: '#dbeafe',
  fontSize: 13,
  lineHeight: 1.55,
};

const errorStyle: React.CSSProperties = {
  marginTop: 12,
  color: '#fecaca',
  fontSize: 13,
  fontWeight: 700,
};

const footerStyle: React.CSSProperties = {
  marginTop: 20,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12,
};

const cancelButtonStyle: React.CSSProperties = {
  height: 44,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  padding: '0 20px',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 800,
};

const confirmButtonStyle: React.CSSProperties = {
  height: 44,
  border: 'none',
  borderRadius: 999,
  background: '#fff',
  color: '#171717',
  padding: '0 22px',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 900,
};
