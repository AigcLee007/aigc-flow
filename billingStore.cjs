/*
 * Legacy billing store only.
 *
 * This file is kept for migration support and explicit legacy fallback usage.
 * v2 production billing lives under apps/api, apps/worker, and packages/db.
 */
const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./billingStore.mysql.cjs")
  : require("./billingStore.file.cjs");
