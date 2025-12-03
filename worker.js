// FitCircle API - Worker v3
// - 正式登入:        POST /api/login
// - Demo 登入:        GET  /api/login-debug
// - Dashboard 總覽:   GET  /api/admin/overview
// - 教練管理 CRUD:   GET/POST/PUT/DELETE /api/coaches[...]

const ALLOWED_ORIGIN = "*"; // 之後可改成 "https://fitcircle-frontend.pages.dev"

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS 預檢
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    try {
      // 健康檢查
      if (pathname === "/" && request.method === "GET") {
        return textResponse("FitCircle API WORKER v3 (login, overview, coaches)");
      }

      // Demo 登入
      if (pathname === "/api/login-debug" && request.method === "GET") {
        return handleLoginDebug(url);
      }

      // 正式登入
      if (pathname === "/api/login" && request.method === "POST") {
        return handleLogin(request, env);
      }

      // Dashboard 總覽
      if (pathname === "/api/admin/overview" && request.method === "GET") {
        return handleAdminOverview(env);
      }

      // 教練管理
      if (pathname === "/api/coaches" && request.method === "GET") {
        return handleGetCoaches(env);
      }
      if (pathname === "/api/coaches" && request.method === "POST") {
        return handleCreateCoach(request, env);
      }
      if (pathname.startsWith("/api/coaches/")) {
        const id = pathname.split("/")[3]; // /api/coaches/:id
        if (!id) return jsonResponse({ error: "Coach id is required" }, 400);

        if (request.method === "PUT") {
          return handleUpdateCoach(request, env, id);
        }
        if (request.method === "DELETE") {
          return handleDeleteCoach(env, id);
        }
      }

      return jsonResponse({ error: "Not found" }, 404);
    } catch (err) {
      console.error("Unhandled error in fetch:", err);
      return jsonResponse({ error: "Internal error" }, 500);
    }
  },
};

/* ---------------- CORS ---------------- */

function withCors(resp) {
  const headers = new Headers(resp.headers);

  headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(resp.body, {
    status: resp.status,
    headers,
  });
}

function handleOptions(request) {
  const headers = new Headers();

  headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");

  const reqHeaders = request.headers.get("Access-Control-Request-Headers");
  if (reqHeaders) {
    headers.set("Access-Control-Allow-Headers", reqHeaders);
  } else {
    headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }

  headers.set("Access-Control-Max-Age", "86400");

  return new Response(null, {
    status: 204,
    headers,
  });
}

/* ---------------- Helpers ---------------- */

function jsonResponse(obj, status = 200) {
  const resp = new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  return withCors(resp);
}

function textResponse(text, status = 200) {
  const resp = new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
  return withCors(resp);
}

/* ---------------- Handler: Demo Login ---------------- */
// GET /api/login-debug?email=...&password=...

function handleLoginDebug(url) {
  const email = url.searchParams.get("email") || "";
  const password = url.searchParams.get("password") || "";

  const demoEmail = "owner@fitcircle.dev";
  const demoPassword = "fitcircle123";

  const matchDemo = email === demoEmail && password === demoPassword;

  return jsonResponse({
    email,
    password,
    matchDemo,
    demoEmail,
    demoPassword,
  });
}

/* ---------------- Handler: 正式登入 ---------------- */
// POST /api/login
// Body: { email, password }

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email || "").trim();
  const password = (body.password || "").trim();

  if (!email || !password) {
    return jsonResponse(
      { error: "Email 與 password 為必填欄位" },
      400
    );
  }

  let admin;
  try {
    const stmt = env.DB.prepare(
      "SELECT email, name, role, created_at FROM admins WHERE email = ? AND password = ? LIMIT 1"
    ).bind(email, password);

    admin = await stmt.first();
  } catch (err) {
    console.error("D1 login query error:", err);
    return jsonResponse({ error: "資料庫查詢失敗" }, 500);
  }

  if (!admin) {
    return jsonResponse(
      { success: false, error: "帳號或密碼錯誤" },
      401
    );
  }

  const token = "demo-static-token"; // 之後可改 JWT

  return jsonResponse({
    success: true,
    token,
    admin,
  });
}

/* ---------------- Handler: Dashboard 總覽 ---------------- */

async function handleAdminOverview(env) {
  const result = {
    coaches: 0,
    students: 0,
    classes: 0,
    pendingLeaves: 0,
    totalPayments: 0,
  };

  try {
    const rowCoaches = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM coaches"
    ).first();
    if (rowCoaches && typeof rowCoaches.c !== "undefined") {
      result.coaches = Number(rowCoaches.c) || 0;
    }
  } catch (err) {
    console.error("Error counting coaches:", err);
  }

  try {
    const rowStudents = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM students"
    ).first();
    if (rowStudents && typeof rowStudents.c !== "undefined") {
      result.students = Number(rowStudents.c) || 0;
    }
  } catch (err) {
    console.error("Error counting students:", err);
  }

  try {
    const rowClasses = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM classes"
    ).first();
    if (rowClasses && typeof rowClasses.c !== "undefined") {
      result.classes = Number(rowClasses.c) || 0;
    }
  } catch (err) {
    console.error("Error counting classes:", err);
  }

  try {
    const rowPending = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'"
    ).first();
    if (rowPending && typeof rowPending.c !== "undefined") {
      result.pendingLeaves = Number(rowPending.c) || 0;
    }
  } catch (err) {
    console.error("Error counting pending leaves:", err);
  }

  try {
    const rowPayments = await env.DB.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM payments"
    ).first();
    if (rowPayments && typeof rowPayments.total !== "undefined") {
      result.totalPayments = Number(rowPayments.total) || 0;
    }
  } catch (err) {
    console.error("Error summing payments:", err);
  }

  return jsonResponse(result);
}

/* ---------------- Handler: 教練管理 ---------------- */

/**
 * GET /api/coaches
 * 回傳所有教練（包含 is_active 欄位）
 */
async function handleGetCoaches(env) {
  try {
    const stmt = env.DB.prepare(
      "SELECT id, name, email, phone, notes, is_active, created_at FROM coaches ORDER BY created_at DESC"
    );
    const rows = await stmt.all();
    // D1 .all() 回傳 { results: [...] }
    const list = rows?.results || rows || [];
    return jsonResponse(list);
  } catch (err) {
    console.error("Error fetching coaches:", err);
    return jsonResponse({ error: "取得教練列表失敗" }, 500);
  }
}

/**
 * POST /api/coaches
 * Body: { name, email?, phone?, notes? }
 */
async function handleCreateCoach(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();
  const notes = (body.notes || "").trim();

  if (!name) {
    return jsonResponse({ error: "教練名稱為必填" }, 400);
  }

  try {
    const stmt = env.DB.prepare(
      "INSERT INTO coaches (name, email, phone, notes, is_active, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))"
    ).bind(name, email, phone, notes);

    const info = await stmt.run();
    const id = info.lastRowId || info.last_insert_rowid || null;

    return jsonResponse({
      success: true,
      id,
    }, 201);
  } catch (err) {
    console.error("Error creating coach:", err);
    return jsonResponse({ error: "新增教練失敗" }, 500);
  }
}

/**
 * PUT /api/coaches/:id
 * Body: { name?, email?, phone?, notes?, is_active? }
 */
async function handleUpdateCoach(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const fields = [];
  const values = [];

  function addField(column, value) {
    fields.push(`${column} = ?`);
    values.push(value);
  }

  if (typeof body.name === "string") addField("name", body.name.trim());
  if (typeof body.email === "string") addField("email", body.email.trim());
  if (typeof body.phone === "string") addField("phone", body.phone.trim());
  if (typeof body.notes === "string") addField("notes", body.notes.trim());
  if (typeof body.is_active !== "undefined") {
    addField("is_active", body.is_active ? 1 : 0);
  }

  if (fields.length === 0) {
    return jsonResponse({ error: "沒有任何可更新的欄位" }, 400);
  }

  values.push(id);

  const sql = `UPDATE coaches SET ${fields.join(", ")} WHERE id = ?`;

  try {
    const stmt = env.DB.prepare(sql).bind(...values);
    await stmt.run();
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Error updating coach:", err);
    return jsonResponse({ error: "更新教練失敗" }, 500);
  }
}

/**
 * DELETE /api/coaches/:id
 * 目前做「真正刪除」，之後若要軟刪除可改成 is_active = 0
 */
async function handleDeleteCoach(env, id) {
  try {
    const stmt = env.DB.prepare(
      "DELETE FROM coaches WHERE id = ?"
    ).bind(id);
    await stmt.run();
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Error deleting coach:", err);
    return jsonResponse({ error: "刪除教練失敗" }, 500);
  }
}
