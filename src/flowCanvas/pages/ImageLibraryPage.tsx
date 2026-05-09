import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Folder, Image as ImageIcon, Search } from 'lucide-react';
import { assetStorage } from '../../services/assetStorage';
import { useImageFolderStore, type FlowImageFolderItem } from '../store/imageFolderStore';

const ResolvedImage: React.FC<{ item: FlowImageFolderItem; style?: React.CSSProperties }> = ({ item, style }) => {
  const [src, setSrc] = useState(item.imageUrl);

  useEffect(() => {
    let active = true;
    let objectUrl = '';

    const resolve = async () => {
      if (!item.assetId) {
        setSrc(item.imageUrl);
        return;
      }
      const url = await assetStorage.getAssetUrl(item.assetId).catch(() => null);
      if (!active) return;
      if (url) {
        objectUrl = url;
        setSrc(url);
      } else {
        setSrc(item.imageUrl);
      }
    };

    void resolve();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item.assetId, item.imageUrl]);

  return <img src={src} alt="" draggable={false} style={style} />;
};

const ImageLibraryPage: React.FC = () => {
  const folders = useImageFolderStore((state) => state.folders);
  const items = useImageFolderStore((state) => state.items);
  const [selectedFolderId, setSelectedFolderId] = useState(folders[0]?.id || 'all');
  const [query, setQuery] = useState('');
  const [previewItem, setPreviewItem] = useState<FlowImageFolderItem | null>(null);

  useEffect(() => {
    if (selectedFolderId === 'all') return;
    if (!folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(folders[0]?.id || 'all');
    }
  }, [folders, selectedFolderId]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      const folderMatched = selectedFolderId === 'all' || item.folderId === selectedFolderId;
      if (!folderMatched) return false;
      if (!normalizedQuery) return true;
      return [
        item.title,
        item.notes,
        item.sourceProjectTitle,
        item.lastEditType,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [items, query, selectedFolderId]);

  const selectedFolderName =
    selectedFolderId === 'all'
      ? '全部素材'
      : folders.find((folder) => folder.id === selectedFolderId)?.name || '素材夹';

  const downloadItem = async (item: FlowImageFolderItem) => {
    const link = document.createElement('a');
    link.href = item.imageUrl;
    link.download = `${item.title || 'flow-image'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={pageStyle}>
      <aside style={sidebarStyle}>
        <a href="/create/flow" style={backLinkStyle}><ArrowLeft size={16} />返回 Flow Canvas</a>
        <div style={brandStyle}><ImageIcon size={20} />素材库</div>
        <button
          type="button"
          style={folderButtonStyle(selectedFolderId === 'all')}
          onClick={() => setSelectedFolderId('all')}
        >
          <span>全部素材</span>
          <span style={countStyle}>{items.length}</span>
        </button>
        <div style={folderSectionTitleStyle}>文件夹</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              style={folderButtonStyle(folder.id === selectedFolderId)}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Folder size={15} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder.name}</span>
              </span>
              <span style={countStyle}>{folder.itemIds.length}</span>
            </button>
          ))}
        </div>
      </aside>

      <main style={mainStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={titleStyle}>{selectedFolderName}</h1>
            <div style={subtitleStyle}>管理 Flow Canvas 保存的图片、编辑来源和本地缓存。</div>
          </div>
          <div style={searchWrapStyle}>
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、备注、项目、编辑类型"
              style={searchInputStyle}
            />
          </div>
        </header>

        {filteredItems.length === 0 ? (
          <div style={emptyStyle}>
            <ImageIcon size={44} strokeWidth={1.2} />
            <div style={{ fontSize: 18, fontWeight: 900 }}>还没有素材</div>
            <div style={{ color: '#8b93a3', fontSize: 13 }}>在图片节点工具栏点击“添加到文件夹”后会显示在这里。</div>
          </div>
        ) : (
          <div style={gridStyle}>
            {filteredItems.map((item) => (
              <article key={item.id} style={cardStyle} onClick={() => setPreviewItem(item)}>
                <div style={thumbStyle}>
                  <ResolvedImage item={item} style={thumbImageStyle} />
                </div>
                <div style={cardBodyStyle}>
                  <div style={cardTitleStyle}>{item.title}</div>
                  <div style={metaStyle}>
                    {item.lastEditType || '原图'} · {item.naturalWidth && item.naturalHeight ? `${item.naturalWidth}×${item.naturalHeight}` : '未知尺寸'}
                  </div>
                  {item.notes && <div style={notesStyle}>{item.notes}</div>}
                  <div style={cardActionsStyle}>
                    <button type="button" style={smallActionStyle} onClick={(event) => { event.stopPropagation(); void downloadItem(item); }}>
                      <Download size={14} />下载
                    </button>
                    <a href="/create/flow" style={smallActionStyle} onClick={(event) => event.stopPropagation()}>
                      <ExternalLink size={14} />来源
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {previewItem && (
        <div style={previewOverlayStyle} onClick={() => setPreviewItem(null)}>
          <div style={previewPanelStyle} onClick={(event) => event.stopPropagation()}>
            <div style={previewImageWrapStyle}>
              <ResolvedImage item={previewItem} style={previewImageStyle} />
            </div>
            <div style={previewInfoStyle}>
              <div style={previewTitleStyle}>{previewItem.title}</div>
              <div style={previewMetaStyle}>项目：{previewItem.sourceProjectTitle || '未知项目'}</div>
              <div style={previewMetaStyle}>编辑类型：{previewItem.lastEditType || '原图'}</div>
              <div style={previewMetaStyle}>缓存：{previewItem.assetId ? 'IndexedDB 本地缓存' : '原始 URL'}</div>
              {previewItem.notes && <p style={previewNotesStyle}>{previewItem.notes}</p>}
              <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
                <button type="button" style={primaryButtonStyle} onClick={() => void downloadItem(previewItem)}>
                  <Download size={15} />下载
                </button>
                <a href="/create/flow" style={secondaryButtonStyle}>打开 Flow Canvas</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const pageStyle: React.CSSProperties = { position: 'fixed', inset: 0, display: 'grid', gridTemplateColumns: '260px 1fr', background: '#09090f', color: '#e5e7eb', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const sidebarStyle: React.CSSProperties = { borderRight: '1px solid rgba(255,255,255,0.08)', padding: 18, background: 'rgba(15,15,22,0.92)', display: 'flex', flexDirection: 'column', gap: 10 };
const backLinkStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', textDecoration: 'none', fontSize: 13, fontWeight: 800, marginBottom: 14 };
const brandStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, color: '#f8fafc', fontSize: 20, fontWeight: 950, marginBottom: 16 };
const folderSectionTitleStyle: React.CSSProperties = { margin: '14px 0 2px', color: '#64748b', fontSize: 12, fontWeight: 900 };
const folderButtonStyle = (active: boolean): React.CSSProperties => ({ height: 42, border: active ? '1px solid rgba(14,165,233,0.36)' : '1px solid rgba(255,255,255,0.07)', borderRadius: 13, background: active ? 'rgba(14,165,233,0.15)' : 'rgba(255,255,255,0.035)', color: active ? '#e0f2fe' : '#cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 12px', fontSize: 13, fontWeight: 850, textAlign: 'left' });
const countStyle: React.CSSProperties = { minWidth: 24, height: 22, borderRadius: 999, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: 12 };
const mainStyle: React.CSSProperties = { minWidth: 0, overflow: 'auto', padding: '30px 34px 44px' };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, marginBottom: 26 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 950, letterSpacing: 0 };
const subtitleStyle: React.CSSProperties = { marginTop: 7, color: '#8b93a3', fontSize: 14 };
const searchWrapStyle: React.CSSProperties = { width: 340, height: 42, borderRadius: 14, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', color: '#94a3b8' };
const searchInputStyle: React.CSSProperties = { flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: '#e5e7eb', fontSize: 13 };
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 };
const cardStyle: React.CSSProperties = { borderRadius: 8, overflow: 'hidden', background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer' };
const thumbStyle: React.CSSProperties = { aspectRatio: '4 / 3', background: '#111', display: 'grid', placeItems: 'center' };
const thumbImageStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const cardBodyStyle: React.CSSProperties = { padding: 13, display: 'grid', gap: 7 };
const cardTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const metaStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 12 };
const notesStyle: React.CSSProperties = { color: '#cbd5e1', fontSize: 12, lineHeight: 1.45, minHeight: 34 };
const cardActionsStyle: React.CSSProperties = { display: 'flex', gap: 8, marginTop: 4 };
const smallActionStyle: React.CSSProperties = { minHeight: 30, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.055)', color: '#dbeafe', padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', textDecoration: 'none', fontSize: 12, fontWeight: 850 };
const emptyStyle: React.CSSProperties = { minHeight: 420, border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 8, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 10, color: '#64748b' };
const previewOverlayStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.68)', backdropFilter: 'blur(10px)', display: 'grid', placeItems: 'center', padding: 30 };
const previewPanelStyle: React.CSSProperties = { width: 'min(940px, calc(100vw - 60px))', height: 'min(620px, calc(100vh - 60px))', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, borderRadius: 8, padding: 18, background: 'rgba(28,28,34,0.98)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 28px 90px rgba(0,0,0,0.55)' };
const previewImageWrapStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, borderRadius: 8, overflow: 'hidden', background: '#0b0b0d', display: 'grid', placeItems: 'center' };
const previewImageStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain', display: 'block' };
const previewInfoStyle: React.CSSProperties = { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 };
const previewTitleStyle: React.CSSProperties = { fontSize: 20, fontWeight: 950, color: '#fff' };
const previewMetaStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 13, lineHeight: 1.5 };
const previewNotesStyle: React.CSSProperties = { margin: '8px 0 0', color: '#d1d5db', fontSize: 13, lineHeight: 1.6 };
const primaryButtonStyle: React.CSSProperties = { height: 38, border: 'none', borderRadius: 999, background: '#fff', color: '#111', padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 13, fontWeight: 900, cursor: 'pointer' };
const secondaryButtonStyle: React.CSSProperties = { height: 38, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: '#f8fafc', padding: '0 16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', fontSize: 13, fontWeight: 900 };

export default ImageLibraryPage;
