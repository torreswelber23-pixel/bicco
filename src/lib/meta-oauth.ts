import { env } from "./env";

/**
 * OAuth com a Meta para obter o token do WhatsApp sem copiar e colar nada.
 *
 * O ciclo tem duas trocas, e a segunda é a que importa:
 *   1. `code` (da autorização) → token de curta duração, dura ~1 hora
 *   2. curta duração → longa duração (`fb_exchange_token`), dura ~60 dias
 *
 * Se a segunda troca falhar e a gente guardasse o token curto mesmo assim, o
 * atendimento morreria em uma hora sem aviso — por isso aqui ela é obrigatória.
 */

const OAUTH_BASE = "https://www.facebook.com";
const GRAPH_BASE = "https://graph.facebook.com";

export const META_SCOPES = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
  "business_management",
].join(",");

export class MetaOAuthError extends Error {
  constructor(
    message: string,
    readonly detalhe?: unknown,
  ) {
    super(message);
    this.name = "MetaOAuthError";
  }
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: redirectUri,
    state,
    scope: META_SCOPES,
    response_type: "code",
  });

  return `${OAUTH_BASE}/${env.graphApiVersion}/dialog/oauth?${params}`;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

async function chamarGraph(
  caminho: string,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const url = `${GRAPH_BASE}/${env.graphApiVersion}/${caminho}?${new URLSearchParams(params)}`;

  const resposta = await fetch(url);
  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok || !(corpo as TokenResponse).access_token) {
    throw new MetaOAuthError(
      `Meta respondeu ${resposta.status} em ${caminho}`,
      corpo,
    );
  }

  return corpo as TokenResponse;
}

/** Passo 1: troca o `code` da autorização por um token de curta duração. */
export function trocarCodePorToken(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return chamarGraph("oauth/access_token", {
    client_id: env.metaAppId,
    client_secret: env.appSecret,
    redirect_uri: redirectUri,
    code,
  });
}

/**
 * Passo 2: converte para token de longa duração (~60 dias).
 *
 * Também é o que a renovação chama. Atenção: quando aplicado a um token que
 * JÁ é de longa duração, a Meta costuma devolver a mesma expiração em vez de
 * uma janela nova. Por isso quem chama deve comparar a validade antes e depois
 * em vez de assumir que renovou.
 */
export function trocarPorLongaDuracao(
  tokenAtual: string,
): Promise<TokenResponse> {
  return chamarGraph("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.metaAppId,
    client_secret: env.appSecret,
    fb_exchange_token: tokenAtual,
  });
}

export interface PerfilMeta {
  id: string;
  name?: string;
}

/** Confirma que o token funciona e descobre quem autorizou. */
export async function verificarToken(token: string): Promise<PerfilMeta> {
  const url = `${GRAPH_BASE}/${env.graphApiVersion}/me?fields=id,name&access_token=${token}`;
  const resposta = await fetch(url);
  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new MetaOAuthError("Token recusado pela Meta", corpo);
  }

  return corpo as PerfilMeta;
}

export interface NumeroWhatsApp {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  wabaId: string;
}

/**
 * Descobre automaticamente os números disponíveis para a conta.
 *
 * É isso que dispensa você procurar o Phone Number ID no painel: com o token
 * em mãos, a própria Meta diz quais números existem.
 */
export async function descobrirNumeros(
  token: string,
): Promise<NumeroWhatsApp[]> {
  const contasUrl =
    `${GRAPH_BASE}/${env.graphApiVersion}/me/businesses` +
    `?fields=id,owned_whatsapp_business_accounts{id,phone_numbers{id,display_phone_number,verified_name}}` +
    `&access_token=${token}`;

  const resposta = await fetch(contasUrl);
  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    throw new MetaOAuthError("Falha ao listar números", corpo);
  }

  const numeros: NumeroWhatsApp[] = [];

  for (const negocio of (corpo as { data?: unknown[] }).data ?? []) {
    const contas =
      (negocio as { owned_whatsapp_business_accounts?: { data?: unknown[] } })
        .owned_whatsapp_business_accounts?.data ?? [];

    for (const conta of contas) {
      const wabaId = (conta as { id: string }).id;
      const telefones =
        (conta as { phone_numbers?: { data?: unknown[] } }).phone_numbers
          ?.data ?? [];

      for (const telefone of telefones) {
        numeros.push({ ...(telefone as NumeroWhatsApp), wabaId });
      }
    }
  }

  return numeros;
}
