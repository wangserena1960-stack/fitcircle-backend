// FitCircle API - Worker v2
// - 正式登入 API: POST /api/login （查 admins 表）
// - Demo 登入:      GET  /api/login-debug
// - Dashboard 總覽: GET  /api/admin/overview
// - 已啟用簡單 CORS（方便 Pages 前端呼叫）

const ALLOWED_ORIGIN = "*"; // 你日後想鎖網域，可改成 "https://fitcircle-frontend.pages.dev"

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS 預檢請求
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    try {
      // 健康檢查首頁
      if (pathname === "/" && request.method === "GET") {
        return textResponse("FitCircle API WORKER v2 (login, overview)");
      }

      // Demo 登入：仍保留方便除錯
      if (pathname === "/api/login-debug" && request.method === "GET") {
        return handleLoginDebug(url);
      }

      // ✅ 正式登入：POST /api/login
      if (pathname === "/api/login" && request.method === "POST") {
        return handleLogin(request, env);
      }

      // Dashboard 總覽：GET /api/admin/overview
      if (pathname === "/api/admin/overview" && request.method === "GET") {
        return handleAdminOverview(env);
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
// 會查 admins 表，找到就回傳 admin 資料；找不到回 401

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

  // D1: admins(email TEXT PRIMARY KEY, password TEXT, name TEXT, role TEXT, created_at TEXT)
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
    // 查無此人或密碼錯誤
    return jsonResponse(
      { success: false, error: "帳號或密碼錯誤" },
      401
    );
  }

  // 這裡可以之後再加 JWT / session，目前先回傳簡單 token
  const token = "demo-static-token"; // 之後可改成真正簽發的 token

  return jsonResponse({
    success: true,
    token,
    admin,
  });
}

/* ---------------- Handler: Dashboard 總覽 ---------------- */
// GET /api/admin/overview
// 目前只簡單計數，未做權限驗證（之後可加 token 驗證）

async function handleAdminOverview(env) {
  const result = {
    coaches: 0,
    students: 0,
    classes: 0,
    pendingLeaves: 0,
    totalPayments: 0,
  };

  try {
    // 教練數
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
    // 學生數
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
    // 課程數
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
    // 待處理請假（status = 'pending'）
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
    // 已記錄付款總額
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
