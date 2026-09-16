/**
 * Vyrobí dvojici klíčů pro Web Push (VAPID).
 * Spusť:  node gen-vapid.mjs
 */
import { webcrypto as crypto } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = await crypto.subtle.exportKey("raw", pair.publicKey);

console.log("\n--- VAPID_PUBLIC (veřejný, jde i do appky) ---------------------");
console.log(b64url(raw));
console.log("\n--- VAPID_JWK (TAJNÝ, jen do wrangler secret) ------------------");
console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
console.log(`
Dál:
  npx wrangler secret put VAPID_JWK        # vlož řádek s JWK
  npx wrangler deploy --var VAPID_PUBLIC:<verejny-klic>
`);
