import { trocarPorLongaDuracao } from "./meta-oauth";
import {
  SETTINGS_KEYS,
  readSetting,
  writeSetting,
  type TokenMetadata,
  type WhatsAppCredentials,
} from "./settings";
import { diasRestantes } from "./whatsapp-config";

/**
 * Renovação do token da Meta.
 *
 * Detalhe que costuma passar batido: reenviar um token que JÁ é de longa
 * duração para `fb_exchange_token` frequentemente devolve a MESMA expiração,
 * não uma janela nova de 60 dias. Um "renovado com sucesso" cego dá a falsa
 * sensação de que o problema está resolvido enquanto o prazo continua correndo.
 *
 * Por isso aqui a validade é comparada antes e depois, e o resultado diz
 * explicitamente se ganhou tempo ou não.
 */

export interface ResultadoRenovacao {
  renovou: boolean;
  /** true quando a Meta devolveu token mas sem estender o prazo. */
  prazoInalterado: boolean;
  diasAntes: number | null;
  diasDepois: number | null;
  mensagem: string;
}

export async function renovarToken(): Promise<ResultadoRenovacao> {
  const credenciais = await readSetting<WhatsAppCredentials>(
    SETTINGS_KEYS.credentials,
  );

  if (!credenciais?.accessToken) {
    return {
      renovou: false,
      prazoInalterado: false,
      diasAntes: null,
      diasDepois: null,
      mensagem:
        "Nenhuma credencial conectada. Conecte pelo painel antes de renovar.",
    };
  }

  const metadataAntes = await readSetting<TokenMetadata>(
    SETTINGS_KEYS.tokenMetadata,
  );
  const diasAntes = diasRestantes(metadataAntes);

  // Token sem expiração (System User) não precisa e não deve ser trocado.
  if (metadataAntes && !metadataAntes.expiresAt) {
    return {
      renovou: false,
      prazoInalterado: false,
      diasAntes: null,
      diasDepois: null,
      mensagem: "Token não expira — renovação desnecessária.",
    };
  }

  const novo = await trocarPorLongaDuracao(credenciais.accessToken);

  const expiresAt = novo.expires_in
    ? new Date(Date.now() + novo.expires_in * 1000).toISOString()
    : undefined;

  const metadataDepois: TokenMetadata = {
    expiresAt,
    longLived: Boolean(novo.expires_in && novo.expires_in > 60 * 60 * 24),
    source: "oauth_refresh",
    connectedAt: metadataAntes?.connectedAt ?? new Date().toISOString(),
    connectedBy: metadataAntes?.connectedBy,
  };

  await writeSetting(SETTINGS_KEYS.credentials, {
    ...credenciais,
    accessToken: novo.access_token,
  });
  await writeSetting(SETTINGS_KEYS.tokenMetadata, metadataDepois);

  const diasDepois = diasRestantes(metadataDepois);

  // Ganho de até 1 dia é ruído de arredondamento, não renovação de verdade.
  const ganhou =
    diasDepois !== null && diasAntes !== null && diasDepois > diasAntes + 1;

  const prazoInalterado = diasAntes !== null && !ganhou;

  return {
    renovou: true,
    prazoInalterado,
    diasAntes,
    diasDepois,
    mensagem: prazoInalterado
      ? `Token trocado, mas o prazo não avançou (${diasAntes} → ${diasDepois} dias). ` +
        `A Meta não estende token que já é de longa duração. ` +
        `Reconecte pelo painel para ganhar uma janela nova.`
      : `Token renovado. Validade agora: ${diasDepois ?? "sem expiração"} dias.`,
  };
}
