// First-time setup from a phone: create the team's first admin.
// GET  /api/setup  -> { needsSetup }   (true while the team has no active admin)
// POST /api/setup  { code, name, email, password }
// Works only while no admin exists, and only with SETUP_CODE set in Vercel.
import crypto from "node:crypto";
import { admin, json, TEAM_ID } from "./_lib.js";
import { FieldValue } from "firebase-admin/firestore";

async function hasAdmin(a) {
  const snap = await a.db.collection("users").where("team", "==", TEAM_ID).where("role", "==", "admin").get();
  return snap.docs.some((d) => !d.data().disabled);
}

export async function GET() {
  const a = admin();
  if (!a) return json({ needsSetup: false, ready: false });
  try { return json({ needsSetup: !(await hasAdmin(a)), ready: true }); }
  catch (e) { console.error(e); return json({ needsSetup: false, ready: false }); }
}

export async function POST(request) {
  const a = admin();
  if (!a) return json({ error: "ยังไม่ได้ตั้ง FIREBASE_SERVICE_ACCOUNT ใน Vercel" }, 503);
  const want = process.env.SETUP_CODE || "";
  if (!want) return json({ error: "ยังไม่ได้ตั้ง SETUP_CODE ใน Vercel" }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400); }
  const code = String(b?.code || "");
  const ok = code.length === want.length && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(want));
  if (!ok) return json({ error: "รหัสตั้งค่าไม่ถูกต้อง" }, 403);
  if (await hasAdmin(a)) return json({ error: "ทีมนี้มีผู้ดูแลแล้ว ให้เข้าสู่ระบบตามปกติ" }, 409);

  const email = String(b.email || "").trim().toLowerCase();
  const name = String(b.name || "").trim().slice(0, 40);
  const password = String(b.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "ชื่อผู้ใช้หรืออีเมลไม่ถูกต้อง" }, 400);
  if (!name) return json({ error: "ใส่ชื่อที่จะแสดงในแอป" }, 400);
  if (password.length < 6) return json({ error: "รหัสผ่านต้องยาวอย่างน้อย 6 ตัว" }, 400);

  try {
    let user;
    try {
      user = await a.auth.getUserByEmail(email);
      await a.auth.updateUser(user.uid, { password, displayName: name, disabled: false });
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
      user = await a.auth.createUser({ email, password, displayName: name });
    }
    await a.db.doc(`users/${user.uid}`).set({ email, name, role: "admin", team: TEAM_ID, disabled: false, createdAt: Date.now() }, { merge: true });
    await a.db.doc(`teams/${TEAM_ID}`).set({ members: FieldValue.arrayUnion(email) }, { merge: true });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    if (e.code === "auth/configuration-not-found" || e.code === "auth/operation-not-allowed") return json({ error: "ยังไม่ได้เปิด Email/Password ใน Firebase Authentication" }, 503);
    return json({ error: "สร้างบัญชีไม่สำเร็จ: " + (e.code || e.message) }, 500);
  }
}
