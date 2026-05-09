import { getImageModelById } from '../../config/imageModels';
import { getImageRouteById } from '../../config/imageRoutes';
import type { ImageEditType } from '../runtime/graphExecutor';

export type FlowImageEditModelGroup = 'gpt-image-2' | 'nano-banana-2' | 'nano-banana-pro' | 'generic';

export interface ImageEditMappingInput {
  editType: ImageEditType;
  modelId: string;
  routeId?: string;
  sourceParams?: Record<string, any>;
  editParams?: Record<string, any>;
}

export interface ImageEditModelMapping {
  group: FlowImageEditModelGroup;
  transport: string;
  payloadParams: Record<string, any>;
  debug: {
    mappedFields: string[];
    editSemantics: Record<string, any>;
  };
}

const compactObject = (value: Record<string, any>) => {
  const next: Record<string, any> = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item === undefined || item === null || item === '') return;
    next[key] = item;
  });
  return next;
};

const detectGroup = (modelId: string): FlowImageEditModelGroup => {
  const model = getImageModelById(modelId);
  const text = [
    modelId,
    model?.label,
    model?.requestModel,
    model?.modelFamily,
    model?.routeFamily,
  ].map((value) => String(value || '').toLowerCase()).join(' ');

  if (text.includes('gpt-image-2')) return 'gpt-image-2';
  if (text.includes('nano-banana-2') || text.includes('flash-image-preview')) return 'nano-banana-2';
  if (text.includes('nano-banana') || text.includes('gemini-3-pro-image')) return 'nano-banana-pro';
  return 'generic';
};

const normalizeGptSize = (size: string, aspectRatio: string) => {
  const normalizedSize = String(size || '').toLowerCase();
  const normalizedRatio = String(aspectRatio || '').trim();
  if (normalizedSize === '4k') return '4096x4096';
  if (normalizedSize === '2k') return '2048x2048';
  if (normalizedRatio === '16:9') return '1536x864';
  if (normalizedRatio === '9:16') return '864x1536';
  if (normalizedRatio === '4:3') return '1344x1008';
  if (normalizedRatio === '3:4') return '1008x1344';
  return '1024x1024';
};

const editSemanticsByType: Record<ImageEditType, Record<string, any>> = {
  inpaint: { operation: 'inpaint', requiresMask: true, outputStrategy: 'new-downstream-node' },
  erase: { operation: 'erase', requiresMask: true, outputStrategy: 'new-downstream-node' },
  outpaint: { operation: 'outpaint', requiresMask: true, outputStrategy: 'new-downstream-node' },
  relight: { operation: 'relight', requiresMask: false, outputStrategy: 'new-downstream-node' },
  multiAngle: { operation: 'multi-angle', requiresMask: false, outputStrategy: 'new-downstream-node' },
  enhance: { operation: 'enhance', requiresMask: false, outputStrategy: 'new-downstream-node' },
  removeBackground: { operation: 'remove-background', requiresMask: false, outputStrategy: 'new-downstream-node' },
};

export const buildImageEditModelMapping = ({
  editType,
  modelId,
  routeId,
  sourceParams = {},
  editParams = {},
}: ImageEditMappingInput): ImageEditModelMapping => {
  const group = detectGroup(modelId);
  const route = getImageRouteById(routeId);
  const mergedParams = { ...sourceParams, ...editParams };
  const aspectRatio = String(mergedParams.aspect_ratio || mergedParams.aspectRatio || '1:1');
  const size = String(mergedParams.size || mergedParams.image_size || '1k');
  const payloadParams: Record<string, any> = {};
  const mappedFields: string[] = [];

  if (group === 'gpt-image-2') {
    payloadParams.size = normalizeGptSize(size, aspectRatio);
    payloadParams.quality = mergedParams.quality || (editType === 'enhance' ? 'high' : 'medium');
    payloadParams.output_format = mergedParams.output_format || 'png';
    payloadParams.moderation = mergedParams.moderation || 'auto';
    mappedFields.push('size', 'quality', 'output_format', 'moderation');
  } else {
    payloadParams.image_size = size;
    payloadParams.aspect_ratio = aspectRatio;
    mappedFields.push('image_size', 'aspect_ratio');
  }

  if (mergedParams.maskMode) {
    payloadParams.maskMode = mergedParams.maskMode;
    mappedFields.push('maskMode');
  }

  if (editType === 'outpaint' && mergedParams.outpaint) {
    payloadParams.outpaint = mergedParams.outpaint;
    mappedFields.push('outpaint');
  }
  if (editType === 'relight' && mergedParams.relight) {
    payloadParams.relight = mergedParams.relight;
    mappedFields.push('relight');
  }
  if (editType === 'multiAngle' && mergedParams.multiAngle) {
    payloadParams.multiAngle = mergedParams.multiAngle;
    mappedFields.push('multiAngle');
  }

  return {
    group,
    transport: route?.transport || 'unknown',
    payloadParams: compactObject(payloadParams),
    debug: {
      mappedFields,
      editSemantics: editSemanticsByType[editType],
    },
  };
};

export const IMAGE_EDIT_MODEL_MAPPING_NOTES = [
  'gpt-image-2: size 使用像素尺寸，默认输出 png，增强默认 high quality。',
  'nano-banana / Gemini: 使用 image_size 与 aspect_ratio，复杂编辑语义保存在 params 中供后端或后续模型适配。',
  'maskMode: transparent-edit / white-edit 会随 payload 保留，便于实测不同上游 mask 语义。',
];
