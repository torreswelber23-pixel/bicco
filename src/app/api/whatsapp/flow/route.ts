import { NextResponse } from "next/server";
import { REQUIRED_ENV, env, missingEnv } from "@/lib/env";
import {
  decryptRequest,
  encryptResponse,
  isEncryptedFlowRequest,
} from "@/lib/flow-crypto";
import { UnknownFlowTokenError, handleFlowRequest } from "@/lib/flow-handler";
import { isValidSignature } from "@/lib/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Endpoint de dados do Flow.
 *
 * É o endereço que você cadastra em "Endpoint URI" no Flow Builder. Toda
 * navegação entre telas passa por aqui, cifrada ponta a ponta.
 */
export async function POST(request: Request): Promise<Response> {
  // Configuração incompleta é erro de operação, não do cliente: responda algo
  // que dê para ler no relatório de verificação de integridade da Meta.
  const faltando = missingEnv(REQUIRED_ENV.flowEndpoint);
  if (faltando.length > 0) {
    console.error("[flow] variáveis de ambiente ausentes:", faltando.join(", "));
    return new Response(
      `Configuração incompleta no servidor. Variáveis ausentes: ${faltando.join(", ")}. ` +
        `Defina-as nas Environment Variables da Vercel e refaça o deploy.`,
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // A assinatura é sobre os bytes originais — leia o corpo como texto.
  const rawBody = await request.text();

  if (
    !isValidSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      env.appSecret,
    )
  ) {
    return new Response("assinatura inválida", { status: 432 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("json inválido", { status: 400 });
  }

  if (!isEncryptedFlowRequest(payload)) {
    return new Response("payload cifrado ausente", { status: 400 });
  }

  let decrypted;
  try {
    decrypted = decryptRequest(
      payload,
      env.flowPrivateKey,
      env.flowPrivateKeyPassphrase || undefined,
    );
  } catch (error) {
    console.error("[flow] falha de decifragem:", error);
    // 421 faz o cliente descartar a chave de sessão e refazer o handshake.
    return new Response("falha ao decifrar", { status: 421 });
  }

  const { body, aesKey, initialVector } = decrypted;

  try {
    const result = await handleFlowRequest(body);
    const encrypted = encryptResponse(result, aesKey, initialVector);

    // A resposta é base64 puro, não JSON.
    return new Response(encrypted, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    if (error instanceof UnknownFlowTokenError) {
      // Token expirado/desconhecido: o cliente mostra a tela de erro amigável.
      const encrypted = encryptResponse(
        {
          data: {
            acknowledged: true,
            error_msg: "Esta sessão expirou. Envie uma nova mensagem para recomeçar.",
          },
        },
        aesKey,
        initialVector,
      );
      return new Response(encrypted, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    console.error("[flow] erro no handler:", error);
    return new Response("erro interno", { status: 500 });
  }
}

/**
 * Diagnóstico de configuração, para abrir no navegador.
 *
 * Reporta apenas QUAIS variáveis estão definidas — nunca os valores. Os nomes
 * já são públicos (estão no .env.example do repositório), então isso não revela
 * nada; em compensação transforma "500 de corpo vazio" numa lista do que falta.
 */
export async function GET(): Promise<Response> {
  const ausentes = missingEnv(REQUIRED_ENV.todas);
  const bloqueiaEndpoint = missingEnv(REQUIRED_ENV.flowEndpoint);

  return NextResponse.json({
    endpoint: "whatsapp-flow",
    pronto_para_health_check: bloqueiaEndpoint.length === 0,
    variaveis_ausentes: ausentes,
    proximo_passo:
      ausentes.length === 0
        ? "Tudo configurado. Rode a verificação de integridade no Flow Builder."
        : "Defina as variáveis acima na Vercel (Settings → Environment Variables) e refaça o deploy.",
  });
}
