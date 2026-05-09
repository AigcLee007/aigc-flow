export const IMAGE_EDIT_RETRY_HINT = '参数已保留，可直接再次提交。';

export function getImageEditErrorMessage(error: unknown, fallback = '图片编辑提交失败，请检查网络或模型配置后重试。') {
  if (!error) return fallback;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  const maybeMessage = (error as { message?: unknown })?.message;
  if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;

  return fallback;
}

export function getImageEditRetryMessage(error: unknown, fallback?: string) {
  return `${getImageEditErrorMessage(error, fallback)} ${IMAGE_EDIT_RETRY_HINT}`;
}
