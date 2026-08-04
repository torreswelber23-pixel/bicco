import { REQUIRED_ENV, env, missingEnv } from "@/lib/env";
import { isValidSignature } from "@/lib/signature";
import { processWebhook, type WebhookPayload } from "@/lib/webhook-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handshake de verificação do webhook.
 *
 * A Meta chama esta URL uma vez, ao salvar a configuração, e espera receber
 * o hub.challenge de volta em texto puro.
 */
export async function GET(request: Request): Promise<Response> {
  const faltando = missingEnv(REQUIRED_ENV.webhookVerify);
  if (faltando.length > 0) {
    console.error("[webhook] variáveis ausentes:", faltando.join(", "));
    return new Response(
      `Configuração incompleta no servidor. Variáveis ausentes: ${faltando.join(", ")}.`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const params = new URL(request.url).searchParams;

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === env.verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("verificação falhou", { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  const faltando = missingEnv(REQUIRED_ENV.webhookReceive);
  if (faltando.length > 0) {
    console.error("[webhook] variáveis ausentes:", faltando.join(", "));
    return new Response(
      `Configuração incompleta no servidor. Variáveis ausentes: ${faltando.join(", ")}.`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const rawBody = await request.text();

  if (
    !isValidSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      env.appSecret,
    )
  ) {
    return new Response("assinatura inválida", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return new Response("json inválido", { status: 400 });
  }

  // A Meta reenvia enquanto não receber 200, e reenvio duplica atendimento.
  // Por isso o processamento nunca propaga exceção para cá.
  try {
    await processWebhook(payload);
  } catch (error) {
    console.error("[webhook] erro não tratado:", error);
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
}
