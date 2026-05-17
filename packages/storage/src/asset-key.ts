const MAX_FILENAME_LENGTH = 120;
const FALLBACK_FILENAME = "file";

function getSafeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return "";
  }

  const extension = filename.slice(lastDot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) {
    return "";
  }

  return `.${extension}`;
}

function normalizeFilename(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() ?? "";
}

export function sanitizeObjectFilename(filename: string): string {
  const normalized = normalizeFilename(filename).normalize("NFKC");
  const withoutDotTraversal = normalized.replace(/\.\.+/g, ".");
  const safeBase = withoutDotTraversal
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  const extension = getSafeExtension(safeBase);
  const basename = (extension ? safeBase.slice(0, -extension.length) : safeBase)
    .replace(/\.+/g, ".")
    .replace(/^\.*/, "")
    .slice(0, MAX_FILENAME_LENGTH);
  const finalBase = basename || FALLBACK_FILENAME;
  return `${finalBase}${extension}`;
}

export type AssetObjectKeyInput = {
  assetId: string;
  filename: string;
  tenantId: string;
};

export function buildAssetObjectKey(input: AssetObjectKeyInput): string {
  const safeFilename = sanitizeObjectFilename(input.filename);
  return `tenants/${input.tenantId}/assets/${input.assetId}/original-${safeFilename}`;
}
