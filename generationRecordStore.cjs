/*
 * Legacy generation record store only.
 *
 * This file is kept for migration support and explicit legacy fallback usage.
 * v2 production workflow execution persists runs in PostgreSQL instead.
 */
const { isMySqlConfigured } = require("./db.cjs");

module.exports = isMySqlConfigured()
  ? require("./generationRecordStore.mysql.cjs")
  : require("./generationRecordStore.file.cjs");
