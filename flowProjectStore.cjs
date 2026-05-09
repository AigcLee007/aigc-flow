const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");
const {
  fromDbDateTime,
  getPool,
  isMySqlConfigured,
  toDbDateTime,
} = require("./db.cjs");

let flowProjectSchemaPromise = null;
const LOCAL_JSON_PATH = path.join(__dirname, "flow_projects.local.json");

const ensureFlowProjectSchema = async () => {
  if (!isMySqlConfigured()) return;
  if (!flowProjectSchemaPromise) {
    flowProjectSchemaPromise = (async () => {
      const pool = await getPool();
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS flow_projects (
          id VARCHAR(40) PRIMARY KEY,
          user_id VARCHAR(120) NOT NULL,
          title VARCHAR(255) NOT NULL,
          nodes_json LONGTEXT NOT NULL,
          edges_json LONGTEXT NOT NULL,
          viewport_json LONGTEXT NOT NULL,
          version INT NOT NULL DEFAULT 1,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          INDEX idx_flow_projects_user (user_id),
          INDEX idx_flow_projects_user_updated (user_id, updated_at DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })();
  }
  return flowProjectSchemaPromise;
};

// ─── Local file fallback helpers ────────────────────────────
const readLocalProjects = () => {
  try {
    if (fs.existsSync(LOCAL_JSON_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_JSON_PATH, "utf8"));
    }
  } catch (error) {
    console.warn("[FlowProjectStore] Failed to read local JSON:", error.message);
  }
  return [];
};

const writeLocalProjects = (projects) => {
  try {
    fs.writeFileSync(LOCAL_JSON_PATH, JSON.stringify(projects, null, 2), "utf8");
  } catch (error) {
    console.warn("[FlowProjectStore] Failed to write local JSON:", error.message);
  }
};

// ─── Mapper ───
const mapRowToProject = (row) => {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    userId: String(row.user_id || row.userId || ""),
    title: String(row.title || ""),
    nodes: typeof row.nodes_json === "string" ? JSON.parse(row.nodes_json) : (row.nodes || []),
    edges: typeof row.edges_json === "string" ? JSON.parse(row.edges_json) : (row.edges || []),
    viewport: typeof row.viewport_json === "string" ? JSON.parse(row.viewport_json) : (row.viewport || { x: 0, y: 0, zoom: 1 }),
    version: Number(row.version || 1),
    createdAt: fromDbDateTime(row.created_at || row.createdAt),
    updatedAt: fromDbDateTime(row.updated_at || row.updatedAt),
  };
};

const createFlowProject = async (payload = {}) => {
  const id = payload.id || `flow_${randomBytes(8).toString("hex")}`;
  const userId = String(payload.userId || "").trim() || "guest";
  const title = String(payload.title || "").trim() || "未命名项目";
  const nodes = payload.nodes || [];
  const edges = payload.edges || [];
  const viewport = payload.viewport || { x: 0, y: 0, zoom: 1 };
  const version = Number(payload.version || 1);
  const now = new Date();

  if (isMySqlConfigured()) {
    await ensureFlowProjectSchema();
    const pool = await getPool();
    const nowDb = toDbDateTime(now);
    await pool.execute(
      `
        INSERT INTO flow_projects (
          id, user_id, title, nodes_json, edges_json, viewport_json, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        userId,
        title,
        JSON.stringify(nodes),
        JSON.stringify(edges),
        JSON.stringify(viewport),
        version,
        nowDb,
        nowDb,
      ]
    );
    return mapRowToProject({
      id,
      user_id: userId,
      title,
      nodes_json: JSON.stringify(nodes),
      edges_json: JSON.stringify(edges),
      viewport_json: JSON.stringify(viewport),
      version,
      created_at: nowDb,
      updated_at: nowDb,
    });
  } else {
    const projects = readLocalProjects();
    const newProject = {
      id,
      userId,
      title,
      nodes,
      edges,
      viewport,
      version,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    projects.push(newProject);
    writeLocalProjects(projects);
    return newProject;
  }
};

const getFlowProjectById = async (id, userId) => {
  if (isMySqlConfigured()) {
    await ensureFlowProjectSchema();
    const pool = await getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM flow_projects WHERE id = ? AND user_id = ? LIMIT 1",
      [id, userId]
    );
    return rows[0] ? mapRowToProject(rows[0]) : null;
  } else {
    const projects = readLocalProjects();
    const found = projects.find((p) => p.id === id && p.userId === userId);
    return found || null;
  }
};

const listFlowProjectsForUser = async (userId) => {
  if (isMySqlConfigured()) {
    await ensureFlowProjectSchema();
    const pool = await getPool();
    const [rows] = await pool.execute(
      "SELECT * FROM flow_projects WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
    return (rows || []).map((row) => mapRowToProject(row));
  } else {
    const projects = readLocalProjects();
    return projects
      .filter((p) => p.userId === userId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
};

const updateFlowProject = async (id, userId, patch = {}) => {
  const now = new Date();
  if (isMySqlConfigured()) {
    await ensureFlowProjectSchema();
    const pool = await getPool();
    const nowDb = toDbDateTime(now);

    // Build patch dynamically
    const fields = ["updated_at = ?"];
    const params = [nowDb];

    if (patch.title !== undefined) {
      fields.push("title = ?");
      params.push(String(patch.title || "").trim());
    }
    if (patch.nodes !== undefined) {
      fields.push("nodes_json = ?");
      params.push(JSON.stringify(patch.nodes));
    }
    if (patch.edges !== undefined) {
      fields.push("edges_json = ?");
      params.push(JSON.stringify(patch.edges));
    }
    if (patch.viewport !== undefined) {
      fields.push("viewport_json = ?");
      params.push(JSON.stringify(patch.viewport));
    }
    if (patch.version !== undefined) {
      fields.push("version = ?");
      params.push(Number(patch.version || 1));
    }

    params.push(id, userId);

    await pool.execute(
      `UPDATE flow_projects SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      params
    );

    const [rows] = await pool.execute(
      "SELECT * FROM flow_projects WHERE id = ? AND user_id = ? LIMIT 1",
      [id, userId]
    );
    return rows[0] ? mapRowToProject(rows[0]) : null;
  } else {
    const projects = readLocalProjects();
    const index = projects.findIndex((p) => p.id === id && p.userId === userId);
    if (index === -1) return null;

    const current = projects[index];
    const updated = {
      ...current,
      ...patch,
      updatedAt: now.toISOString(),
    };
    projects[index] = updated;
    writeLocalProjects(projects);
    return updated;
  }
};

const deleteFlowProject = async (id, userId) => {
  if (isMySqlConfigured()) {
    await ensureFlowProjectSchema();
    const pool = await getPool();
    const [result] = await pool.execute(
      "DELETE FROM flow_projects WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    return Number(result?.affectedRows || 0) > 0;
  } else {
    const projects = readLocalProjects();
    const filtered = projects.filter((p) => !(p.id === id && p.userId === userId));
    const deleted = projects.length !== filtered.length;
    if (deleted) {
      writeLocalProjects(filtered);
    }
    return deleted;
  }
};

module.exports = {
  createFlowProject,
  getFlowProjectById,
  listFlowProjectsForUser,
  updateFlowProject,
  deleteFlowProject,
};
