/**
 * Entry point for /create/flow.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, LayoutList, MousePointerClick, Music, Sparkles, Video } from 'lucide-react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { AiFlowCanvas } from './canvas/AiFlowCanvas';
import { FlowTopToolbar } from './canvas/FlowTopToolbar';
import { useFlowCanvasStore } from './store/flowCanvasStore';
import type { FlowNodeKind } from './types';

const useFlowShortcuts = () => {
  const undo = useFlowCanvasStore((s) => s.undo);
  const redo = useFlowCanvasStore((s) => s.redo);
  const deleteSelectedNodes = useFlowCanvasStore((s) => s.deleteSelectedNodes);
  const deleteSelectedEdges = useFlowCanvasStore((s) => s.deleteSelectedEdges);
  const duplicateSelectedNodes = useFlowCanvasStore((s) => s.duplicateSelectedNodes);
  const selectAll = useFlowCanvasStore((s) => s.selectAll);
  const deselectAll = useFlowCanvasStore((s) => s.deselectAll);
  const closeImageTool = useFlowCanvasStore((s) => s.closeImageTool);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key === 'd') {
        e.preventDefault();
        duplicateSelectedNodes();
      } else if (ctrl && e.key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') {
        closeImageTool();
        deselectAll();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedNodes();
        deleteSelectedEdges();
      }
    };

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [undo, redo, deleteSelectedNodes, deleteSelectedEdges, duplicateSelectedNodes, selectAll, deselectAll, closeImageTool]);
};

const FLOW_VIEWPORT_META = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

const useFlowViewportLock = () => {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]') || document.createElement('meta');
    const createdMeta = !viewportMeta.parentElement;
    const previousViewport = viewportMeta.getAttribute('content');

    if (createdMeta) {
      viewportMeta.setAttribute('name', 'viewport');
      document.head.appendChild(viewportMeta);
    }

    viewportMeta.setAttribute('content', FLOW_VIEWPORT_META);
    html.classList.add('flow-viewport-lock');
    body.classList.add('flow-viewport-lock');

    return () => {
      html.classList.remove('flow-viewport-lock');
      body.classList.remove('flow-viewport-lock');
      if (createdMeta) {
        viewportMeta.remove();
      } else if (previousViewport !== null) {
        viewportMeta.setAttribute('content', previousViewport);
      } else {
        viewportMeta.removeAttribute('content');
      }
    };
  }, []);
};

const STORAGE_KEY = 'flow-canvas-autosave';
const IDB_STORAGE_KEY = 'flow-canvas-autosave-v2';

const saveFlowSnapshot = async (snapshot: ReturnType<typeof useFlowCanvasStore.getState>['getProjectSnapshot'] extends () => infer T ? T : never) => {
  await idbSet(IDB_STORAGE_KEY, snapshot);
  try {
    const compact = {
      id: snapshot.id,
      title: snapshot.title,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      storedIn: 'indexeddb',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // The IndexedDB copy is authoritative; localStorage is only a small hint.
  }
};

const loadFlowSnapshot = async () => {
  const indexed = await idbGet(IDB_STORAGE_KEY).catch(() => null);
  if (indexed?.nodes?.length > 0) return indexed;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const project = JSON.parse(raw);
    if (project?.nodes?.length > 0) return project;
  } catch (err) {
    console.warn('[FlowCanvas] Legacy auto-load failed:', err);
  }
  return null;
};

const useAutoSave = () => {
  const isDirty = useFlowCanvasStore((s) => s.isDirty);
  const isNodeDragging = useFlowCanvasStore((s) => s.isNodeDragging);
  const getProjectSnapshot = useFlowCanvasStore((s) => s.getProjectSnapshot);
  const markClean = useFlowCanvasStore((s) => s.markClean);

  useEffect(() => {
    const handlePageHide = () => {
      void saveFlowSnapshot(getProjectSnapshot()).catch((err) => {
        console.warn('[FlowCanvas] Auto-save on pagehide failed:', err);
      });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [getProjectSnapshot]);

  useEffect(() => {
    if (!isDirty || isNodeDragging) return;
    let cancelled = false;
    const persist = async () => {
      try {
        const snapshot = getProjectSnapshot();
        await saveFlowSnapshot(snapshot);
        if (!cancelled) markClean();
      } catch (err) {
        console.warn('[FlowCanvas] Auto-save failed:', err);
      }
    };

    const timer = setTimeout(() => {
      void persist();
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isDirty, isNodeDragging, getProjectSnapshot, markClean]);
};

const useAutoLoad = () => {
  const loadProject = useFlowCanvasStore((s) => s.loadProject);
  const nodeCount = useFlowCanvasStore((s) => s.nodes.length);

  useEffect(() => {
    if (nodeCount > 0) return;
    let cancelled = false;
    void loadFlowSnapshot()
      .then((project) => {
        if (!cancelled && project?.nodes?.length > 0 && useFlowCanvasStore.getState().nodes.length === 0) {
          loadProject(project);
        }
      })
      .catch((err) => {
        console.warn('[FlowCanvas] Auto-load failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [loadProject, nodeCount]);
};

const StatsOverlay: React.FC = React.memo(() => {
  const nodeCount = useFlowCanvasStore((s) => s.nodes.length);
  const edgeCount = useFlowCanvasStore((s) => s.edges.length);

  if (nodeCount === 0 && edgeCount === 0) return null;

  return (
    <div style={statsStyle}>
      <span>节点 <span style={{ color: '#60a5fa' }}>{nodeCount}</span></span>
      <span>连线 <span style={{ color: '#34d399' }}>{edgeCount}</span></span>
    </div>
  );
});

const QUICK_TEMPLATES: { icon: React.ReactNode; label: string; kind: FlowNodeKind }[] = [
  { icon: <Video size={23} strokeWidth={1.8} />, label: '文字生视频', kind: 'video' },
  { icon: <ImageIcon size={23} strokeWidth={1.8} />, label: '图片换背景', kind: 'image' },
  { icon: <Sparkles size={22} strokeWidth={1.8} />, label: '首帧生成视频', kind: 'video' },
  { icon: <Music size={23} strokeWidth={1.8} />, label: '音频生视频', kind: 'video' },
  { icon: <LayoutList size={22} strokeWidth={1.8} />, label: '模板', kind: 'text' },
];

const EmptyState: React.FC = React.memo(() => {
  const nodeCount = useFlowCanvasStore((s) => s.nodes.length);
  const addNode = useFlowCanvasStore((s) => s.addNode);
  const { screenToFlowPosition } = useReactFlow();

  if (nodeCount > 0) return null;

  const handleTemplateClick = (kind: FlowNodeKind) => {
    addNode(kind, screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
  };

  return (
    <div style={emptyStyle}>
      <div style={emptyHintStyle}>
        <span style={emptyPillStyle}>
          <MousePointerClick size={26} strokeWidth={1.8} color="#38d5ff" />
          双击
        </span>
        <span style={emptyHintTextStyle}>画布自由生成,或者查看模板</span>
      </div>

      <div style={templateRowStyle}>
        {QUICK_TEMPLATES.map((t, i) => (
          <button key={i} onClick={() => handleTemplateClick(t.kind)} style={templateButtonStyle}>
            <span style={templateIconStyle}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
});

const FlowCanvasPage: React.FC = () => {
  const [cullingEnabled, setCullingEnabled] = useState(true);
  const toggleCulling = useCallback(() => setCullingEnabled((v) => !v), []);

  useFlowShortcuts();
  useFlowViewportLock();
  useAutoSave();
  useAutoLoad();

  return (
    <div style={pageStyle}>
      <FlowTopToolbar onToggleCulling={toggleCulling} cullingEnabled={cullingEnabled} />
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlowProvider>
          <AiFlowCanvas cullingEnabled={cullingEnabled} />
          <StatsOverlay />
          <EmptyState />
        </ReactFlowProvider>
      </div>
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: '#09090f',
  color: '#e2e8f0',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

const statsStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 18,
  left: 366,
  zIndex: 20,
  background: 'rgba(18,18,28,0.82)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: '6px 13px',
  fontSize: 11,
  color: '#64748b',
  fontFamily: 'monospace',
  pointerEvents: 'none',
  display: 'flex',
  gap: 12,
  transition: 'left 0.22s ease',
};

const emptyStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: 10,
  width: 'min(1068px, calc(100vw - 420px))',
  minWidth: 'min(680px, calc(100vw - 48px))',
  textAlign: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
};

const emptyHintStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  marginBottom: 18,
};

const emptyPillStyle: React.CSSProperties = {
  minHeight: 48,
  background: 'rgba(39,39,42,0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 15,
  padding: '0 19px',
  fontSize: 25,
  color: '#f8fafc',
  fontWeight: 800,
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  boxShadow: '0 14px 32px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.05)',
};

const emptyHintTextStyle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.32)',
  fontSize: 25,
  fontWeight: 720,
  whiteSpace: 'nowrap',
};

const templateRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'center',
  pointerEvents: 'auto',
};

const templateButtonStyle: React.CSSProperties = {
  height: 56,
  background: 'rgba(18,18,18,0.92)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: 17,
  padding: '0 24px',
  fontSize: 21,
  fontWeight: 720,
  color: 'rgba(255,255,255,0.48)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 11,
  boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
  transition: 'all 0.15s',
};

const templateIconStyle: React.CSSProperties = {
  display: 'flex',
  color: 'rgba(255,255,255,0.44)',
};

export default FlowCanvasPage;
