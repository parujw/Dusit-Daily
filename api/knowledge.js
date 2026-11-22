// Team knowledge that Dusit Help answers from ("สอน Dusit Help").
// GET  /api/knowledge                      -> { items: [{ id, text, by, byUid, at }] }
// POST /api/knowledge { action: "add", text }
// POST /api/knowledge { action: "remove", id }   (the person who added it, or an admin)
//
// Everything lives in ONE document, teams/{TEAM_ID}/meta/knowledge, so Dusit Help reads it
// with a single Firestore read per question. Written only by the server (Admin SDK):
// no Firestore rules change, and task data is never touched.
import crypto from "node:crypto";
import { admin, json, requireMember, knowledgeDoc as docOf, loadKnowledge } from "./_lib.js";

const KB_MAX = 300;     // entries
const KB_TEXT = 500;    // characters per entry

export async function GET(request) {
  const who = await requireMember(request);
  if (who instanceof Response) return who;
  const a = admin();
  if (!a) return json({ error: "ยังไม่ได้ตั้ง FIREBASE_SERVICE_ACCOUNT ใน Vercel", local: true }, 503);
  return json({ items: await loadKnowledge(a) });
}

export async function POST(request) {
  const who = await requireMember(request);
  if (who instanceof Response) return who;
  const a = admin();
  if (!a) return json({ error: "ยังไม่ได้ตั้ง FIREBASE_SERVICE_ACCOUNT ใน Vercel", local: true }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400); }

  try {
    const items = await a.db.runTransaction(async (t) => {
      const s = await t.get(docOf(a));
      let list = s.exists && Array.isArray(s.data().items) ? s.data().items : [];

      if (b?.action === "add") {
        const text = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, KB_TEXT);
        if (text.length < 3) throw Object.assign(new Error("พิมพ์สิ่งที่อยากให้จำอย่างน้อย 3 ตัวอักษร"), { status: 400 });
        if (list.some((k) => k.text === text)) return list; // already known
        if (list.length >= KB_MAX) throw Object.assign(new Error(`จำได้สูงสุด ${KB_MAX} เรื่อง ลบเรื่องเก่าที่ไม่ใช้แล้วก่อน`), { status: 409 });
        list = [...list, { id: crypto.randomUUID(), text, by: String(who.name || "").slice(0, 40), byUid: who.uid || "", at: Date.now() }];
      } else if (b?.action === "remove") {
        const k = list.find((x) => x.id === b.id);
        if (!k) return list;
        if (who.role !== "admin" && k.byUid && k.byUid !== who.uid) throw Object.assign(new Error("ลบได้เฉพาะเรื่องที่ตัวเองสอน หรือให้ผู้ดูแลลบ"), { status: 403 });
        list = list.filter((x) => x.id !== b.id);
      } else {
        throw Object.assign(new Error("ไม่รู้จักคำสั่งนี้"), { status: 400 });
      }
      t.set(docOf(a), { items: list, updatedAt: Date.now() }, { merge: true });
      return list;
    });
    return json({ items });
  } catch (e) {
    if (e.status) return json({ error: e.message }, e.status);
    console.error("knowledge write failed", e);
    return json({ error: "บันทึกไม่สำเร็จ ลองอีกครั้ง" }, 500);
  }
}
