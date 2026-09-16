/**
 * Kapybaří diplomka — backend.
 *
 * Cloudflare Worker + D1. Dělá tři věci:
 *   1. drží postup centrálně, ať se synchronizuje mezi telefonem a notebookem
 *   2. přijímá odběry upozornění
 *   3. jednou denně se podívá na rozvrh a pošle připomínku
 *
 * Autorizace je schválně jednoduchá: místnost (room) + token, obojí náhodné.
 * Kdo zná dvojici, má přístup — pro dva lidi a data o diplomce to stačí.
 * Nic citlivějšího než seznam úkolů se sem neukládá.
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function cors(env) {
  return {
    "access-control-allow-origin": env.ALLOW_ORIGIN || "*",
    "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
  };
}
const json = (data, env, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...cors(env) } });

const b64url = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/** Porovnání nezávislé na délce shody, ať se token nedá uhádnout po znacích. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function getRoom(env, id) {
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  return await env.DB.prepare("SELECT id, token, doc, rev, updated_at FROM rooms WHERE id = ?").bind(id).first();
}

/* ------------------------------------------------------------------ *
 * Rozvrh — stejná pravidla jako v appce, jen tolik, kolik je potřeba
 * na spočítání „kolik jí tenhle blok zbývá".
 * ------------------------------------------------------------------ */
const DAY = 86400000;
const DIFF_XP = { 1: 10, 2: 25, 3: 50 };
const qxp = (q) => DIFF_XP[q.diff] || 25;

function blocksOf(doc) {
  const dl = doc?.profile?.deadline ? new Date(doc.profile.deadline + "T23:59:59Z") : null;
  if (!dl || isNaN(dl)) return [];
  const days = Math.max(3, Math.min(30, parseInt(doc?.plan?.blockDays) || 7));
  let from = doc?.plan?.start ? new Date(doc.plan.start + "T00:00:00Z") : new Date();
  if (isNaN(from) || from > dl) from = new Date();
  from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const out = [];
  while (from <= dl && out.length < 60) {
    let to = new Date(from.getTime() + (days - 1) * DAY);
    to.setUTCHours(23, 59, 59, 999);
    out.push({ i: out.length, from: new Date(from), to: to > dl ? dl : to });
    from = new Date(from.getTime() + days * DAY);
  }
  return out;
}
function currentIdx(blocks) {
  const now = Date.now();
  for (const b of blocks) if (now <= b.to.getTime()) return b.i;
  return Math.max(0, blocks.length - 1);
}

/** Co jí dnes napsat — nebo null, když ji nemá cenu otravovat. */
function nudgeFor(doc) {
  const quests = Array.isArray(doc?.quests) ? doc.quests : [];
  if (!quests.length) return null;

  const open = quests.filter(q => !q.done);
  if (!open.length) return { title: "Všechno hotové 🦫", body: "Nezbývá ti ani jeden úkol. Užij si to." };

  const blocks = blocksOf(doc);
  const dl = doc?.profile?.deadline ? new Date(doc.profile.deadline + "T23:59:59Z") : null;
  const daysLeft = dl ? Math.ceil((dl - Date.now()) / DAY) : null;

  // dneska už něco udělala → ticho
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  if (quests.some(q => q.done && q.doneAt && q.doneAt >= startOfDay.getTime())) return null;

  if (blocks.length) {
    const cur = currentIdx(blocks);
    const assign = doc?.plan?.assign || {};
    const mine = quests.filter(q => {
      const a = assign[q.id];
      if (q.done) return false;
      return (a === undefined || a === null) ? true : (a <= cur);
    });
    if (mine.length) {
      const b = blocks[cur];
      const dEnd = Math.max(1, Math.ceil((b.to.getTime() - Date.now()) / DAY));
      const first = mine[0]?.title || "";
      return {
        title: `Tenhle blok: ${mine.length} ${plural(mine.length, "úkol", "úkoly", "úkolů")}`,
        body: `Zbývá ${dEnd} ${plural(dEnd, "den", "dny", "dní")}. Začni třeba tímhle: ${first}`,
      };
    }
    return { title: "Blok máš splněný 🦫", body: "Dneska nemusíš nic. Vážně." };
  }

  const first = open[0]?.title || "";
  return {
    title: `Zbývá ${open.length} ${plural(open.length, "úkol", "úkoly", "úkolů")}`,
    body: daysLeft !== null ? `Do odevzdání ${daysLeft} dní. Další na řadě: ${first}` : `Další na řadě: ${first}`,
  };
}
const plural = (n, a, b, c) => n === 1 ? a : (n >= 2 && n <= 4 ? b : c);

/* ------------------------------------------------------------------ *
 * Web Push — posíláme prázdné oznámení, text si service worker došahá
 * sám z /api/nudge. Díky tomu odpadá šifrování obsahu (RFC 8291).
 * ------------------------------------------------------------------ */
async function vapidJwt(audience, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:nekdo@example.com",
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}
async function pushTo(endpoint, env) {
  const jwt = await vapidJwt(new URL(endpoint).origin, env);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "86400",
      Urgency: "normal",
      "Content-Length": "0",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
    },
  });
  return res.status;
}

/* ------------------------------------------------------------------ */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (path === "/" || path === "/api") {
      return json({ ok: true, service: "kapybari-diplomka", endpoints: ["/api/state", "/api/push/subscribe", "/api/nudge"] }, env);
    }

    const roomId = url.searchParams.get("room") || "";
    const token = bearer(req);

    /* ---- stav ---- */
    if (path === "/api/state") {
      if (req.method === "GET") {
        const room = await getRoom(env, roomId);
        if (!room) return json({ error: "not_found" }, env, 404);
        if (!safeEqual(room.token, token)) return json({ error: "bad_token" }, env, 403);
        return json({ rev: room.rev, updatedAt: room.updated_at, doc: JSON.parse(room.doc || "{}") }, env);
      }

      if (req.method === "PUT") {
        let payload;
        try { payload = await req.json(); } catch { return json({ error: "bad_json" }, env, 400); }
        const doc = payload?.doc;
        if (!doc || typeof doc !== "object") return json({ error: "bad_doc" }, env, 400);
        const body = JSON.stringify(doc);
        if (body.length > 900000) return json({ error: "too_large" }, env, 413);
        if (!/^[A-Za-z0-9_-]{6,64}$/.test(roomId)) return json({ error: "bad_room" }, env, 400);
        if (token.length < 16) return json({ error: "weak_token" }, env, 400);

        const now = Date.now();
        const room = await getRoom(env, roomId);

        if (!room) {   // první uložení místnost zabere i s tokenem
          await env.DB.prepare("INSERT INTO rooms (id, token, doc, rev, updated_at) VALUES (?, ?, ?, 1, ?)")
            .bind(roomId, token, body, now).run();
          return json({ ok: true, rev: 1, updatedAt: now }, env);
        }
        if (!safeEqual(room.token, token)) return json({ error: "bad_token" }, env, 403);

        const clientRev = Number(payload.rev ?? 0);
        if (clientRev !== room.rev) {   // mezitím psalo druhé zařízení
          return json({ error: "conflict", rev: room.rev, updatedAt: room.updated_at, doc: JSON.parse(room.doc || "{}") }, env, 409);
        }
        const rev = room.rev + 1;
        await env.DB.prepare("UPDATE rooms SET doc = ?, rev = ?, updated_at = ? WHERE id = ?")
          .bind(body, rev, now, roomId).run();
        return json({ ok: true, rev, updatedAt: now }, env);
      }
      return json({ error: "method" }, env, 405);
    }

    /* ---- odběr upozornění ---- */
    if (path === "/api/push/subscribe") {
      const room = await getRoom(env, roomId);
      if (!room) return json({ error: "not_found" }, env, 404);
      if (!safeEqual(room.token, token)) return json({ error: "bad_token" }, env, 403);

      if (req.method === "POST") {
        let sub;
        try { sub = await req.json(); } catch { return json({ error: "bad_json" }, env, 400); }
        const endpoint = sub?.endpoint;
        if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return json({ error: "bad_sub" }, env, 400);
        const id = await sha256hex(endpoint);
        await env.DB.prepare(
          "INSERT INTO subs (id, room, endpoint, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET room = excluded.room, endpoint = excluded.endpoint"
        ).bind(id, roomId, endpoint, Date.now()).run();
        return json({ ok: true }, env);
      }
      if (req.method === "DELETE") {
        const ep = url.searchParams.get("endpoint") || "";
        if (ep) await env.DB.prepare("DELETE FROM subs WHERE id = ?").bind(await sha256hex(ep)).run();
        else await env.DB.prepare("DELETE FROM subs WHERE room = ?").bind(roomId).run();
        return json({ ok: true }, env);
      }
      return json({ error: "method" }, env, 405);
    }

    /* ---- text upozornění (tahá si service worker) ---- */
    if (path === "/api/nudge" && req.method === "GET") {
      const room = await getRoom(env, roomId);
      if (!room) return json({ error: "not_found" }, env, 404);
      if (!safeEqual(room.token, token)) return json({ error: "bad_token" }, env, 403);
      const n = nudgeFor(JSON.parse(room.doc || "{}"));
      return json(n || { title: "Kapybaří diplomka", body: "Mrkni na dnešek." }, env);
    }

    /* ---- ruční spuštění rozesílky, ať se to dá vyzkoušet ---- */
    if (path === "/api/test-push" && req.method === "POST") {
      const room = await getRoom(env, roomId);
      if (!room) return json({ error: "not_found" }, env, 404);
      if (!safeEqual(room.token, token)) return json({ error: "bad_token" }, env, 403);
      const sent = await notifyRoom(env, roomId, true);
      return json({ ok: true, sent }, env);
    }

    return json({ error: "not_found" }, env, 404);
  },

  /** Cron — jednou denně obejde místnosti a pošle připomínku. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const { results } = await env.DB.prepare("SELECT id FROM rooms").all();
      for (const r of results || []) {
        try { await notifyRoom(env, r.id, false); }
        catch (e) { console.log("nudge selhal", r.id, e.message); }
      }
    })());
  },
};

async function notifyRoom(env, roomId, force) {
  const room = await getRoom(env, roomId);
  if (!room) return 0;
  if (!force) {
    const n = nudgeFor(JSON.parse(room.doc || "{}"));
    if (!n) return 0;   // dneska už něco udělala, nebo nemá co
  }
  const { results } = await env.DB.prepare("SELECT id, endpoint FROM subs WHERE room = ?").bind(roomId).all();
  let sent = 0;
  for (const s of results || []) {
    const status = await pushTo(s.endpoint, env);
    if (status === 404 || status === 410) {
      await env.DB.prepare("DELETE FROM subs WHERE id = ?").bind(s.id).run();   // odběr zanikl
    } else if (status >= 200 && status < 300) {
      sent++;
    }
  }
  return sent;
}
