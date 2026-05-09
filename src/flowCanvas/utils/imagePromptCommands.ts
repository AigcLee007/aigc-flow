export interface ImageSlashCommand {
  id: string;
  label: string;
  prompt: string;
}

export const IMAGE_SLASH_COMMANDS: ImageSlashCommand[] = [
  {
    id: 'multi_cam_grid',
    label: '多机位九宫格',
    prompt: '基于关键帧参考图，从同一画面生成9种运镜角度参考，保持主体一致性和场景连续性。',
  },
  {
    id: 'cinematic_light_fix',
    label: '电影级光影校正',
    prompt: '修正物理光照与色温逻辑，呈现专业电影质感，保持主体与构图稳定。',
  },
  {
    id: 'character_three_view',
    label: '角色三视图生成',
    prompt: '一键生成角色三视图（正面/侧面/背面），保持服饰材质和角色识别特征一致。',
  },
  {
    id: 'predict_plus_3s',
    label: '画面推演-3秒后',
    prompt: '基于物理逻辑，生成3秒后的动作结果，保持镜头与场景连续。',
  },
  {
    id: 'predict_minus_5s',
    label: '画面推演-5秒前',
    prompt: '基于物理逻辑，反推5秒前的动作起因，保持主体与场景一致。',
  },
];

export const extractMentionQuery = (text: string, caret: number): string | null => {
  const before = text.slice(0, Math.max(0, caret));
  const match = before.match(/@([^\s@/]*)$/);
  return match ? match[1] || '' : null;
};

export const extractSlashQuery = (text: string, caret: number): string | null => {
  const before = text.slice(0, Math.max(0, caret));
  const match = before.match(/\/([^\s@/]*)$/);
  return match ? match[1] || '' : null;
};

export const applySlashCommandToPrompt = (currentPrompt: string, commandPrompt: string): string => {
  const normalized = String(currentPrompt || '').trim();
  if (!normalized) return commandPrompt;
  return `${normalized}\n${commandPrompt}`;
};
