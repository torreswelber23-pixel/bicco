import { autenticar, corpoJson, erro, ok } from "@/lib/api-http";
import { listarWebhooks, registrarWebhook } from "@/lib/webhooks-out";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENTOS = ["message.received"];

export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if ("resposta" in auth) return auth.resposta;

  return ok({ data: await listarWebhooks() });
}

/**
 * Registra um destino para receber eventos.
 *
 * O `secret` volta uma única vez, na criação — é com ele que o destino
 * valida a assinatura `X-Bicco-Signature` de cada entrega. Sem guardar esse
 * valor, o outro lado não tem como distinguir um evento real de um POST
 * forjado por quem descobriu a URL.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if ("resposta" in auth) return auth.resposta;

  const body = await corpoJson(request);
  if ("resposta" in body) return body.resposta;

  const url = typeof body.corpo.url === "string" ? body.corpo.url.trim() : "";

  if (!/^https:\/\/.+/.test(url)) {
    return erro(400, "invalid_url", "Informe uma url https válida.");
  }

  const eventos = Array.isArray(body.corpo.events)
    ? body.corpo.events.map(String)
    : EVENTOS;

  const desconhecido = eventos.find((evento) => !EVENTOS.includes(evento));
  if (desconhecido) {
    return erro(
      400,
      "unknown_event",
      `Evento "${desconhecido}" não existe. Use: ${EVENTOS.join(", ")}.`,
    );
  }

  const { endpoint, secret } = await registrarWebhook({
    url,
    eventos,
    apiKeyId: auth.chave.id,
  });

  return ok({ ...endpoint, secret }, 201);
}
