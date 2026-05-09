/**
 * Floating menu shown when a connection is dropped on empty canvas.
 */
import React, { memo, useEffect, useRef, useState } from 'react';
import { Box, Image as ImageIcon, List, PlaySquare, Wand2 } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useFlowCanvasStore } from '../store/flowCanvasStore';
import type { FlowNodeKind } from '../types';
import { getConnectionActionsForSource, getConnectionAction } from '../rules/connectionRules';

interface ConnectionMenuProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  sourceNodeId: string;
  onClose: () => void;
}

const ICON_BY_KIND: Record<string, React.ReactNode> = {
  text: <List size={26} strokeWidth={1.8} />,
  image: <ImageIcon size={26} strokeWidth={1.75} />,
  video: <PlaySquare size={25} strokeWidth={1.8} />,
  image_editor: <Wand2 size={25} strokeWidth={1.8} />,
  world3d: <Box size={25} strokeWidth={1.75} />,
};

export const ConnectionMenu: React.FC<ConnectionMenuProps> = memo(function ConnectionMenu({
  x,
  y,
  flowX,
  flowY,
  sourceNodeId,
  onClose,
}) {
  const addNodeAndEdge = useFlowCanvasStore((s) => s.addNodeAndEdge);
  const sourceNode = useFlowCanvasStore((s) => s.nodes.find((node) => node.id === sourceNodeId));
  const ref = useRef<HTMLDivElement>(null);
  const actions = getConnectionActionsForSource(sourceNode);
  const [hoveredKind, setHoveredKind] = useState<string>(actions[0]?.kind || '');

  let reactFlow: ReturnType<typeof useReactFlow> | null = null;
  try {
    reactFlow = useReactFlow();
  } catch {}

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    setHoveredKind((current) => (actions.some((action) => action.kind === current) ? current : actions[0]?.kind || ''));
  }, [actions]);

  const handleSelect = (kind: FlowNodeKind) => {
    const flowPos = reactFlow
      ? reactFlow.screenToFlowPosition({ x: x + 28, y: y + 88 })
      : { x: flowX, y: flowY };
    const action = getConnectionAction(sourceNode, kind);

    addNodeAndEdge(kind, flowPos, sourceNodeId, 'out', 'in', {
      generationPrompt: action?.promptSeed || '',
    });
    onClose();
  };

  return (
    <div ref={ref} style={{ ...menuStyle, left: x, top: y }}>
      <div style={headerStyle}>引用该节点生成</div>
      {actions.map((item) => (
        <button
          key={item.kind}
          type="button"
          style={menuItemStyle(hoveredKind === item.kind, false)}
          onClick={() => handleSelect(item.kind)}
          onMouseEnter={() => setHoveredKind(String(item.kind))}
        >
          <span style={iconBoxStyle(hoveredKind === item.kind)}>{ICON_BY_KIND[item.kind]}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={labelStyle}>{item.label}</div>
            {item.desc && hoveredKind === item.kind && <div style={descStyle}>{item.desc}</div>}
          </div>
        </button>
      ))}
      {actions.length === 0 && (
        <div style={emptyStyle}>该节点暂不支持继续生成</div>
      )}
    </div>
  );
});

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 1200,
  width: 432,
  minHeight: 488,
  boxSizing: 'border-box',
  background: 'rgba(25,25,25,0.98)',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 22,
  padding: '20px 18px 18px',
  backdropFilter: 'blur(22px)',
  boxShadow: '0 24px 70px rgba(0,0,0,0.58)',
};

const headerStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: 'rgba(255,255,255,0.44)',
  padding: '0 2px 16px',
  userSelect: 'none',
};

const menuItemStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  minHeight: 78,
  padding: '12px 18px',
  background: active ? 'rgba(255,255,255,0.105)' : 'transparent',
  border: 'none',
  color: disabled ? 'rgba(255,255,255,0.82)' : '#f8fafc',
  cursor: disabled ? 'default' : 'pointer',
  textAlign: 'left',
  borderRadius: 22,
  transition: 'background 140ms ease, transform 140ms ease',
});

const iconBoxStyle = (active: boolean): React.CSSProperties => ({
  width: 56,
  height: 56,
  borderRadius: 15,
  background: active ? 'rgba(255,255,255,0.095)' : 'rgba(255,255,255,0.065)',
  border: active ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.04)',
  color: '#e5e7eb',
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
});

const labelStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 23,
  fontWeight: 850,
  lineHeight: 1.15,
};

const descStyle: React.CSSProperties = {
  fontSize: 17,
  color: 'rgba(255,255,255,0.36)',
  fontWeight: 650,
  marginTop: 9,
};

const emptyStyle: React.CSSProperties = {
  minHeight: 120,
  display: 'grid',
  placeItems: 'center',
  color: 'rgba(255,255,255,0.44)',
  fontSize: 18,
  fontWeight: 750,
};
