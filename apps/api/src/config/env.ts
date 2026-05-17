export type ApiEnv = {
  accessTokenTtlSeconds: number;
  credentialKeyVersion: string;
  credentialMasterKey: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  nodeEnv: string;
  refreshTokenTtlSeconds: number;
  s3AccessKeyId: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3Region: string;
  s3SecretAccessKey: string;
};

const DEV_ACCESS_SECRET = "dev_access_secret_change_me";
const DEV_CREDENTIAL_KEY_VERSION = "v1";
const DEV_CREDENTIAL_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const DEV_REFRESH_SECRET = "dev_refresh_secret_change_me";
const DEV_S3_ACCESS_KEY_ID = "minio";
const DEV_S3_BUCKET = "aigc-flow-dev";
const DEV_S3_ENDPOINT = "http://localhost:9000";
const DEV_S3_FORCE_PATH_STYLE = true;
const DEV_S3_REGION = "us-east-1";
const DEV_S3_SECRET_ACCESS_KEY = "minio123456";

export function getApiEnv(): ApiEnv {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const jwtAccessSecret =
    process.env.JWT_ACCESS_SECRET?.trim() ||
    (isProduction ? "" : DEV_ACCESS_SECRET);
  const credentialMasterKey =
    process.env.CREDENTIAL_MASTER_KEY?.trim() ||
    (isProduction ? "" : DEV_CREDENTIAL_MASTER_KEY);
  const credentialKeyVersion =
    process.env.CREDENTIAL_KEY_VERSION?.trim() ||
    DEV_CREDENTIAL_KEY_VERSION;
  const jwtRefreshSecret =
    process.env.JWT_REFRESH_SECRET?.trim() ||
    (isProduction ? "" : DEV_REFRESH_SECRET);

  if (!jwtAccessSecret) {
    throw new Error("JWT_ACCESS_SECRET is required to start the v2 API");
  }

  if (isProduction && !jwtRefreshSecret) {
    throw new Error("JWT_REFRESH_SECRET is required to start the v2 API");
  }

  if (!credentialMasterKey) {
    throw new Error("CREDENTIAL_MASTER_KEY is required to start the v2 API");
  }

  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    (isProduction ? "" : DEV_S3_ENDPOINT);
  const s3Region =
    process.env.S3_REGION?.trim() ||
    (isProduction ? "" : DEV_S3_REGION);
  const s3Bucket =
    process.env.S3_BUCKET?.trim() ||
    (isProduction ? "" : DEV_S3_BUCKET);
  const s3AccessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    (isProduction ? "" : DEV_S3_ACCESS_KEY_ID);
  const s3SecretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    (isProduction ? "" : DEV_S3_SECRET_ACCESS_KEY);
  const s3ForcePathStyleRaw =
    process.env.S3_FORCE_PATH_STYLE?.trim() ||
    String(DEV_S3_FORCE_PATH_STYLE);

  if (!s3Endpoint) {
    throw new Error("S3_ENDPOINT is required to start the v2 API");
  }

  if (!s3Region) {
    throw new Error("S3_REGION is required to start the v2 API");
  }

  if (!s3Bucket) {
    throw new Error("S3_BUCKET is required to start the v2 API");
  }

  if (!s3AccessKeyId) {
    throw new Error("S3_ACCESS_KEY_ID is required to start the v2 API");
  }

  if (!s3SecretAccessKey) {
    throw new Error("S3_SECRET_ACCESS_KEY is required to start the v2 API");
  }

  return {
    accessTokenTtlSeconds: 60 * 15,
    credentialKeyVersion,
    credentialMasterKey,
    jwtAccessSecret,
    jwtRefreshSecret,
    nodeEnv,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
    s3AccessKeyId,
    s3Bucket,
    s3Endpoint,
    s3ForcePathStyle: s3ForcePathStyleRaw.toLowerCase() === "true",
    s3Region,
    s3SecretAccessKey,
  };
}
