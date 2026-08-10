import { supabase } from "./supabase";

/**
 * Chave-valor persistido no Supabase.
 *
 * Existe para guardar o que precisa mudar em runtime sem redeploy — hoje, as
 * credenciais da Meta obtidas por OAuth e renovadas por cron.
 */

export const SETTINGS_KEYS = {
  credentials: "whatsapp_credentials",
  tokenMetadata: "whatsapp_token_metadata",
  pendingConnection: "whatsapp_pending_connection",
  /**
   * Chave de API recém-criada, aguardando ser copiada.
   *
   * Existe porque a chave em claro só pode ser exibida uma vez: passá-la na
   * URL a deixaria no histórico do navegador e nos logs de acesso. Aqui ela
   * vive até o admin clicar em "já copiei", e some.
   */
  apiKeyReveal: "api_key_reveal",
  /** Erro da última tentativa de criar chave, para o painel mostrar em vez de engolir. */
  apiKeyError: "api_key_error",
} as const;

export interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
  graphVersion?: string;
}

export interface TokenMetadata {
  /** ISO. Ausente quando o token não expira (System User). */
  expiresAt?: string;
  /** false = token de curta duração; o atendimento vai parar em horas. */
  longLived: boolean;
  /** Como o token chegou aqui: "oauth" | "oauth_refresh" | "env". */
  source: string;
  connectedAt: string;
  /** Nome do usuário Meta que autorizou, para exibir no painel. */
  connectedBy?: string;
}

/**
 * Guardado entre o callback do OAuth e a escolha do número, quando a conta
 * autorizada enxerga mais de um número de WhatsApp — o token já é de longa
 * duração, mas ainda não sabemos qual número o admin quer usar.
 */
export interface PendingConnection {
  accessToken: string;
  expiresIn?: number;
  connectedBy?: string;
  numeros: {
    id: string;
    wabaId: string;
    display_phone_number?: string;
    verified_name?: string;
  }[];
}

export async function readSetting<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase()
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    console.error(`[settings] falha ao ler "${key}":`, error.message);
    return null;
  }

  return (data as { value: T } | null)?.value ?? null;
}

export async function writeSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabase()
    .from("settings")
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (error) throw new Error(`Falha ao gravar "${key}": ${error.message}`);
}

export async function deleteSetting(key: string): Promise<void> {
  const { error } = await supabase().from("settings").delete().eq("key", key);
  if (error) console.error(`[settings] falha ao apagar "${key}":`, error.message);
}
