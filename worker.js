export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---- CORS ----
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ---- API ROUTER ----
    if (path.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url, path, method);
      } catch (err) {
        console.error("ERROR:", err);
        return json({ error: "Internal Server Error", detail: String(err) }, 500);
      }
    }

    return new Response("FitCircle API is running", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};

/* ---------------------- Helpers ---------------------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/* ---------------------- API Handler ---------------------- */
async function handleApi(request, env, url, path, method) {
  const db = env.DB;
  const seg = path.replace("/api/", "").split("/");

  /* =====================================================
   *  LOGIN
   * ====================================================*/
  if (seg[0] === "login" && method === "POST") {
    const body = await request.json();
    const email = body.email?.trim();
    const password = body.password;

    if (!email || !password)
      return json({ error: "email & password required" }, 400);

    const row = await db
      .prepare("SELECT * FROM admins WHERE email = ?")
      .bind(email)
      .first();

    if (!row || row.password !== password)
      return json({ error: "invalid_credentials" }, 401);

    // simple token for demo
    const token = `token-${row.id}-${Date.now()}`;

    return json({
      token,
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
      },
    });
  }

  /* =====================================================
   *  ADMIN OVERVIEW
   * ====================================================*/
  if (seg[0] === "admin" && seg[1] === "overview" && method === "GET") {
    const coaches = await db.prepare("SELECT COUNT(*) c FROM coaches").first();
    const students = await db.prepare("SELECT COUNT(*) c FROM students").first();
    const classes = await db.prepare("SELECT COUNT(*) c FROM classes").first();
    const pending = await db
      .prepare("SELECT COUNT(*) c FROM leave_requests WHERE status='pending'")
      .first();
    const totalPayments = await db
      .prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments")
      .first();

    return json({
      coaches: coaches?.c ?? 0,
      students: students?.c ?? 0,
      classes: classes?.c ?? 0,
      pendingLeaves: pending?.c ?? 0,
      totalPayments: totalPayments?.total ?? 0,
    });
  }

  /* =====================================================
   *  ADMIN — COACHES
   * ====================================================*/
  if (seg[0] === "admin" && seg[1] === "coaches") {
    if (method === "GET") {
      const { results } = await db
        .prepare("SELECT * FROM coaches ORDER BY created_at DESC")
        .all();
      return json(results);
    }

    if (method === "POST") {
      const b = await request.json();
      const name = b.name?.trim();
      if (!name) return json({ error: "name required" }, 400);

      const result = await db
        .prepare(
          `INSERT INTO coaches (name,email,phone,line_id,active)
           VALUES (?,?,?,?,?)`
        )
        .bind(name, b.email ?? null, b.phone ?? null, b.line_id ?? null, 1)
        .run();

      return json({ id: result.lastRowId }, 201);
    }
  }

  /* =====================================================
   *  ADMIN — STUDENTS
   * ====================================================*/
  if (seg[0] === "admin" && seg[1] === "students") {
    if (method === "GET") {
      const { results } = await db
        .prepare("SELECT * FROM students ORDER BY created_at DESC")
        .all();
      return json(results);
    }

    if (method === "POST") {
      const b = await request.json();
      const name = b.name?.trim();
      if (!name) return json({ error: "name required" }, 400);

      const result = await db
        .prepare(`INSERT INTO students (name,email,phone,line_id)
                 VALUES (?,?,?,?)`)
        .bind(name, b.email ?? null, b.phone ?? null, b.line_id ?? null)
        .run();

      return json({ id: result.lastRowId }, 201);
    }
  }

  /* =====================================================
   *  CLASSES
   * ====================================================*/
  if (seg[0] === "classes") {
    if (method === "GET") {
      const { results } = await db
        .prepare(
          `SELECT c.*, co.name AS coach_name
           FROM classes c
           JOIN coaches co ON c.coach_id = co.id
           ORDER BY c.created_at DESC`
        )
        .all();

      return json(results);
    }

    if (method === "POST") {
      const b = await request.json();
      if (!b.coach_id || !b.name)
        return json({ error: "coach_id & name required" }, 400);

      const result = await db
        .prepare(
          `INSERT INTO classes 
          (coach_id,name,location,schedule_text,capacity,
           term_price,term_classes,dropin_price,
           rule_no_leave,rule_allow_delay,rule_allow_dropin)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          b.coach_id,
          b.name,
          b.location ?? null,
          b.schedule_text ?? null,
          b.capacity ?? null,
          b.term_price ?? null,
          b.term_classes ?? null,
          b.dropin_price ?? null,
          b.rule_no_leave ? 1 : 0,
          b.rule_allow_delay ? 1 : 0,
          b.rule_allow_dropin ? 1 : 0
        )
        .run();

      return json({ id: result.lastRowId }, 201);
    }
  }

  /* =====================================================
   *  PAYMENTS
   * ====================================================*/
  if (seg[0] === "students" && seg[2] === "payments") {
    const studentId = Number(seg[1]);
    if (!studentId) return json({ error: "invalid student ID" }, 400);

    if (method === "GET") {
      const { results } = await db
        .prepare(
          `SELECT p.*, c.name AS class_name
           FROM payments p
           LEFT JOIN classes c ON p.class_id = c.id
           WHERE student_id = ?
           ORDER BY paid_at DESC`
        )
        .bind(studentId)
        .all();
      return json(results);
    }

    if (method === "POST") {
      const b = await request.json();
      if (!b.amount || !b.paid_at || !b.channel)
        return json({ error: "amount, paid_at, channel required" }, 400);

      const result = await db
        .prepare(
          `INSERT INTO payments
           (student_id,class_id,amount,paid_at,channel,note)
           VALUES (?,?,?,?,?,?)`
        )
        .bind(
          studentId,
          b.class_id ?? null,
          b.amount,
          b.paid_at,
          b.channel,
          b.note ?? null
        )
        .run();

      return json({ id: result.lastRowId }, 201);
    }
  }

  /* =====================================================
   *  LEAVE REQUESTS
   * ====================================================*/
  if (seg[0] === "leave-requests") {
    // list
    if (method === "GET") {
      const status = url.searchParams.get("status") ?? "pending";

      const { results } = await db
        .prepare(
          `SELECT lr.*, s.name student_name, c.name class_name
           FROM leave_requests lr
           JOIN students s ON lr.student_id = s.id
           JOIN classes c ON lr.class_id = c.id
           WHERE lr.status = ?
           ORDER BY lr.created_at DESC`
        )
        .bind(status)
        .all();

      return json(results);
    }

    // create
    if (method === "POST" && seg.length === 1) {
      const b = await request.json();
      if (!b.student_id || !b.class_id || !b.type)
        return json({ error: "student_id, class_id, type required" }, 400);

      const result = await db
        .prepare(
          `INSERT INTO leave_requests
           (student_id,class_id,type,lesson_date,new_lesson_date,
            status,reason_student)
           VALUES (?,?,?,?,?,'pending',?)`
        )
        .bind(
          b.student_id,
          b.class_id,
          b.type,
          b.lesson_date ?? null,
          b.new_lesson_date ?? null,
          b.reason_student ?? null
        )
        .run();

      return json({ id: result.lastRowId }, 201);
    }

    // decision
    if (seg.length === 3 && seg[2] === "decision" && method === "POST") {
      const id = Number(seg[1]);
      const b = await request.json();
      const decision = b.decision;

      if (decision !== "accept" && decision !== "reject")
        return json({ error: "decision must be accept/reject" }, 400);

      const status =
        decision === "accept" ? "accepted" : "rejected";

      await db
        .prepare(
          `UPDATE leave_requests
           SET status=?, reason_coach=?, updated_at=datetime('now')
           WHERE id=?`
        )
        .bind(status, b.reason_coach ?? null, id)
        .run();

      return json({ ok: true });
    }
  }

  return json({ error: "Not Found" }, 404);
}
