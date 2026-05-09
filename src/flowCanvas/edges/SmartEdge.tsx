/**
 * Custom Edge Component
 * Phase 0: Smart edge with minimal styling
 */
import React, { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  EdgeLabelRenderer,
  getEdgeCenter,
  useReactFlow,
} from '@xyflow/react';
import { Scissors } from 'lucide-react';
import type { FlowEdgeData } from '../types';
import { useFlowCanvasStore } from '../store/flowCanvasStore';

const DATA_TYPE_COLORS: Record<string, string> = {
  text: '#64748b',
  image: '#3b82f6',
  video: '#a78bfa',
  audio: '#f59e0b',
  json: '#10b981',
  any: '#6b7280',
};

export const SmartEdgeComponent = memo(function SmartEdge(props: EdgeProps) {
  const {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    data,
    selected,
  } = props;

  const edgeData = data as FlowEdgeData | undefined;
  const dataType = edgeData?.dataType || 'any';
  const color = DATA_TYPE_COLORS[dataType] || DATA_TYPE_COLORS.any;

  const { setEdges } = useReactFlow();
  const isNodeDragging = useFlowCanvasStore((state) => state.isNodeDragging);
  const [hovered, setHovered] = React.useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const onDisconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEdges((es) => es.filter((e) => e.id !== props.id));
  };

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...style,
          stroke: selected ? '#60a5fa' : color,
          strokeWidth: selected ? 2.5 : 2,
          opacity: isNodeDragging ? 0.72 : hovered ? 1 : 0.6,
          transition: isNodeDragging ? 'none' : 'opacity 0.12s',
        }}
        interactionWidth={20} // Larger interaction area for hover
      />
      
      {/* Invisible wide path for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => {
          if (!isNodeDragging) setHovered(true);
        }}
        onMouseLeave={() => {
          if (!isNodeDragging) setHovered(false);
        }}
        style={{ cursor: 'pointer', pointerEvents: isNodeDragging ? 'none' : 'all' }}
      />

      {!isNodeDragging && (
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
            zIndex: 1000,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            onClick={onDisconnect}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              transition: 'transform 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <Scissors size={14} />
          </button>
        </div>
      </EdgeLabelRenderer>
      )}
    </>
  );
});
