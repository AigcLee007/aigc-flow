export type ApiEnv = {
  accessTokenTtlSeconds: number;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  nodeEnv: string;
  refreshTokenTtlSeconds: number;
};

const DEV_ACCESS_SECRET = "dev_access_secret_change_me";
const DEV_REFRESH_SECRET = "dev_refresh_secret_change_me";

export function getApiEnv(): ApiEnv {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const jwtAccessSecret =
    process.env.JWT_ACCESS_SECRET?.trim() ||
    (isProduction ? "" : DEV_ACCESS_SECRET);
  const jwtRefreshSecret =
    process.env.JWT_REFRESH_SECRET?.trim() ||
    (isProduction ? "" : DEV_REFRESH_SECRET);

  if (!jwtAccessSecret) {
    throw new Error("JWT_ACCESS_SECRET is required to start the v2 API");
  }

  if (isProduction && !jwtRefreshSecret) {
    throw new Error("JWT_REFRESH_SECRET is required to start the v2 API");
  }

  return {
    accessTokenTtlSeconds: 60 * 15,
    jwtAccessSecret,
    jwtRefreshSecret,
    nodeEnv,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  };
}
