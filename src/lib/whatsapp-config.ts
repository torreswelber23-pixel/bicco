import { env } from "./env";
import {
  SETTINGS_KEYS,
  readSetting,
  type TokenMetadata,
  type WhatsAppCredentials,
} from "./settings";

/**
 * Resolve as credenciais do WhatsApp em uso.
 *
 * Precedência: banco primeiro, variável de ambiente como fallback.
 *
 * O motivo da ordem: um token obtido por OAuth é renovado periodicamente e
 * gravado no banco. Se a variável de ambiente ganhasse, a renovação não teria
 * efeito nenhum — o servidor continuaria usando o token velho até o próximo
 * redeploy. A consequência a saber: depois de conectar pelo painel, mudar
 * WHATSAPP_TOKEN na Vercel não muda nada até desconectar.
 */
export async function loadWhatsAppConfig(): Promise<WhatsAppCredentials | null> {
  const doBanco = await readSetting<WhatsAppCredentials>(
    SETTINGS_KEYS.credentials,
  );

  if (doBanco?.accessToken && doBanco?.phoneNumberId) {
    return doBanco;
  }

  // Fallback: configuração manual por variável de ambiente.
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) return null;

  return {
    accessToken: token,
    phoneNumberId,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: env.graphApiVersion,
  };
}

export async function loadTokenMetadata(): Promise<TokenMetadata | null> {
  return readSetting<TokenMetadata>(SETTINGS_KEYS.tokenMetadata);
}

/** Dias restantes até o token expirar. null = não expira ou desconhecido. */
export function diasRestantes(metadata: TokenMetadata | null): number | null {
  if (!metadata?.expiresAt) return null;

  const restanteMs = new Date(metadata.expiresAt).getTime() - Date.now();
  return Math.floor(restanteMs / (1000 * 60 * 60 * 24));
}
