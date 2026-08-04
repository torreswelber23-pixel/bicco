import { cookies } from "next/headers";
import {
  MetaOAuthError,
  descobrirNumeros,
  trocarCodePorToken,
  trocarPorLongaDuracao,
  verificarToken,
} from "@/lib/meta-oauth";
import { redirectUriDe } from "@/lib/oauth-redirect";
import {
  SETTINGS_KEYS,
  writeSetting,
  type PendingConnection,
  type TokenMetadata,
  type WhatsAppCredentials,
} from "@/lib/settings";
import { STATE_COOKIE } from "../start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Volta para o painel com uma mensagem legível na query. */
function voltarAoPainel(request: Request, params: Record<string, string>) {
  const destino = new URL("/admin", redirectUriDe(request));
  for (const [chave, valor] of Object.entries(params)) {
    destino.searchParams.set(chave, valor);
  }
  return Response.redirect(destino.toString(), 302);
}

/**
 * Recebe a autorização da Meta e grava as credenciais.
 *
 * Diferente do padrão que vimos em outros projetos, aqui a troca por token de
 * longa duração é obrigatória: guardar um token de 1 hora deixaria o
 * atendimento morrer no mesmo dia, e o sintoma seria indistinguível de token
 * inválido.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const erroMeta = params.get("error_description") ?? params.get("error");
  if (erroMeta) {
    return voltarAoPainel(request, { conexao: "erro", motivo: erroMeta });
  }

  const code = params.get("code");
  const state = params.get("state");

  const store = await cookies();
  const stateEsperado = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!code || !state || !stateEsperado || state !== stateEsperado) {
    return voltarAoPainel(request, {
      conexao: "erro",
      motivo: "Autorização inválida ou expirada. Tente conectar novamente.",
    });
  }

  try {
    const redirectUri = redirectUriDe(request);

    const curto = await trocarCodePorToken(code, redirectUri);
    const longo = await trocarPorLongaDuracao(curto.access_token);

    const perfil = await verificarToken(longo.access_token);
    const numeros = await descobrirNumeros(longo.access_token);

    if (numeros.length === 0) {
      return voltarAoPainel(request, {
        conexao: "erro",
        motivo:
          "Nenhum número de WhatsApp encontrado nesta conta. " +
          "Confirme que o usuário tem acesso à conta comercial.",
      });
    }

    // Com um número só, não há o que escolher. Com vários — comum quando o
    // usuário Meta tem acesso a mais de um negócio — o admin escolhe qual
    // número usar, em vez de assumir o primeiro que a Meta devolver.
    if (numeros.length > 1) {
      const pendente: PendingConnection = {
        accessToken: longo.access_token,
        expiresIn: longo.expires_in,
        connectedBy: perfil.name,
        numeros: numeros.map((n) => ({
          id: n.id,
          wabaId: n.wabaId,
          display_phone_number: n.display_phone_number,
          verified_name: n.verified_name,
        })),
      };

      await writeSetting(SETTINGS_KEYS.pendingConnection, pendente);

      return voltarAoPainel(request, { conexao: "escolher" });
    }

    const escolhido = numeros[0];

    const credenciais: WhatsAppCredentials = {
      accessToken: longo.access_token,
      phoneNumberId: escolhido.id,
      wabaId: escolhido.wabaId,
    };

    const metadata: TokenMetadata = {
      expiresAt: longo.expires_in
        ? new Date(Date.now() + longo.expires_in * 1000).toISOString()
        : undefined,
      longLived: Boolean(longo.expires_in && longo.expires_in > 60 * 60 * 24),
      source: "oauth",
      connectedAt: new Date().toISOString(),
      connectedBy: perfil.name,
    };

    await writeSetting(SETTINGS_KEYS.credentials, credenciais);
    await writeSetting(SETTINGS_KEYS.tokenMetadata, metadata);

    return voltarAoPainel(request, {
      conexao: "ok",
      numero: escolhido.display_phone_number ?? escolhido.id,
    });
  } catch (erro) {
    console.error("[oauth] falha no callback:", erro);

    const motivo =
      erro instanceof MetaOAuthError
        ? erro.message
        : "Erro inesperado ao concluir a autorização.";

    return voltarAoPainel(request, { conexao: "erro", motivo });
  }
}
