import { env } from "./env";
import { loadWhatsAppConfig } from "./whatsapp-config";

/**
 * Publica o Flow direto pela Graph API, sem passar pelo WhatsApp Manager.
 *
 * Depois de publicado, o Flow vira imutável — mudar uma tela exige criar uma
 * nova versão. Por isso isso fica separado de "salvar o JSON" (feito à parte,
 * colando no Flow Builder): publicar é o passo final e sem volta.
 */

export interface ResultadoPublicacao {
  publicado: boolean;
  mensagem: string;
}

export async function publicarFlow(): Promise<ResultadoPublicacao> {
  const config = await loadWhatsAppConfig();
  if (!config) {
    return {
      publicado: false,
      mensagem: "Nenhuma credencial conectada. Conecte a conta em /admin antes de publicar.",
    };
  }

  const versao = config.graphVersion ?? env.graphApiVersion;
  const url = `https://graph.facebook.com/${versao}/${env.flowId}/publish`;

  const resposta = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });

  const corpo = await resposta.json().catch(() => ({}));

  if (!resposta.ok) {
    const erro = (corpo as { error?: { message?: string } }).error;
    return {
      publicado: false,
      mensagem: erro?.message
        ? `A Meta recusou: ${erro.message}`
        : `A Meta respondeu ${resposta.status}.`,
    };
  }

  return { publicado: true, mensagem: "Flow publicado." };
}
