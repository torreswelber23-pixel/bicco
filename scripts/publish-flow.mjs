#!/usr/bin/env node
/**
 * Automação do ciclo de vida do Flow pela Graph API.
 *
 *   node scripts/publish-flow.mjs --upload-key     # registra a chave pública
 *   node scripts/publish-flow.mjs --create         # cria o Flow (retorna o ID)
 *   node scripts/publish-flow.mjs --update         # sobe flows/lead-capture.flow.json
 *   node scripts/publish-flow.mjs --endpoint URL   # aponta o endpoint de dados
 *   node scripts/publish-flow.mjs --publish        # publica (vira imutável)
 *
 * Lê as credenciais de .env.local (ou do ambiente).
 */
import fs from "node:fs";
import path from "node:path";

loadDotEnv(".env.local");

const GRAPH = process.env.GRAPH_API_VERSION || "v21.0";
const TOKEN = requireEnv("WHATSAPP_TOKEN");
const args = process.argv.slice(2);

const flag = (name) => args.includes(name);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args.length === 0) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf-8").split("*/")[0]);
  process.exit(0);
}

if (flag("--upload-key")) await uploadPublicKey();
if (flag("--create")) await createFlow();
if (flag("--update")) await updateFlowJson();
if (flag("--endpoint")) await setEndpoint(valueOf("--endpoint"));
if (flag("--publish")) await publishFlow();

// ---------------------------------------------------------------- operações

async function uploadPublicKey() {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const publicKey = fs.readFileSync(
    path.join(process.cwd(), "keys", "public.pem"),
    "utf-8",
  );

  const body = new URLSearchParams({ business_public_key: publicKey });
  const result = await graph(
    `${phoneNumberId}/whatsapp_business_encryption`,
    "POST",
    body,
  );
  console.log("Chave pública registrada:", result);
  console.log(
    "Confira o status com: curl -H \"Authorization: Bearer $WHATSAPP_TOKEN\" \\\n" +
      `  https://graph.facebook.com/${GRAPH}/${phoneNumberId}/whatsapp_business_encryption`,
  );
}

async function createFlow() {
  const wabaId = requireEnv("WHATSAPP_BUSINESS_ACCOUNT_ID");

  const result = await graph(`${wabaId}/flows`, "POST", {
    name: process.env.FLOW_NAME || "Captação de demanda",
    categories: ["LEAD_GENERATION"],
    // Sem endpoint_uri aqui: o Flow começa como rascunho e a URI é definida
    // depois, quando o deploy já existe.
  });

  console.log("Flow criado:", result);
  console.log(`\nAdicione ao .env.local:\nWHATSAPP_FLOW_ID=${result.id}`);
}

async function updateFlowJson() {
  const flowId = requireEnv("WHATSAPP_FLOW_ID");
  const filePath = path.join(process.cwd(), "flows", "lead-capture.flow.json");
  const content = fs.readFileSync(filePath);

  // O upload do asset é multipart, não JSON.
  const form = new FormData();
  form.append("name", "flow.json");
  form.append("asset_type", "FLOW_JSON");
  form.append(
    "file",
    new Blob([content], { type: "application/json" }),
    "flow.json",
  );

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH}/${flowId}/assets`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    },
  );

  const result = await response.json();
  if (!response.ok) fail("Falha ao subir o Flow JSON", result);

  // validation_errors vazio é o sinal verde para publicar.
  console.log("Flow JSON enviado:", JSON.stringify(result, null, 2));
}

async function setEndpoint(uri) {
  if (!uri) fail("Informe a URL: --endpoint https://seu-app.vercel.app/api/whatsapp/flow");
  const flowId = requireEnv("WHATSAPP_FLOW_ID");

  const result = await graph(flowId, "POST", { endpoint_uri: uri });
  console.log("Endpoint definido:", result);
}

async function publishFlow() {
  const flowId = requireEnv("WHATSAPP_FLOW_ID");
  const result = await graph(`${flowId}/publish`, "POST", {});
  console.log("Flow publicado:", result);
  console.log(
    "A partir de agora o JSON é imutável. Para mudar telas, crie uma nova versão do Flow.",
  );
}

// ----------------------------------------------------------------- helpers

async function graph(path, method, body) {
  const isForm = body instanceof URLSearchParams;

  const response = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": isForm
        ? "application/x-www-form-urlencoded"
        : "application/json",
    },
    body: isForm ? body : JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) fail(`Graph API ${response.status}`, result);
  return result;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`Variável de ambiente ausente: ${name}`);
  return value;
}

function fail(message, detail) {
  console.error(`\n${message}`);
  if (detail) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

/** Carrega .env.local sem depender de pacote externo. */
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
