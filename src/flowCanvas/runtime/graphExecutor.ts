/**
 * Graph Executor - TapNow-style embedded generation
 *
 * Each content node (image/video) can trigger generation from its own prompt bar.
 * Results are written back into the same node (thumbnailUrl / posterUrl).
 */
import { useFlowCanvasStore } from '../store/flowCanvasStore';
import { generateImageApi, generateTextApi, editImageApi, checkTaskStatus, findAllUrlsInObject } from '../../../services/api';
import { generateVideo } from '../../../services/videoService';
import { getSelectedImageRoute } from '../../config/imageRoutes';
import { getSelectedVideoRoute } from '../../config/videoRoutes';
import { DEFAULT_TEXT_MODEL_ID } from '../../config/textModels';
import { getImageNaturalSize, imageUrlToBase64 } from '../utils/imageUtils';
import { getImageEditErrorMessage } from '../utils/imageEditStatus';
import { buildImageEditModelMapping } from '../utils/imageEditModelMapping';
import {
  FLOW_NODE_DEFAULT_SIZES,
  fitMediaNodeToShortSide,
  getMediaNodeSizeFromRatioString,
  parseAspectRatio,
} from '../utils/nodeSizing';

export type ImageEditType =
  | 'inpaint'
  | 'erase'
  | 'outpaint'
  | 'relight'
  | 'multiAngle'
  | 'enhance'
  | 'removeBackground';

export interface RunImageEditParams {
  image?: string;
  mask?: string;
  prompt?: string;
  direction?: 'left' | 'right' | 'top' | 'bottom' | 'all';
  scale?: number;
  title?: string;
  modelId?: string;
  routeId?: string;
  params?: Record<string, any>;
}

export const mergeImageReferences = (upstreamImages: string[], data: any): string[] => {
  return [
    ...upstreamImages,
    ...(Array.isArray(data?.referenceImages)
      ? data.referenceImages.map((item: unknown) => String(item || ''))
      : []),
  ]
    .filter((item) => item && typeof item === 'string')
    .filter((item, index, arr) => arr.indexOf(item) === index);
};

const resolveReferenceImagesForPayload = async (
  references: string[],
  options: { forceBase64: boolean },
): Promise<string[]> => {
  const resolved = await Promise.all(
    references.map(async (item) => {
      const raw = String(item || '').trim();
      if (!raw) return '';
      if (raw.startsWith('data:image/')) return raw;

      const isLocalBlob = raw.startsWith('blob:');
      if (isLocalBlob) {
        console.warn('[GraphExecutor] Dropping browser-local blob reference image:', raw);
        return '';
      }
      if (!options.forceBase64 && !isLocalBlob) return raw;

      try {
        return await imageUrlToBase64(raw);
      } catch (error) {
        console.warn('[GraphExecutor] Dropping unavailable reference image:', raw, error);
        return '';
      }
    }),
  );

  return resolved.filter(Boolean);
};

const buildImageResultItems = (urls: string[]) => {
  const now = Date.now();
  return urls
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .map((url, index) => ({
      id: `result-${now}-${index}`,
      url,
      createdAt: now,
    }));
};

const normalizeTaskStatus = (taskStatus: any): string => {
  const raw =
    taskStatus?.status ??
    taskStatus?.state ??
    taskStatus?.data?.status ??
    taskStatus?.data?.state ??
    '';
  return String(raw).trim().toLowerCase();
};

const extractTaskProgress = (taskStatus: any): number => {
  const rawProgress = taskStatus?.progress ?? taskStatus?.data?.progress ?? 0;
  if (typeof rawProgress === 'string') {
    const parsed = Number(rawProgress.replace('%', '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const numeric = Number(rawProgress);
  return Number.isFinite(numeric) ? numeric : 0;
};

const extractTaskErrorMessage = (taskStatus: any): string => {
  return (
    taskStatus?.fail_reason ||
    taskStatus?.errorMessage ||
    taskStatus?.error ||
    taskStatus?.data?.fail_reason ||
    taskStatus?.data?.errorMessage ||
    taskStatus?.data?.error ||
    '生成失败'
  );
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label}超时，请稍后重试`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
};

/**
 * Trigger generation for a content node (image or video).
 * Called from the node's send button.
 */
export async function runNodeGeneration(nodeId: string) {
  const store = useFlowCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const d = node.data;

  // Mark as generating
  store.updateNodeData(nodeId, {
    generationStatus: 'generating',
    status: 'running',
    progress: 0,
    errorMessage: undefined,
    results: undefined,
  });

  // Collect prompt: prefer generationPrompt, then text, then upstream
  let prompt = d.generationPrompt || d.text || '';

  // Check upstream nodes for additional context
  const upstreams = store.getUpstreamNodes(nodeId);
  const upstreamImages: string[] = [];
  const upstreamTexts: string[] = [];
  const upstreamVideos: string[] = [];

  for (const upstream of upstreams) {
    if ((upstream.type === 'text' || upstream.data.kind === 'text') && upstream.data.text) {
      upstreamTexts.push(String(upstream.data.text));
      if (!prompt) {
        prompt = String(upstream.data.text);
      }
    }
    if ((upstream.type === 'image' || upstream.data.kind === 'image') && upstream.data.thumbnailUrl) {
      upstreamImages.push(String(upstream.data.thumbnailUrl));
    }
    if ((upstream.type === 'video' || upstream.data.kind === 'video') && upstream.data.posterUrl) {
      upstreamVideos.push(String(upstream.data.posterUrl));
    }
  }

  try {
    if (node.type === 'text' || d.kind === 'text') {
      await runTextGeneration(nodeId, prompt, d, upstreamTexts, upstreamImages, upstreamVideos);
    } else if (node.type === 'image' || d.kind === 'image') {
      await runImageGeneration(nodeId, prompt, upstreamImages, d);
    } else if (node.type === 'video' || d.kind === 'video') {
      await runVideoGeneration(nodeId, prompt, upstreamImages, d);
    } else {
      throw new Error('该节点类型不支持生成');
    }
  } catch (error: any) {
    console.error('[GraphExecutor] Generation failed:', error);
    store.updateNodeData(nodeId, {
      generationStatus: 'error',
      status: 'error',
      errorMessage: error.message || '生成请求失败',
    });
  }
}

// Text Generation
async function runTextGeneration(
  nodeId: string,
  prompt: string,
  data: any,
  upstreamTexts: string[] = [],
  upstreamImages: string[] = [],
  upstreamVideos: string[] = [],
) {
  const store = useFlowCanvasStore.getState();
  const modelId = data.modelId || DEFAULT_TEXT_MODEL_ID;
  const contextualTexts = [...upstreamTexts];
  const upstreamImagePayloads = (
    await Promise.all(
      upstreamImages.slice(0, 3).map(async (imageUrl, index) => {
        try {
          return await withTimeout(imageUrlToBase64(imageUrl), 12000, `上游图片 ${index + 1} 读取`);
        } catch (error) {
          console.warn('[GraphExecutor] Failed to prepare upstream image for text generation:', error);
          contextualTexts.push(`上游图片素材 ${index + 1}：${imageUrl}`);
          return '';
        }
      }),
    )
  ).filter(Boolean);

  upstreamVideos.slice(0, 3).forEach((videoUrl) => {
    contextualTexts.push(`上游视频素材：${videoUrl}`);
  });

  const res = await withTimeout(
    generateTextApi({
      modelId,
      prompt: prompt || (upstreamImages.length > 0 ? '请分析上游图片并生成可复用提示词' : upstreamVideos.length > 0 ? '请分析上游视频并生成摘要和可复用提示词' : '请帮我写一段文字'),
      n: 1,
      upstreamTexts: contextualTexts,
      upstreamImages: upstreamImagePayloads,
    }),
    90000,
    '文本生成',
  );

  const finalResults = Array.isArray(res.results) ? res.results.filter(Boolean) : [];
  if (finalResults.length === 0) {
    throw new Error('文本模型未返回有效内容');
  }

  store.updateNodeData(nodeId, {
    results: finalResults,
    text: finalResults.join('\n\n'),
    fontSize: 'body',
    fontWeight: 'normal',
    fontStyle: 'normal',
    modelId: res.model || modelId,
    generationStatus: 'done',
    status: 'success',
    progress: 100,
  });
}

// Image Generation
async function runImageGeneration(
  nodeId: string,
  prompt: string,
  upstreamImages: string[],
  data: any,
) {
  const store = useFlowCanvasStore.getState();
  const modelId = data.modelId || 'nano-banana';
  const params = data.params || {};
  const allReferenceImages = mergeImageReferences(upstreamImages, data);

  // Resolve route
  let routeId = data.routeId;
  if (!routeId) {
    const routeObj = getSelectedImageRoute(modelId);
    if (routeObj) routeId = routeObj.id;
  }

  if (!data.thumbnailUrl) {
    const fallbackAspectRatio = parseAspectRatio(params.aspect_ratio) || 4 / 3;
    const displaySize = getMediaNodeSizeFromRatioString(params.aspect_ratio, fallbackAspectRatio);
    store.updateNodeData(nodeId, {
      width: displaySize.width,
      height: displaySize.height,
      aspectRatio: fallbackAspectRatio,
      routeId: routeId || undefined,
    });
  }

  const payload: any = {
    modelId,
    routeId,
    prompt: prompt || '一张精美的 AI 生成图片',
    uiMode: 'flow',
    ...params,
  };
  const batchCount = Math.max(1, Number(data.batchCount || params.n || 1));
  payload.n = batchCount;

  store.updateNodeData(nodeId, {
    lastGenerationSnapshot: {
      modelId: String(modelId || ''),
      routeId: routeId ? String(routeId) : undefined,
      prompt: String(payload.prompt || ''),
      size: params.size ? String(params.size) : undefined,
      aspectRatio: params.aspect_ratio ? String(params.aspect_ratio) : undefined,
      quality: params.quality ? String(params.quality) : undefined,
      n: batchCount,
      referenceImageCount: allReferenceImages.length,
      activeCommandId: data.activeCommandId ? String(data.activeCommandId) : undefined,
      generatedAt: Date.now(),
    },
  });

  const isGptImage2Model = String(modelId || '').toLowerCase().includes('gpt-image-2');
  const hasReferenceImages = allReferenceImages.length > 0;

  // GPT-image-2 routing parity with the original canvas:
  // - text-to-image (no refs): /images/generations
  // - image-to-image (with refs): /images/edits
  if (hasReferenceImages) {
    const resolvedReferenceImages = await resolveReferenceImagesForPayload(allReferenceImages, {
      forceBase64: isGptImage2Model,
    });
    if (resolvedReferenceImages.length === 0) {
      throw new Error('参考图链接已失效，请重新上传或重新拖入参考图后再生成');
    }
    payload.image = resolvedReferenceImages[0];
    payload.images = resolvedReferenceImages;
    payload.reference_images = resolvedReferenceImages;
  }

  const res = isGptImage2Model && hasReferenceImages
    ? await editImageApi(undefined, payload)
    : await generateImageApi(undefined, payload);

  if (res.url) {
    // Immediate success - write back to same node
    await handleImageSuccess(nodeId, res.url, data, [res.url]);
    return;
  }

  if (res.images && res.images.length > 0) {
    await handleImageSuccess(nodeId, res.images[0], data, res.images);
    return;
  }

  if (res.taskId) {
    await pollImageTask(nodeId, res.taskId);
    return;
  }

  throw new Error('未返回结果或任务 ID');
}

async function pollImageTask(nodeId: string, taskId: string) {
  const store = useFlowCanvasStore.getState();
  let finished = false;
  let pollCount = 0;
  const maxPolls = 180;

  while (!finished && pollCount < maxPolls) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    pollCount++;

    const taskStatus = await checkTaskStatus(undefined, taskId);
    const status = normalizeTaskStatus(taskStatus);

    if (['success', 'succeeded', 'completed'].includes(status)) {
      finished = true;
      const urls: string[] = [];
      findAllUrlsInObject(taskStatus, urls);
      const normalizedUrls = urls
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, arr) => arr.indexOf(item) === index);
      const outputUrl = normalizedUrls[0];
      if (outputUrl) {
        const latestNode = useFlowCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        await handleImageSuccess(nodeId, outputUrl, latestNode?.data || {}, normalizedUrls);
      } else {
        throw new Error('生成成功但未返回结果 URL');
      }
    } else if (['failed', 'error', 'failure'].includes(status)) {
      finished = true;
      throw new Error(extractTaskErrorMessage(taskStatus));
    } else {
      const prog = extractTaskProgress(taskStatus);
      useFlowCanvasStore.getState().updateNodeData(nodeId, {
        progress: prog > 0 ? prog : Math.min(95, pollCount * 2),
      });
    }
  }

  if (!finished) {
    throw new Error('任务超时');
  }
}

async function resolveImageDisplaySize(imageUrl: string, data: any) {
  try {
    const natural = await getImageNaturalSize(imageUrl);
    return {
      ...fitMediaNodeToShortSide(natural.w, natural.h),
      naturalWidth: natural.w,
      naturalHeight: natural.h,
      aspectRatio: natural.w / natural.h,
    };
  } catch {
    const fallbackAspectRatio = parseAspectRatio(data?.params?.aspect_ratio) || 4 / 3;
    return {
      ...getMediaNodeSizeFromRatioString(data?.params?.aspect_ratio, fallbackAspectRatio),
      naturalWidth: undefined,
      naturalHeight: undefined,
      aspectRatio: fallbackAspectRatio,
    };
  }
}

async function handleImageSuccess(nodeId: string, imageUrl: string, data: any, allUrls: string[] = []) {
  const displaySize = await resolveImageDisplaySize(imageUrl, data);
  const resultItems = buildImageResultItems(allUrls.length > 0 ? allUrls : [imageUrl]);
  useFlowCanvasStore.getState().updateNodeData(nodeId, {
    thumbnailUrl: imageUrl,
    ...displaySize,
    generationStatus: 'done',
    status: 'success',
    progress: 100,
    errorMessage: undefined,
    generatedResults: resultItems,
    activeResultIndex: 0,
    coverResultId: resultItems[0]?.id,
  });
}

const IMAGE_EDIT_DEFAULT_PROMPTS: Record<ImageEditType, string> = {
  inpaint: 'Edit the selected area according to the user instruction. Preserve the rest of the image.',
  erase: 'Remove the selected area seamlessly and reconstruct the background naturally. Preserve the rest of the image.',
  outpaint: 'Extend the image naturally beyond the original frame. Preserve the subject, lighting, and style.',
  relight: 'Relight this image naturally. Preserve the subject, identity, composition, and scene details.',
  multiAngle: 'Generate the same subject from a new camera angle. Preserve identity, style, materials, and scene consistency.',
  enhance: 'Enhance this image with sharper details, cleaner texture, and higher visual quality. Preserve the original composition.',
  removeBackground: 'Remove the background cleanly and keep the main subject with natural edges.',
};

const IMAGE_EDIT_TITLES: Record<ImageEditType, string> = {
  inpaint: '重绘后的',
  erase: '擦除后的',
  outpaint: '扩图后的',
  relight: '打光后的',
  multiAngle: '多角度后的',
  enhance: '增强后的',
  removeBackground: '抠图后的',
};

function countDerivedEditResults(sourceNodeId: string, editType: ImageEditType) {
  const store = useFlowCanvasStore.getState();
  const childIds = new Set(
    store.edges.filter((edge) => edge.source === sourceNodeId).map((edge) => edge.target),
  );
  return store.nodes.filter((node) => childIds.has(node.id) && node.data.lastEditType === editType).length;
}

function getDerivedImageNodePosition(sourceNode: any) {
  const sourceWidth = Number(
    sourceNode?.data?.width || sourceNode?.measured?.width || FLOW_NODE_DEFAULT_SIZES.image.width,
  );
  const sourcePosition = sourceNode?.position || { x: 0, y: 0 };
  return {
    x: sourcePosition.x + sourceWidth + 160,
    y: sourcePosition.y,
  };
}

function findReusableFailedEditNode(sourceNodeId: string, editType: ImageEditType) {
  const store = useFlowCanvasStore.getState();
  const childIds = new Set(
    store.edges.filter((edge) => edge.source === sourceNodeId).map((edge) => edge.target),
  );
  return [...store.nodes].reverse().find(
    (node) =>
      childIds.has(node.id) &&
      node.data.lastEditType === editType &&
      node.data.generationStatus === 'error' &&
      !node.data.thumbnailUrl,
  );
}

async function applyImageEditResult(nodeId: string, imageUrl: string, editType: ImageEditType) {
  const store = useFlowCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const displaySize = await resolveImageDisplaySize(imageUrl, node?.data || {});
  const resultItems = buildImageResultItems([imageUrl]);

  store.updateNodeData(nodeId, {
    thumbnailUrl: imageUrl,
    ...displaySize,
    generationStatus: 'done',
    status: 'success',
    progress: 100,
    errorMessage: undefined,
    lastEditType: editType,
    generatedResults: resultItems,
    activeResultIndex: 0,
    coverResultId: resultItems[0]?.id,
  });
}

/**
 * Run an AI image edit and write the result into a new downstream image node.
 * This keeps the original image on canvas and makes the edit chain visible.
 */
export async function runImageEdit(
  sourceNodeId: string,
  editType: ImageEditType,
  editParams: RunImageEditParams = {},
) {
  const store = useFlowCanvasStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) return;

  const sourceData = sourceNode.data || {};
  const sourceImageUrl = String(editParams.image || sourceData.thumbnailUrl || '').trim();
  if (!sourceImageUrl) {
    throw new Error('当前图片节点没有可编辑的图片');
  }

  const modelId = editParams.modelId || String(sourceData.modelId || 'nano-banana-2');
  let routeId = editParams.routeId || String(sourceData.routeId || '');
  if (!routeId) {
    const routeObj = getSelectedImageRoute(modelId);
    if (routeObj) routeId = routeObj.id;
  }

  const prompt = String(editParams.prompt || IMAGE_EDIT_DEFAULT_PROMPTS[editType]).trim();
  const previousUrl = String(sourceData.thumbnailUrl || '');
  const history = Array.isArray(sourceData.editHistory) ? (sourceData.editHistory as string[]) : [];
  const mappedEdit = buildImageEditModelMapping({
    editType,
    modelId,
    routeId,
    sourceParams: (sourceData.params || {}) as Record<string, any>,
    editParams: editParams.params || {},
  });
  const reusableNode = findReusableFailedEditNode(sourceNodeId, editType);
  const resultIndex = reusableNode ? countDerivedEditResults(sourceNodeId, editType) : countDerivedEditResults(sourceNodeId, editType) + 1;
  const title = editParams.title || String(reusableNode?.data.title || `${IMAGE_EDIT_TITLES[editType]}${resultIndex}`);
  const imageEditRequest = {
    sourceNodeId,
    editType,
    prompt,
    direction: editParams.direction,
    scale: editParams.scale,
    modelId,
    routeId,
    params: editParams.params || {},
    submittedAt: Date.now(),
  };
  const nextNodeData: Partial<any> = {
    title,
    thumbnailUrl: undefined,
    width: Number(sourceData.width || FLOW_NODE_DEFAULT_SIZES.image.width),
    height: Number(sourceData.height || FLOW_NODE_DEFAULT_SIZES.image.height),
    originalImageUrl: String(sourceData.originalImageUrl || previousUrl),
    editHistory: previousUrl ? [...history, previousUrl] : history,
    lastEditType: editType,
    editSourceNodeId: sourceNodeId,
    editPrompt: prompt,
    imageEditRequest,
    generationStatus: 'generating',
    status: 'running',
    progress: 1,
    errorMessage: undefined,
    modelId,
    routeId,
    params: {
      ...((sourceData.params || {}) as Record<string, any>),
      ...(editParams.params || {}),
      imageEditMapping: mappedEdit.debug,
      imageEditModelGroup: mappedEdit.group,
    },
  };

  const imageNode = reusableNode || store.addNodeAndEdge(
    'image',
    getDerivedImageNodePosition(sourceNode),
    sourceNodeId,
    'out',
    'in',
    nextNodeData,
  );

  if (reusableNode) {
    store.updateNodeData(reusableNode.id, nextNodeData);
  }

  try {
    const base64Image = sourceImageUrl.startsWith('data:')
      ? sourceImageUrl
      : await imageUrlToBase64(sourceImageUrl);

    const payload: any = {
      modelId,
      routeId,
      image: base64Image,
      prompt,
      uiMode: 'flow',
      editType,
      ...mappedEdit.payloadParams,
      ...(editParams.params || {}),
    };

    if (editParams.mask) payload.mask = editParams.mask;
    if (editParams.direction) payload.outpaint_direction = editParams.direction;
    if (editParams.scale) payload.scale = editParams.scale;

    const res = await editImageApi(undefined, payload);
    const directUrl = res.url || res.images?.[0];

    if (directUrl) {
      await applyImageEditResult(imageNode.id, directUrl, editType);
      return;
    }

    if (res.taskId) {
      await pollImageTask(imageNode.id, res.taskId);
      useFlowCanvasStore.getState().updateNodeData(imageNode.id, { lastEditType: editType });
      return;
    }

    throw new Error('图片编辑未返回结果或任务 ID');
  } catch (error: any) {
    console.error('[GraphExecutor] Image edit failed:', error);
    useFlowCanvasStore.getState().updateNodeData(imageNode.id, {
      generationStatus: 'error',
      status: 'error',
      progress: 0,
      errorMessage: getImageEditErrorMessage(error, '图片编辑请求失败'),
    });
    throw error;
  }
}

// Video Generation
async function runVideoGeneration(
  nodeId: string,
  prompt: string,
  upstreamImages: string[],
  data: any,
) {
  const store = useFlowCanvasStore.getState();
  const modelId = data.modelId || 'veo3.1-fast';
  const params = data.params || {};

  let routeId = data.routeId;
  if (!routeId) {
    const routeObj = getSelectedVideoRoute(modelId);
    if (routeObj) routeId = routeObj.id;
  }

  const options: any = {
    modelId,
    routeId,
    aspect_ratio: params.aspect_ratio || '16:9',
    ...params,
  };

  const videoUrl = await generateVideo(
    undefined,
    modelId,
    prompt || '一段精美的 AI 生成视频',
    upstreamImages.length > 0 ? upstreamImages : undefined,
    (progress) => {
      useFlowCanvasStore.getState().updateNodeData(nodeId, { progress });
    },
    options,
  );

  const displaySize = getMediaNodeSizeFromRatioString(options.aspect_ratio, 16 / 9);
  useFlowCanvasStore.getState().updateNodeData(nodeId, {
    posterUrl: videoUrl,
    ...displaySize,
    aspectRatio: parseAspectRatio(options.aspect_ratio) || 16 / 9,
    generationStatus: 'done',
    status: 'success',
    progress: 100,
    errorMessage: undefined,
  });
}

/**
 * Legacy alias for backwards compatibility
 * @deprecated Use runNodeGeneration instead
 */
export const runSingleNode = runNodeGeneration;


