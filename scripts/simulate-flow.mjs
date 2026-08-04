#!/usr/bin/env node
/**
 * Simulador do cliente do WhatsApp — permite estudar o Flow sem depender da Meta.
 *
 * Faz exatamente o que o app faz: gera chave AES, cifra com a nossa pública,
 * assina o corpo com o app secret, chama o endpoint e decifra a resposta.
 *
 *   node scripts/simulate-flow.mjs ping
 *   node scripts/simulate-flow.mjs init    <flow_token>
 *   node scripts/simulate-flow.mjs servico <flow_token>
 *   node scripts/simulate-flow.mjs corrida <flow_token>
 *
 * Use um flow_token que exista em flow_sessions (o INIT falha sem sessão).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

loadDotEnv(".env.local");

const ENDPOINT =
  process.env.FLOW_ENDPOINT_URL || "http://localhost:3000/api/whatsapp/flow";
const APP_SECRET = requireEnv("WHATSAPP_APP_SECRET");
const PUBLIC_KEY = fs.readFileSync(
  path.join(process.cwd(), "keys", "public.pem"),
  "utf-8",
);

const [command, flowToken] = process.argv.slice(2);

const bodies = {
  ping: { version: "3.0", action: "ping" },
  init: {
    version: "3.0",
    action: "INIT",
    flow_token: flowToken,
  },
  servico: {
    version: "3.0",
    action: "data_exchange",
    screen: "SERVICO",
    flow_token: flowToken,
    data: {
      screen: "SERVICO",
      nome: "Cliente de Teste",
      tipo_servico: "corrida",
    },
  },
  corrida: {
    version: "3.0",
    action: "data_exchange",
    screen: "CORRIDA",
    flow_token: flowToken,
    data: {
      screen: "CORRIDA",
      origem: "Rua A, 100",
      destino: "Rua B, 200",
      quando: "agora",
    },
  },
};

const body = bodies[command];
if (!body) {
  console.error(`Comando inválido. Use: ${Object.keys(bodies).join(" | ")}`);
  process.exit(1);
}
if (command !== "ping" && !flowToken) {
  console.error("Informe o flow_token: node scripts/simulate-flow.mjs init <token>");
  process.exit(1);
}

// --- lado cliente: cifra ------------------------------------------------
const aesKey = crypto.randomBytes(16);
const iv = crypto.randomBytes(16);

const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
const encryptedFlowData = Buffer.concat([
  cipher.update(JSON.stringify(body), "utf-8"),
  cipher.final(),
  cipher.getAuthTag(),
]);

const encryptedAesKey = crypto.publicEncrypt(
  {
    key: PUBLIC_KEY,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  },
  aesKey,
);

const payload = JSON.stringify({
  encrypted_flow_data: encryptedFlowData.toString("base64"),
  encrypted_aes_key: encryptedAesKey.toString("base64"),
  initial_vector: iv.toString("base64"),
});

const signature = crypto
  .createHmac("sha256", APP_SECRET)
  .update(payload, "utf-8")
  .digest("hex");

// --- chamada ------------------------------------------------------------
const response = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Hub-Signature-256": `sha256=${signature}`,
  },
  body: payload,
});

const raw = await response.text();
console.log(`HTTP ${response.status}`);

if (response.status !== 200) {
  console.log(raw);
  process.exit(1);
}

// --- lado cliente: decifra (IV invertido) -------------------------------
const flippedIv = Buffer.from(iv.map((byte) => ~byte & 0xff));
const encryptedResponse = Buffer.from(raw, "base64");

const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, flippedIv);
decipher.setAuthTag(encryptedResponse.subarray(-16));

const plaintext = Buffer.concat([
  decipher.update(encryptedResponse.subarray(0, -16)),
  decipher.final(),
]).toString("utf-8");

console.log(JSON.stringify(JSON.parse(plaintext), null, 2));

// ----------------------------------------------------------------- helpers
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Variável de ambiente ausente: ${name}`);
    process.exit(1);
  }
  return value;
}

function loadDotEnv(file) {
  const fullPath = path.join(process.cwd(), file);
  if (!fs.existsSync(fullPath)) return;
  for (const line of fs.readFileSync(fullPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
