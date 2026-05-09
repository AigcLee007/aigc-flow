import React, { useMemo } from 'react';
import { ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { getImageModelOptions } from '../../config/imageModels';
import { getEditableRoutesForModel } from '../../config/imageEditCapabilities';
import { IMAGE_EDIT_MODEL_MAPPING_NOTES, buildImageEditModelMapping } from '../utils/imageEditModelMapping';
import type { ImageEditType } from '../runtime/graphExecutor';

const editTypes: Array<{ id: ImageEditType; label: string }> = [
  { id: 'inpaint', label: '重绘' },
  { id: 'erase', label: '擦除' },
  { id: 'outpaint', label: '扩图' },
  { id: 'relight', label: '打光' },
  { id: 'multiAngle', label: '多角度' },
  { id: 'enhance', label: '增强' },
  { id: 'removeBackground', label: '抠图' },
];

const ImageEditMappingPage: React.FC = () => {
  const rows = useMemo(() => {
    return getImageModelOptions()
      .filter((model) => model.isActive !== false)
      .flatMap((model) => {
        const routes = getEditableRoutesForModel(model.id);
        return routes.flatMap((route) =>
          editTypes.map((editType) => {
            const mapping = buildImageEditModelMapping({
              editType: editType.id,
              modelId: model.id,
              routeId: route.routeId,
              sourceParams: { size: route.defaultSize, aspect_ratio: '1:1' },
              editParams: editType.id === 'relight'
                ? { relight: { brightness: 50, colorTemperature: 5600, direction: 'left' } }
                : editType.id === 'multiAngle'
                  ? { multiAngle: { angleId: 'left45', mode: 'subject', rotation: -45, tilt: 0, zoom: 50 } }
                  : {},
            });
            return {
              model,
              route,
              editType,
              mapping,
            };
          }),
        );
      });
  }, []);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <a href="/create/flow" style={backLinkStyle}><ArrowLeft size={16} />返回 Flow Canvas</a>
        <div style={titleWrapStyle}>
          <div style={iconWrapStyle}><SlidersHorizontal size={24} /></div>
          <div>
            <h1 style={titleStyle}>AI 模型参数映射</h1>
            <div style={subtitleStyle}>用于核对 Flow 图片编辑提交到 `/api/edit` 前的模型族、线路、payload 字段与编辑语义。</div>
          </div>
        </div>
      </header>

      <section style={notesStyle}>
        {IMAGE_EDIT_MODEL_MAPPING_NOTES.map((note) => <div key={note}>{note}</div>)}
      </section>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>模型</th>
              <th style={thStyle}>线路</th>
              <th style={thStyle}>编辑</th>
              <th style={thStyle}>模型族</th>
              <th style={thStyle}>转发字段</th>
              <th style={thStyle}>Payload 示例</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.model.id}-${row.route.routeId}-${row.editType.id}-${index}`}>
                <td style={tdStyle}>{row.model.label}</td>
                <td style={tdStyle}>{row.route.routeLabel}</td>
                <td style={tdStyle}>{row.editType.label}</td>
                <td style={tdStyle}>{row.mapping.group}</td>
                <td style={tdStyle}>{row.mapping.debug.mappedFields.join(', ') || '-'}</td>
                <td style={monoTdStyle}>{JSON.stringify(row.mapping.payloadParams)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const pageStyle: React.CSSProperties = { minHeight: '100vh', background: '#09090f', color: '#e5e7eb', padding: '28px 34px 44px', boxSizing: 'border-box', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' };
const headerStyle: React.CSSProperties = { display: 'grid', gap: 18, marginBottom: 20 };
const backLinkStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, color: '#94a3b8', textDecoration: 'none', fontSize: 13, fontWeight: 850 };
const titleWrapStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 14 };
const iconWrapStyle: React.CSSProperties = { width: 52, height: 52, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'rgba(14,165,233,0.13)', color: '#7dd3fc', border: '1px solid rgba(14,165,233,0.24)' };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 950, letterSpacing: 0 };
const subtitleStyle: React.CSSProperties = { marginTop: 7, color: '#8b93a3', fontSize: 14 };
const notesStyle: React.CSSProperties = { display: 'grid', gap: 8, borderRadius: 8, padding: 14, background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.18)', color: '#dbeafe', fontSize: 13, marginBottom: 18 };
const tableWrapStyle: React.CSSProperties = { borderRadius: 8, overflow: 'auto', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', minWidth: 980 };
const thStyle: React.CSSProperties = { position: 'sticky', top: 0, background: '#15151f', color: '#cbd5e1', padding: '12px 14px', textAlign: 'left', fontSize: 12, fontWeight: 900, borderBottom: '1px solid rgba(255,255,255,0.08)' };
const tdStyle: React.CSSProperties = { padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 13, color: '#d1d5db', verticalAlign: 'top' };
const monoTdStyle: React.CSSProperties = { ...tdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#bae6fd', fontSize: 12 };

export default ImageEditMappingPage;
