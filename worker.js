// worker.js － FitCircle API（LOGIN DEBUG 版）

// 這兩個是 demo 帳號（跟前端顯示的一樣）
const DEMO_EMAIL = "owner@fitcircle.dev";
const DEMO_PASSWORD = "fitcircle123";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function plainResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    // ===== 0. 根路徑：顯示版本字串（用來確認是不是最新的 Worker） =====
    if (!pathname.startsWith("/api")) {
      return plainResponse("FitCircle API LOGIN-DEBUG v2025-11-30");
    }

    // 嘗試解析 JSON body（POST 才需要）
    let body = {};
    if (request.method === "POST") {
      try {
        body = await request.json();
      } catch (e) {
        body = {};
      }
    }

    // ===== 1. GET /api/login-debug?email=...&password=... =====
    // 用瀏覽器就可以直接測試 login 判斷邏輯
    if (pathname === "/api/login-debug" && request.method === "GET") {
      const email = (url.searchParams.get("email") || "").trim();
      const password = (url.searchParams.get("password") || "").trim();
      const matchDemo = email === DEMO_EMAIL && password === DEMO_PASSWORD;
      return jsonResponse({
        email,
        password,
        matchDemo,
        demoEmail: DEMO_EMAIL,
        demoPassword: DEMO_PASSWORD,
      });
    }

    // ===== 2. POST /api/login  真正登入（先不碰 DB，純比對 demo 帳號） =====
    if (pathname === "/api/login" && request.method === "POST") {
      const email = (body.email || "").trim();
      const password = (body.password || "").trim();

      if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
        const token = `demo-token-${Date.now()}`;
        return jsonResponse({
          token,
          user: {
            id: 1,
            email: DEMO_EMAIL,
            name: "平台 Owner",
            role: "super_admin",
          },
        });
      } else {
        return jsonResponse({ error: "Invalid email or password" }, 401);
      }
    }

    // ====== 從這裡開始才會使用 D1 Database ======
    const db = env.DB;

    // ---- Admin Overview ----
    if (pathname === "/api/admin/overview" && request.method === "GET") {
      try {
        const coachesRow = await db
          .prepare("SELECT COUNT(*) AS c FROM coaches")
          .first();
        const studentsRow = await db
          .prepare("SELECT COUNT(*) AS c FROM students")
          .first();
        const classesRow = await db
          .prepare("SELECT COUNT(*) AS c FROM classes")
          .first();
        const pendingLeavesRow = await db
          .prepare(
            "SELECT COUNT(*) AS c FROM leave_requests WHERE status = 'pending'"
          )
          .first();
        const paymentsRow = await db
          .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments")
          .first();

        return jsonResponse({
          coaches: coachesRow?.c || 0,
          students: studentsRow?.c || 0,
          classes: classesRow?.c || 0,
          pendingLeaves: pendingLeavesRow?.c || 0,
          totalPayments: paymentsRow?.total || 0,
        });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to load overview", detail: String(err) },
          500
        );
      }
    }

    // ---- Admin Coaches ----
    if (pathname === "/api/admin/coaches" && request.method === "GET") {
      try {
        const { results } = await db
          .prepare(
            "SELECT * FROM coaches ORDER BY created_at DESC, id DESC"
          )
          .all();
        return jsonResponse(results || []);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to load coaches", detail: String(err) },
          500
        );
      }
    }

    if (pathname === "/api/admin/coaches" && request.method === "POST") {
      try {
        const { name, email, phone, line_id } = body;
        if (!name) {
          return jsonResponse({ error: "name is required" }, 400);
        }
        const info = await db
          .prepare(
            `INSERT INTO coaches (name, email, phone, line_id, active, created_at)
             VALUES (?, ?, ?, ?, 1, datetime('now'))`
          )
          .bind(name, email || null, phone || null, line_id || null)
          .run();
        return jsonResponse({ id: info.lastInsertRowId });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to create coach", detail: String(err) },
          500
        );
      }
    }

    // ---- Admin Students ----
    if (pathname === "/api/admin/students" && request.method === "GET") {
      try {
        const { results } = await db
          .prepare(
            "SELECT * FROM students ORDER BY created_at DESC, id DESC"
          )
          .all();
        return jsonResponse(results || []);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to load students", detail: String(err) },
          500
        );
      }
    }

    if (pathname === "/api/admin/students" && request.method === "POST") {
      try {
        const { name, email, phone, line_id } = body;
        if (!name) {
          return jsonResponse({ error: "name is required" }, 400);
        }
        const info = await db
          .prepare(
            `INSERT INTO students (name, email, phone, line_id, created_at)
             VALUES (?, ?, ?, ?, datetime('now'))`
          )
          .bind(name, email || null, phone || null, line_id || null)
          .run();
        return jsonResponse({ id: info.lastInsertRowId });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to create student", detail: String(err) },
          500
        );
      }
    }

    // ---- Classes ----
    if (pathname === "/api/classes" && request.method === "GET") {
      try {
        const { results } = await db
          .prepare(
            `SELECT c.*, co.name AS coach_name
             FROM classes c
             LEFT JOIN coaches co ON c.coach_id = co.id
             ORDER BY c.created_at DESC, c.id DESC`
          )
          .all();
        return jsonResponse(results || []);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to load classes", detail: String(err) },
          500
        );
      }
    }

    if (pathname === "/api/classes" && request.method === "POST") {
      try {
        const {
          coach_id,
          name,
          location,
          schedule_text,
          capacity,
          term_price,
          term_classes,
          dropin_price,
          rule_no_leave,
          rule_allow_delay,
          rule_allow_dropin,
        } = body;

        if (!coach_id || !name) {
          return jsonResponse(
            { error: "coach_id and name are required" },
            400
          );
        }

        const info = await db
          .prepare(
            `INSERT INTO classes (
               coach_id, name, location, schedule_text, capacity,
               term_price, term_classes, dropin_price,
               rule_no_leave, rule_allow_delay, rule_allow_dropin,
               created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            coach_id,
            name,
            location || null,
            schedule_text || null,
            capacity || null,
            term_price || null,
            term_classes || null,
            dropin_price || null,
            rule_no_leave ? 1 : 0,
            rule_allow_delay ? 1 : 0,
            rule_allow_dropin ? 1 : 0
          )
          .run();

        return jsonResponse({ id: info.lastInsertRowId });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to create class", detail: String(err) },
          500
        );
      }
    }

    // ---- Payments (/api/students/:id/payments) ----
    if (
      pathname.startsWith("/api/students/") &&
      pathname.endsWith("/payments")
    ) {
      const parts = pathname.split("/");
      const studentId = parseInt(parts[3], 10);

      if (!studentId || Number.isNaN(studentId)) {
        return jsonResponse({ error: "Invalid student id" }, 400);
      }

      if (request.method === "GET") {
        try {
          const { results } = await db
            .prepare(
              `SELECT p.*, c.name AS class_name
               FROM payments p
               LEFT JOIN classes c ON p.class_id = c.id
               WHERE p.student_id = ?
               ORDER BY p.paid_at DESC, p.id DESC`
            )
            .bind(studentId)
            .all();
          return jsonResponse(results || []);
        } catch (err) {
          return jsonResponse(
            { error: "Failed to load payments", detail: String(err) },
            500
          );
        }
      }

      if (request.method === "POST") {
        try {
          const { class_id, amount, paid_at, channel, note } = body;
          if (!amount) {
            return jsonResponse({ error: "amount is required" }, 400);
          }
          const info = await db
            .prepare(
              `INSERT INTO payments (
                 student_id, class_id, amount, paid_at, channel, note, created_at
               )
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
            )
            .bind(
              studentId,
              class_id || null,
              amount,
              paid_at || null,
              channel || null,
              note || null
            )
            .run();
          return jsonResponse({ id: info.lastInsertRowId });
        } catch (err) {
          return jsonResponse(
            { error: "Failed to create payment", detail: String(err) },
            500
          );
        }
      }
    }

    // ---- Leave Requests ----
    if (pathname === "/api/leave-requests" && request.method === "GET") {
      try {
        const status = url.searchParams.get("status") || "pending";
        const { results } = await db
          .prepare(
            `SELECT lr.*,
                    s.name AS student_name,
                    c.name AS class_name
             FROM leave_requests lr
             LEFT JOIN students s ON lr.student_id = s.id
             LEFT JOIN classes c ON lr.class_id = c.id
             WHERE lr.status = ?
             ORDER BY lr.created_at DESC, lr.id DESC`
          )
          .bind(status)
          .all();
        return jsonResponse(results || []);
      } catch (err) {
        return jsonResponse(
          { error: "Failed to load leave requests", detail: String(err) },
          500
        );
      }
    }

    if (pathname === "/api/leave-requests" && request.method === "POST") {
      try {
        const {
          student_id,
          class_id,
          type,
          lesson_date,
          new_lesson_date,
          reason_student,
        } = body;

        if (!student_id || !class_id || !type || !lesson_date) {
          return jsonResponse(
            { error: "student_id, class_id, type, lesson_date are required" },
            400
          );
        }

        const info = await db
          .prepare(
            `INSERT INTO leave_requests (
               student_id, class_id, type,
               lesson_date, new_lesson_date,
               status, reason_student, reason_coach,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL,
                     datetime('now'), datetime('now'))`
          )
          .bind(
            student_id,
            class_id,
            type,
            lesson_date,
            new_lesson_date || null,
            reason_student || null
          )
          .run();

        return jsonResponse({ id: info.lastInsertRowId });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to create leave request", detail: String(err) },
          500
        );
      }
    }

    if (
      pathname.startsWith("/api/leave-requests/") &&
      pathname.endsWith("/decision") &&
      request.method === "POST"
    ) {
      try {
        const parts = pathname.split("/");
        const id = parseInt(parts[3], 10);
        const { decision, reason_coach } = body;

        if (!id || Number.isNaN(id)) {
          return jsonResponse({ error: "Invalid leave request id" }, 400);
        }
        if (!decision || !["accept", "reject"].includes(decision)) {
          return jsonResponse(
            { error: "decision must be 'accept' or 'reject'" },
            400
          );
        }

        const newStatus = decision === "accept" ? "accepted" : "rejected";

        await db
          .prepare(
            `UPDATE leave_requests
             SET status = ?, reason_coach = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .bind(newStatus, reason_coach || null, id)
          .run();

        return jsonResponse({ ok: true });
      } catch (err) {
        return jsonResponse(
          { error: "Failed to update leave request", detail: String(err) },
          500
        );
      }
    }

    // ---- 404 ----
    return jsonResponse({ error: "Not found" }, 404);
  },
};
