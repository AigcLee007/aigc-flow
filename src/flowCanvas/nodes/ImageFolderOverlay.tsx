import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, FolderPlus, Loader2, Plus, X } from 'lucide-react';
import { assetStorage } from '../../services/assetStorage';
import { useImageFolderStore } from '../store/imageFolderStore';
import { imageUrlToBlob } from '../utils/imageUtils';

interface ImageFolderOverlayProps {
  imageUrl: string;
  nodeId: string;
  title: string;
  projectId: string;
  projectTitle: string;
  originalImageUrl?: string;
  lastEditType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  onAdded?: (folderId: string) => void;
  onCancel: () => void;
}

export const ImageFolderOverlay: React.FC<ImageFolderOverlayProps> = ({
  imageUrl,
  nodeId,
  title,
  projectId,
  projectTitle,
  originalImageUrl,
  lastEditType,
  naturalWidth,
  naturalHeight,
  onAdded,
  onCancel,
}) => {
  const folders = useImageFolderStore((state) => state.folders);
  const items = useImageFolderStore((state) => state.items);
  const addFolder = useImageFolderStore((state) => state.addFolder);
  const addImageToFolder = useImageFolderStore((state) => state.addImageToFolder);
  const [selectedFolderId, setSelectedFolderId] = useState(folders[0]?.id || '');
  const [newFolderName, setNewFolderName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!selectedFolderId && folders[0]) setSelectedFolderId(folders[0].id);
  }, [folders, selectedFolderId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.folderId, (counts.get(item.folderId) || 0) + 1));
    return counts;
  }, [items]);

  const handleCreateFolder = useCallback(() => {
    const folder = addFolder(newFolderName);
    setSelectedFolderId(folder.id);
    setNewFolderName('');
  }, [addFolder, newFolderName]);

  const handleConfirm = useCallback(async () => {
    if (!selectedFolderId || submitting) return;
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    let assetId: string | undefined;
    try {
      const blob = await imageUrlToBlob(imageUrl);
      assetId = await assetStorage.storeBlob(blob);
    } catch (error) {
      console.warn('[ImageFolderOverlay] Asset cache failed, saving URL only:', error);
    }

    try {
      const item = addImageToFolder(selectedFolderId, {
        title: title || '图片素材',
        imageUrl,
        assetId,
        notes: notes.trim() || undefined,
        sourceNodeId: nodeId,
        sourceProjectId: projectId,
        sourceProjectTitle: projectTitle,
        originalImageUrl,
        lastEditType,
        naturalWidth,
        naturalHeight,
      });
      onAdded?.(item.folderId);
      setSuccessMessage(assetId ? '已添加到素材夹，并完成本地缓存。' : '已添加到素材夹。当前图片未能缓存，将继续使用原始 URL。');
      setSubmitting(false);
    } catch (error: any) {
      setErrorMessage(error.message || '添加到文件夹失败');
      setSubmitting(false);
    }
  }, [
    addImageToFolder,
    imageUrl,
    lastEditType,
    naturalHeight,
    naturalWidth,
    nodeId,
    notes,
    onAdded,
    originalImageUrl,
    projectId,
    projectTitle,
    selectedFolderId,
    submitting,
    title,
  ]);

  return createPortal(
    <div className="nodrag nopan nowheel" style={overlayStyle}>
      <div style={panelStyle}>
        <button type="button" style={closeButtonStyle} onClick={onCancel} aria-label="关闭">
          <X size={20} />
        </button>

        <div style={headerStyle}>
          <div style={iconWrapStyle}>
            <FolderPlus size={24} />
          </div>
          <div>
            <div style={titleStyle}>添加到文件夹</div>
            <div style={descriptionStyle}>保存当前图片、节点来源和编辑信息，后续素材库模块可直接读取。</div>
          </div>
        </div>

        <div style={bodyStyle}>
          <div style={previewStyle}>
            <img src={imageUrl} alt="" draggable={false} style={previewImageStyle} />
          </div>

          <div style={sideStyle}>
            <div style={labelStyle}>选择文件夹</div>
            <div style={folderListStyle}>
              {folders.map((folder) => {
                const active = folder.id === selectedFolderId;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    style={folderButtonStyle(active)}
                    onClick={() => setSelectedFolderId(folder.id)}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {folder.name}
                    </span>
                    <span style={folderCountStyle}>{folderCounts.get(folder.id) || 0}</span>
                  </button>
                );
              })}
            </div>

            <div style={createRowStyle}>
              <input
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="新建文件夹"
                style={inputStyle}
              />
              <button type="button" style={smallButtonStyle} onClick={handleCreateFolder}>
                <Plus size={16} />
              </button>
            </div>

            <div style={labelStyle}>备注</div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="可选：记录用途、版本或来源"
              style={textareaStyle}
            />
          </div>
        </div>

        {errorMessage && <div style={errorStyle}>{errorMessage}</div>}
        {successMessage && <div style={successStyle}>{successMessage}</div>}

        <div style={footerStyle}>
          <button type="button" style={cancelButtonStyle} onClick={onCancel}>
            {successMessage ? '完成' : '取消'}
          </button>
          {!successMessage && (
            <button
              type="button"
              style={{ ...confirmButtonStyle, opacity: submitting ? 0.72 : 1 }}
              disabled={submitting}
              onClick={handleConfirm}
            >
              {submitting ? <Loader2 size={17} /> : <Check size={17} />}
              {submitting ? '添加中' : '添加'}
            </button>
          )}
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
  background: 'rgba(0,0,0,0.58)',
  backdropFilter: 'blur(10px)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  width: 'min(760px, calc(100vw - 40px))',
  borderRadius: 26,
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

const bodyStyle: React.CSSProperties = {
  marginTop: 18,
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 1fr) 310px',
  gap: 18,
};

const previewStyle: React.CSSProperties = {
  height: 330,
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

const sideStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'rgba(226,232,240,0.58)',
  fontWeight: 800,
};

const folderListStyle: React.CSSProperties = {
  maxHeight: 128,
  overflow: 'auto',
  display: 'grid',
  gap: 8,
  paddingRight: 2,
};

const folderButtonStyle = (active: boolean): React.CSSProperties => ({
  height: 40,
  width: '100%',
  border: `1px solid ${active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)'}`,
  borderRadius: 12,
  background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.045)',
  color: '#f8fafc',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 12px',
  fontSize: 14,
  fontWeight: 800,
  textAlign: 'left',
});

const folderCountStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 28,
  height: 22,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(226,232,240,0.78)',
  fontSize: 12,
};

const createRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 40px',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 40,
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  padding: '0 12px',
  outline: 'none',
  fontSize: 14,
};

const smallButtonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: 'none',
  borderRadius: 12,
  background: '#fff',
  color: '#171717',
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};

const textareaStyle: React.CSSProperties = {
  minHeight: 96,
  resize: 'none',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.06)',
  color: '#f8fafc',
  padding: 12,
  outline: 'none',
  fontSize: 14,
  lineHeight: 1.5,
  fontFamily: 'inherit',
};

const errorStyle: React.CSSProperties = {
  marginTop: 14,
  color: '#fecaca',
  fontSize: 13,
  fontWeight: 700,
};

const successStyle: React.CSSProperties = {
  marginTop: 14,
  borderRadius: 14,
  padding: '10px 12px',
  background: 'rgba(34,197,94,0.12)',
  border: '1px solid rgba(34,197,94,0.2)',
  color: '#bbf7d0',
  fontSize: 13,
  fontWeight: 800,
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
