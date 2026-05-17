/*
 * Legacy auth store only.
 *
 * This file is kept for migration support and explicit legacy fallback usage.
 * v2 production auth lives under apps/api and packages/db.
 */
const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./authStore.mysql.cjs")
  : require("./authStore.file.cjs");
