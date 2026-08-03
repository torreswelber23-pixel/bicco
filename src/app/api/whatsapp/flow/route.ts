import { NextResponse } from "next/server";
import { env } from "@/lib/env";
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

/** Facilita conferir de fora se a rota está no ar; não expõe nada sensível. */
export async function GET(): Promise<Response> {
  return NextResponse.json({ status: "ok", endpoint: "whatsapp-flow" });
}
