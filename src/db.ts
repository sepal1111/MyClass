// Prisma client bound to the runtime-resolved db file (see paths.ts), plus an
// idempotent schema bootstrap that mirrors app/database.py's init_db(): plain
// `CREATE TABLE IF NOT EXISTS` / best-effort `ALTER TABLE ADD COLUMN`, run on
// every startup. We deliberately do NOT use `prisma migrate` because the
// database file's location is only known at runtime (portable USB/bin dir).
import crypto from "crypto";
import { getDbPath, getPackagedPrismaEngineLibraryPath } from "./paths";

const packagedEngine = getPackagedPrismaEngineLibraryPath();
if (packagedEngine) process.env.PRISMA_QUERY_ENGINE_LIBRARY = packagedEngine;

// Imported after the env override above so PrismaClient picks it up when constructed.
import { PrismaClient } from "@prisma/client";

const dbPath = getDbPath();

export const prisma = new PrismaClient({
  datasourceUrl: `file:${dbPath}`,
});

async function tryAlter(sql: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch {
    // Column/table already exists — same best-effort semantics as the Python version's try/except.
  }
}

export async function initSchema(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON;");
  // journal_mode=WAL returns the resulting mode as a row, so SQLite rejects it via $executeRaw.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      teacher_type TEXT NOT NULL DEFAULT 'homeroom',
      description TEXT,
      seat_rows INTEGER DEFAULT 5,
      seat_cols INTEGER DEFAULT 6,
      blackboard_position TEXT DEFAULT 'top',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS group_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      group_name TEXT NOT NULL,
      icon_url TEXT NULL,
      order_index INTEGER DEFAULT 0,
      plan_id INTEGER NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_number INTEGER NOT NULL,
      student_code TEXT NULL,
      name TEXT NOT NULL,
      english_name TEXT NULL,
      gender TEXT NOT NULL DEFAULT 'M',
      group_id INTEGER NULL,
      seat_row INTEGER NULL,
      seat_col INTEGER NULL,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES group_plans(id) ON DELETE CASCADE,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(plan_id, student_id)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'present',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(course_id, student_id, date)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS evaluation_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'positive',
      score_value INTEGER NOT NULL,
      icon TEXT DEFAULT '⭐',
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS score_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      rule_id INTEGER NULL,
      rule_title TEXT NOT NULL,
      score INTEGER NOT NULL,
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      is_undone INTEGER DEFAULT 0,
      plan_id INTEGER NULL,
      group_id INTEGER NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS qualitative_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      note_text TEXT NOT NULL,
      date TEXT NOT NULL,
      media_url TEXT NULL,
      media_type TEXT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS undo_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      is_undone INTEGER DEFAULT 0
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(
    "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('password_prefix', 'Admin');"
  );
  // Generated once per install and persisted in the DB (never in a config file), since a
  // portable USB/bin deployment has no durable place for a server-side env secret — this
  // signs/verifies student LMS JWTs (see src/middleware/studentAuth.ts).
  const jwtSecretExists = await prisma.systemSetting.findUnique({ where: { key: "jwt_secret" } });
  if (!jwtSecretExists) {
    await prisma.systemSetting.create({ data: { key: "jwt_secret", value: crypto.randomBytes(48).toString("hex") } });
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS system_sessions (
      token TEXT PRIMARY KEY,
      created_date TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // --- Phase 2: 課程素材與單元結構模組 (units -> sub_units -> materials) + reading progress ---
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sub_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      is_hidden INTEGER DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'material',
      description TEXT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_id) REFERENCES units(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_unit_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reading_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_unit_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      first_viewed_at TEXT NOT NULL,
      last_viewed_at TEXT NOT NULL,
      view_count INTEGER DEFAULT 1,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(sub_unit_id, student_id)
    );
  `);

  // 教學日誌（Lesson Log）：以課程為單位的教學進度／課堂記事，跟 qualitative_notes（針對個別學生）
  // 是不同維度的紀錄，sub_unit_id 選填讓老師可以選擇性關聯到已建立的單元結構標示「教到哪」。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS lesson_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      sub_unit_id INTEGER NULL,
      content TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT 'general',
      is_done INTEGER DEFAULT 0,
      media_url TEXT NULL,
      media_type TEXT NULL,
      date TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE SET NULL
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_lesson_logs_course ON lesson_logs(course_id, date);"
  );

  // --- Phase 3: 作業與小組共同作業模組 (submissions) ---
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_unit_id INTEGER NOT NULL,
      student_id INTEGER NULL,
      group_id INTEGER NULL,
      submitter_id INTEGER NULL,
      files_json TEXT NULL,
      link TEXT NULL,
      text_content TEXT NULL,
      submitted_at TEXT NULL,
      is_late INTEGER DEFAULT 0,
      turned_in INTEGER DEFAULT 0,
      locked INTEGER DEFAULT 0,
      teacher_reopened INTEGER DEFAULT 0,
      resubmit_requested INTEGER DEFAULT 0,
      resubmit_requested_at TEXT NULL,
      score INTEGER NULL,
      feedback TEXT NULL,
      member_scores_json TEXT NULL,
      graded_at TEXT NULL,
      score_log_ids_json TEXT NULL,
      answers_json TEXT NULL,
      max_score INTEGER NULL,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      UNIQUE(sub_unit_id, student_id),
      UNIQUE(sub_unit_id, group_id)
    );
  `);

  // 提問串（Submission Comments）：建立後不可編輯刪除，僅提供 CREATE/LIST，見 utils/submissionComments.ts。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS submission_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sub_unit_id INTEGER NOT NULL,
      student_id INTEGER NULL,
      group_id INTEGER NULL,
      author_role TEXT NOT NULL,
      author_id INTEGER NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_submission_comments_thread ON submission_comments(sub_unit_id, student_id, group_id);"
  );

  // 學生端通知（🔔）：見 utils/notifications.ts。每位學生只保留最新 100 筆。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS student_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NULL,
      tab TEXT NULL,
      ref_id INTEGER NULL,
      repeat_count INTEGER NOT NULL DEFAULT 1,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_student_notifications_student ON student_notifications(student_id, is_read, created_at);"
  );

  // 即時互動牆（Live Wall）：教師開一個限時場次，學生每人限交一則文字/手繪/拍照貼文。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS live_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      title TEXT NULL,
      show_names INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  // Partial unique index：同一課程同時只能有一個 is_active=1 的場次，DB 層強制（app 層也會
  // 在開新場次前先關閉舊場次，這裡是雙重保險，避免競態或漏改造成同時兩個進行中場次）。
  await prisma.$executeRawUnsafe(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sessions_one_active ON live_sessions(course_id) WHERE is_active = 1;"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS live_wall_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      text_content TEXT NULL,
      image_url TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(session_id, student_id)
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_live_wall_posts_session ON live_wall_posts(session_id);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS point_card_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NULL,
      name TEXT NOT NULL,
      card_theme TEXT NOT NULL DEFAULT 'score_card_A',
      allowed_course_ids TEXT NOT NULL DEFAULT '',
      layout_config TEXT NULL,
      custom_images_json TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS point_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      series_id INTEGER NULL,
      card_no TEXT NULL,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      score INTEGER NOT NULL,
      image TEXT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(series_id) REFERENCES point_card_series(id) ON DELETE SET NULL,
      UNIQUE(course_id, code)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS point_card_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_card_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      score_log_id INTEGER NULL,
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(point_card_id) REFERENCES point_cards(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(point_card_id, student_id, date)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reward_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NULL,
      reward_type TEXT NOT NULL,
      points_cost INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT -1,
      image_url TEXT NOT NULL,
      card_series TEXT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS reward_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reward_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      points_spent INTEGER NOT NULL,
      status TEXT NOT NULL,
      score_log_id INTEGER NULL,
      request_note TEXT NULL,
      teacher_note TEXT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT NULL,
      fulfilled_at TEXT NULL,
      FOREIGN KEY(reward_id) REFERENCES reward_items(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_reward_items_course ON reward_items(course_id, is_active);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_reward_redemptions_student ON reward_redemptions(student_id, status);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_reward_redemptions_course ON reward_redemptions(course_id, status);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS paper_quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      subject TEXT DEFAULT '',
      quiz_date TEXT NOT NULL,
      max_score REAL DEFAULT 100,
      passing_score REAL DEFAULT 60,
      sub_unit_id INTEGER NULL,
      allow_self_entry INTEGER DEFAULT 1,
      allow_leader_entry INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(sub_unit_id) REFERENCES sub_units(id) ON DELETE SET NULL
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS paper_quiz_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      score REAL NULL,
      is_absent INTEGER DEFAULT 0,
      leave_type TEXT DEFAULT '',
      allow_makeup INTEGER DEFAULT 0,
      is_makeup INTEGER DEFAULT 0,
      makeup_score REAL NULL,
      photo_url TEXT NULL,
      submitted_by TEXT DEFAULT 'teacher',
      submitted_by_id INTEGER NULL,
      is_verified INTEGER DEFAULT 0,
      note TEXT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(quiz_id) REFERENCES paper_quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(quiz_id, student_id)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS group_discussion_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      plan_id INTEGER NULL,
      leader_id INTEGER NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY(plan_id) REFERENCES group_plans(id) ON DELETE SET NULL,
      FOREIGN KEY(leader_id) REFERENCES students(id) ON DELETE SET NULL
    );
  `);

  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_paper_quizzes_course ON paper_quizzes(course_id);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_paper_quiz_records_quiz ON paper_quiz_records(quiz_id, student_id);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_group_discussion_logs_course ON group_discussion_logs(course_id, group_id);"
  );

  // 作業掃描登記（教師本機專用，見 routes/homeworkScan.ts）
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS hw_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(course_id, name)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS hw_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      plan_date TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(item_id) REFERENCES hw_items(id) ON DELETE CASCADE,
      UNIQUE(course_id, plan_date, item_id)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS hw_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      record_date TEXT NOT NULL,
      status TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT '掃描',
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(item_id) REFERENCES hw_items(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      UNIQUE(item_id, student_id, record_date)
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_hw_records_course_date ON hw_records(course_id, record_date);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_hw_plans_course_date ON hw_plans(course_id, plan_date);"
  );

  // 早自修／午休「在位掌握」（見 routes/whereabouts.ts）
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whereabouts_reasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '📍',
      teacher_name TEXT,
      is_other INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  // whereabouts_records 由「每時段一筆（有 UNIQUE）」改為「每次外出一筆」：新增 out_at / returned_at，
  // 並移除 UNIQUE。舊結構（沒有 returned_at 欄位）自動改名、複製資料後刪除，不會遺失紀錄。
  const wbCols = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(whereabouts_records)");
  const wbLegacy = wbCols.length > 0 && !wbCols.some((c) => c.name === "returned_at");
  if (wbLegacy) {
    await prisma.$executeRawUnsafe("DROP INDEX IF EXISTS idx_whereabouts_course_date");
    await prisma.$executeRawUnsafe("ALTER TABLE whereabouts_records RENAME TO whereabouts_records_legacy");
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whereabouts_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      slot TEXT NOT NULL,
      reason_id INTEGER,
      note TEXT,
      out_at TEXT NOT NULL,
      returned_at TEXT,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(reason_id) REFERENCES whereabouts_reasons(id) ON DELETE SET NULL
    );
  `);
  if (wbLegacy) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO whereabouts_records (id, course_id, student_id, date, slot, reason_id, note, out_at, returned_at)
      SELECT id, course_id, student_id, date, slot, reason_id, note, COALESCE(updated_at, date || ' 00:00:00'), NULL
      FROM whereabouts_records_legacy
    `);
    await prisma.$executeRawUnsafe("DROP TABLE whereabouts_records_legacy");
  }
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_whereabouts_course_date ON whereabouts_records(course_id, date, slot);"
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS whereabouts_kiosks (
      course_id INTEGER PRIMARY KEY,
      token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  // 預設離開原因只在「第一次建立」時寫入一次（以 system_settings 旗標記錄，之後教師刪光也不會自動復原）。
  await prisma.$executeRawUnsafe(
    "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('whereabouts_seeded', '0');"
  );
  const seededRows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    "SELECT value FROM system_settings WHERE key = 'whereabouts_seeded'"
  );
  if (seededRows[0]?.value !== "1") {
    const defaults: Array<[string, string, number]> = [
      ["棒球隊", "⚾", 0], ["羽球隊", "🏸", 0], ["合唱團", "🎤", 0], ["田徑隊", "🏃", 0],
      ["英文訓練", "🔤", 0], ["科展", "🔬", 0], ["奧匹", "🏅", 0], ["語文訓練", "📖", 0],
      ["糾察隊", "🦺", 0], ["其他", "📝", 1],
    ];
    let order = 1;
    for (const [title, icon, isOther] of defaults) {
      await prisma.$executeRawUnsafe(
        "INSERT INTO whereabouts_reasons (title, icon, is_other, sort_order) VALUES (?, ?, ?, ?)",
        title, icon, isOther, order++
      );
    }
    await prisma.$executeRawUnsafe("UPDATE system_settings SET value = '1' WHERE key = 'whereabouts_seeded'");
  }

  // 課堂即時公布欄：原本只存 localStorage，改為寫入資料庫（見 routes/bulletin.ts）。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bulletin_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      order_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_bulletin_posts_course ON bulletin_posts(course_id, order_index);"
  );

  // 臨時檔案蒐集 (File Collections)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS file_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NULL,
      allowed_extensions TEXT NULL,
      allow_upload INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_file_collections_course ON file_collections(course_id, order_index);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS file_collection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      course_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      display_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mime_type TEXT NULL,
      uploaded_at TEXT NOT NULL,
      updated_at TEXT NULL,
      FOREIGN KEY(collection_id) REFERENCES file_collections(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_file_collection_items_col ON file_collection_items(collection_id);"
  );
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_file_collection_items_stu ON file_collection_items(student_id);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quiz_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NULL,
      category TEXT DEFAULT '課堂測驗',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_quiz_sets_course ON quiz_sets(course_id);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_set_id INTEGER NOT NULL,
      order_index INTEGER DEFAULT 0,
      prompt TEXT NOT NULL,
      question_type TEXT DEFAULT 'single',
      options TEXT NOT NULL,
      time_limit_sec INTEGER DEFAULT 20,
      points INTEGER DEFAULT 1000,
      image_url TEXT NULL,
      explanation TEXT NULL,
      FOREIGN KEY(quiz_set_id) REFERENCES quiz_sets(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_quiz_questions_set ON quiz_questions(quiz_set_id, order_index);"
  );

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS wordcloud_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      allow_duplicate INTEGER DEFAULT 0,
      max_words_per_user INTEGER DEFAULT 3,
      words_data TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_wordcloud_sessions_course ON wordcloud_sessions(course_id);"
  );

  // 課表（見 routes/timetable.ts）：作息節次、科目清單為全域設定；每格課表可指定班級與科目。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS timetable_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS timetable_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS timetable_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weekday INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      course_id INTEGER NULL,
      subject TEXT NOT NULL DEFAULT '',
      note TEXT NULL,
      FOREIGN KEY(period_id) REFERENCES timetable_periods(id) ON DELETE CASCADE,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(weekday, period_id)
    );
  `);
  // 教師的任教清單（哪一班的什麼科目）：課表屬於教師本人，排課時從這份清單點選。
  // 教師身分（導師／科任）與導師班存於 system_settings 的 teacher_role、timetable_home_course_id。
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS teaching_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(course_id, subject)
    );
  `);
  // 預設作息與科目只在「第一次建立」時寫入一次（之後教師刪改都不會自動復原）。
  await prisma.$executeRawUnsafe(
    "INSERT OR IGNORE INTO system_settings (key, value) VALUES ('timetable_seeded', '0');"
  );
  const ttSeeded = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    "SELECT value FROM system_settings WHERE key = 'timetable_seeded'"
  );
  if (ttSeeded[0]?.value !== "1") {
    const periods: Array<[string, string, string]> = [
      ["早自修", "08:00", "08:35"], ["第一節", "08:40", "09:20"], ["第二節", "09:30", "10:10"],
      ["第三節", "10:25", "11:05"], ["第四節", "11:20", "12:00"], ["午休", "12:40", "13:20"],
      ["第五節", "13:25", "14:05"], ["第六節", "14:15", "14:55"], ["第七節", "15:05", "15:45"],
    ];
    for (const [name, start, end] of periods) {
      await prisma.$executeRawUnsafe(
        "INSERT INTO timetable_periods (name, start_time, end_time) VALUES (?, ?, ?)",
        name, start, end
      );
    }
    let order = 1;
    for (const name of ["國語", "數學", "社會", "自然", "英語", "科技"]) {
      await prisma.$executeRawUnsafe(
        "INSERT OR IGNORE INTO timetable_subjects (name, sort_order) VALUES (?, ?)",
        name, order++
      );
    }
    await prisma.$executeRawUnsafe("UPDATE system_settings SET value = '1' WHERE key = 'timetable_seeded'");
  }

  // Column migrations for DBs created by older schema versions (safe no-op if already present).
  await tryAlter("ALTER TABLE group_members ADD COLUMN is_leader INTEGER DEFAULT 0;");
  await tryAlter("ALTER TABLE groups ADD COLUMN icon_url TEXT NULL;");
  await tryAlter("ALTER TABLE groups ADD COLUMN plan_id INTEGER NULL;");
  await tryAlter("ALTER TABLE score_logs ADD COLUMN plan_id INTEGER NULL;");
  await tryAlter("ALTER TABLE score_logs ADD COLUMN group_id INTEGER NULL;");
  await tryAlter("ALTER TABLE courses ADD COLUMN seat_rows INTEGER DEFAULT 5;");
  await tryAlter("ALTER TABLE courses ADD COLUMN seat_cols INTEGER DEFAULT 6;");
  await tryAlter("ALTER TABLE courses ADD COLUMN blackboard_position TEXT DEFAULT 'top';");
  await tryAlter("ALTER TABLE students ADD COLUMN student_code TEXT NULL;");
  await tryAlter("ALTER TABLE students ADD COLUMN english_name TEXT NULL;");
  await tryAlter("ALTER TABLE students ADD COLUMN seat_row INTEGER NULL;");
  await tryAlter("ALTER TABLE students ADD COLUMN seat_col INTEGER NULL;");
  await tryAlter("ALTER TABLE students ADD COLUMN password_hash TEXT NULL;");
  await tryAlter("ALTER TABLE students ADD COLUMN login_account TEXT NULL;");
  await prisma.$executeRawUnsafe(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_students_login_account ON students(login_account);"
  );
  await tryAlter("ALTER TABLE qualitative_notes ADD COLUMN media_url TEXT NULL;");
  await tryAlter("ALTER TABLE qualitative_notes ADD COLUMN media_type TEXT NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN submission_types TEXT NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN assignment_type TEXT NOT NULL DEFAULT 'individual';");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN group_plan_id INTEGER NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN due_date TEXT NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN auto_lock_overdue INTEGER DEFAULT 0;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN quiz_questions TEXT NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN reveal_answers_after_submit INTEGER DEFAULT 1;");
  await tryAlter("ALTER TABLE submissions ADD COLUMN answers_json TEXT NULL;");
  await tryAlter("ALTER TABLE submissions ADD COLUMN max_score INTEGER NULL;");
  await tryAlter("ALTER TABLE sub_units ADD COLUMN publish_at TEXT NULL;");
  await tryAlter("ALTER TABLE point_cards ADD COLUMN series_id INTEGER NULL;");
  await tryAlter("ALTER TABLE point_cards ADD COLUMN card_no TEXT NULL;");
  await tryAlter("ALTER TABLE point_cards ADD COLUMN image TEXT NULL;");
  await tryAlter("ALTER TABLE point_card_series ADD COLUMN layout_config TEXT NULL;");
  await tryAlter("ALTER TABLE point_card_series ADD COLUMN custom_images_json TEXT NULL;");
  await tryAlter("ALTER TABLE paper_quizzes ADD COLUMN subject TEXT DEFAULT '';");
  await tryAlter("ALTER TABLE paper_quiz_records ADD COLUMN leave_type TEXT DEFAULT '';");
  await tryAlter("ALTER TABLE paper_quiz_records ADD COLUMN allow_makeup INTEGER DEFAULT 0;");
  await tryAlter("ALTER TABLE paper_quiz_records ADD COLUMN is_makeup INTEGER DEFAULT 0;");
  await tryAlter("ALTER TABLE paper_quiz_records ADD COLUMN makeup_score REAL NULL;");

  // Ensure every course has an active group_plan, and backfill group_members from
  // legacy students.group_id, exactly like the Python auto-migration block.
  const courses = await prisma.course.findMany({ select: { id: true } });
  for (const c of courses) {
    let plan = await prisma.groupPlan.findFirst({ where: { courseId: c.id, isActive: 1 } });
    if (!plan) {
      const anyPlan = await prisma.groupPlan.findFirst({ where: { courseId: c.id } });
      if (!anyPlan) {
        plan = await prisma.groupPlan.create({ data: { courseId: c.id, name: "常態分組", isActive: 1 } });
      } else {
        plan = await prisma.groupPlan.update({ where: { id: anyPlan.id }, data: { isActive: 1 } });
      }
    }

    await prisma.group.updateMany({
      where: { courseId: c.id, plan: null },
      data: { planId: plan.id },
    });

    const legacyMembers = await prisma.student.findMany({
      where: { courseId: c.id, groupId: { not: null } },
      select: { id: true, groupId: true },
    });
    for (const s of legacyMembers) {
      if (!s.groupId) continue;
      await prisma.groupMember
        .create({ data: { planId: plan.id, groupId: s.groupId, studentId: s.id } })
        .catch(() => {
          /* UNIQUE(plan_id, student_id) — already backfilled */
        });
    }
  }
}
