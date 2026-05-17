import { getAuthorizedV2Headers } from './accountIdentity';

const API_BASE_URL = '/api';

const cleanUrl = (url: string) => url.replace(/\/$/, '');

export interface AssetDownloadUrlResponse {
  expiresAt: string;
  method: 'GET';
  url: string;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Request failed with status ${response.status}`);
  }

  return payload as T;
}

export async function getAssetDownloadUrl(assetId: string): Promise<AssetDownloadUrlResponse> {
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/v2/assets/${assetId}/download-url`, {
    method: 'GET',
    headers: {
      ...(await getAuthorizedV2Headers()),
      'Content-Type': 'application/json',
    },
  });

  return parseJsonResponse<AssetDownloadUrlResponse>(response);
}
