import { autenticar, ok } from "@/lib/api-http";
import {
  diasRestantes,
  loadTokenMetadata,
  loadWhatsAppConfig,
} from "@/lib/whatsapp-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Estado do número conectado.
 *
 * É a chamada que uma integração faz primeiro, para confirmar que a chave
 * vale e que existe WhatsApp do outro lado. Nunca devolve o token — só o
 * suficiente para diagnosticar.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if ("resposta" in auth) return auth.resposta;

  const [credenciais, metadata] = await Promise.all([
    loadWhatsAppConfig(),
    loadTokenMetadata(),
  ]);

  const dias = diasRestantes(metadata);

  return ok({
    connected: Boolean(credenciais),
    phone_number_id: credenciais?.phoneNumberId ?? null,
    waba_id: credenciais?.wabaId ?? null,
    token: {
      source: metadata?.source ?? (credenciais ? "env" : null),
      expires_at: metadata?.expiresAt ?? null,
      days_remaining: dias,
    },
    key: {
      name: auth.chave.nome,
      scopes: auth.chave.escopos,
    },
  });
}
