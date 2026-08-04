import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, isAdmin, sessionValue } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { CANAIS, ORCAMENTOS, SERVICOS, URGENCIAS, labelOf } from "@/lib/catalog";
import { descobrirNumeros } from "@/lib/meta-oauth";
import { listLeads } from "@/lib/repository";
import {
  SETTINGS_KEYS,
  deleteSetting,
  readSetting,
  writeSetting,
  type PendingConnection,
  type TokenMetadata,
  type WhatsAppCredentials,
} from "@/lib/settings";
import { renovarToken } from "@/lib/token-refresh";
import {
  diasRestantes,
  loadTokenMetadata,
  loadWhatsAppConfig,
} from "@/lib/whatsapp-config";

export const dynamic = "force-dynamic";

async function login(formData: FormData): Promise<void> {
  "use server";

  const senha = String(formData.get("senha") ?? "");
  if (senha !== env.adminPassword) return;

  const store = await cookies();
  store.set(ADMIN_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

async function renovar(): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  try {
    const resultado = await renovarToken();
    console.log("[admin] renovação manual:", resultado.mensagem);
  } catch (erro) {
    console.error("[admin] falha ao renovar:", erro);
  }

  revalidatePath("/admin");
}

/**
 * Refaz a descoberta de números com o token já conectado — sem passar de
 * novo pela tela de login da Meta — para o admin trocar qual número o
 * sistema usa quando a conta autorizada enxerga mais de um.
 */
async function trocarNumero(): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  const credenciais = await readSetting<WhatsAppCredentials>(
    SETTINGS_KEYS.credentials,
  );
  if (!credenciais) return;

  try {
    const numeros = await descobrirNumeros(credenciais.accessToken);
    const metadata = await readSetting<TokenMetadata>(
      SETTINGS_KEYS.tokenMetadata,
    );

    const pendente: PendingConnection = {
      accessToken: credenciais.accessToken,
      connectedBy: metadata?.connectedBy,
      numeros,
    };

    await writeSetting(SETTINGS_KEYS.pendingConnection, pendente);
  } catch (erro) {
    console.error("[admin] falha ao listar números:", erro);
  }

  revalidatePath("/admin");
}

async function escolherNumero(formData: FormData): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  const phoneNumberId = String(formData.get("phoneNumberId") ?? "");
  const pendente = await readSetting<PendingConnection>(
    SETTINGS_KEYS.pendingConnection,
  );
  const escolhido = pendente?.numeros.find((n) => n.id === phoneNumberId);

  if (pendente && escolhido) {
    const metadataAtual = await readSetting<TokenMetadata>(
      SETTINGS_KEYS.tokenMetadata,
    );

    const credenciais: WhatsAppCredentials = {
      accessToken: pendente.accessToken,
      phoneNumberId: escolhido.id,
      wabaId: escolhido.wabaId,
    };

    const metadata: TokenMetadata = {
      expiresAt: pendente.expiresIn
        ? new Date(Date.now() + pendente.expiresIn * 1000).toISOString()
        : metadataAtual?.expiresAt,
      longLived:
        pendente.expiresIn !== undefined
          ? pendente.expiresIn > 60 * 60 * 24
          : (metadataAtual?.longLived ?? true),
      source: "oauth",
      connectedAt: metadataAtual?.connectedAt ?? new Date().toISOString(),
      connectedBy: pendente.connectedBy ?? metadataAtual?.connectedBy,
    };

    await writeSetting(SETTINGS_KEYS.credentials, credenciais);
    await writeSetting(SETTINGS_KEYS.tokenMetadata, metadata);
  }

  await deleteSetting(SETTINGS_KEYS.pendingConnection);
  revalidatePath("/admin");
}

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (!(await isAdmin())) {
    return (
      <main>
        <h1>Painel de demandas</h1>
        <p className="sub">Acesso restrito.</p>
        <form className="login" action={login}>
          <input
            type="password"
            name="senha"
            placeholder="Senha"
            autoComplete="current-password"
            required
          />
          <button type="submit">Entrar</button>
        </form>
      </main>
    );
  }

  const params = await searchParams;
  const [credenciais, metadata, leads, pendente] = await Promise.all([
    loadWhatsAppConfig(),
    loadTokenMetadata(),
    listLeads(),
    readSetting<PendingConnection>(SETTINGS_KEYS.pendingConnection),
  ]);

  const dias = diasRestantes(metadata);

  return (
    <main>
      <h1>Painel</h1>

      {params.conexao === "ok" && (
        <div className="card aviso ok">
          Conta conectada com sucesso
          {params.numero ? ` — número ${params.numero}` : ""}.
        </div>
      )}
      {params.conexao === "erro" && (
        <div className="card aviso erro">
          Não foi possível conectar: {params.motivo ?? "erro desconhecido"}
        </div>
      )}
      {params.conexao === "escolher" && (
        <div className="card aviso">
          Login feito. Agora escolha qual número usar, logo abaixo.
        </div>
      )}

      <h2>Conexão com a Meta</h2>

      {pendente && pendente.numeros.length > 0 && (
        <div className="card aviso">
          <p style={{ marginTop: 0 }}>
            Essa conta enxerga {pendente.numeros.length} número(s) de
            WhatsApp. Escolha qual usar:
          </p>
          {pendente.numeros.map((numero) => (
            <form
              key={numero.id}
              action={escolherNumero}
              style={{ marginBottom: "0.5rem" }}
            >
              <input type="hidden" name="phoneNumberId" value={numero.id} />
              <button type="submit" className="botao secundario">
                {numero.display_phone_number ?? numero.id}
                {numero.verified_name ? ` — ${numero.verified_name}` : ""}
              </button>
            </form>
          ))}
        </div>
      )}

      {!credenciais ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            Nenhuma conta conectada. Ao conectar, o sistema descobre o número e
            guarda o token automaticamente — sem copiar e colar nada.
          </p>
          <a className="botao" href="/api/auth/meta/start">
            Conectar com a Meta
          </a>
        </div>
      ) : (
        <div className="card">
          <table className="simples">
            <tbody>
              <tr>
                <th>Número (Phone Number ID)</th>
                <td>
                  <code>{credenciais.phoneNumberId}</code>
                </td>
              </tr>
              <tr>
                <th>Origem do token</th>
                <td>
                  {metadata?.source === "env"
                    ? "Variável de ambiente"
                    : metadata?.source === "oauth_refresh"
                      ? "OAuth (renovado)"
                      : metadata?.source === "oauth"
                        ? "OAuth"
                        : "Variável de ambiente"}
                </td>
              </tr>
              {metadata?.connectedBy && (
                <tr>
                  <th>Autorizado por</th>
                  <td>{metadata.connectedBy}</td>
                </tr>
              )}
              <tr>
                <th>Validade</th>
                <td>
                  {dias === null ? (
                    <span className="badge">Não expira</span>
                  ) : (
                    <span className={dias <= 7 ? "badge urgente" : "badge"}>
                      {dias} dia(s) restante(s)
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {dias !== null && dias <= 7 && (
            <p className="error" style={{ marginBottom: 0 }}>
              O token está perto de expirar. Se a renovação não avançar o prazo,
              reconecte — a Meta só dá janela nova em nova autorização.
            </p>
          )}

          <div className="acoes">
            {dias !== null && (
              <form action={renovar} style={{ display: "inline" }}>
                <button type="submit">Renovar token</button>
              </form>
            )}
            <form action={trocarNumero} style={{ display: "inline" }}>
              <button type="submit">Trocar número</button>
            </form>
            <a className="botao secundario" href="/api/auth/meta/start">
              Reconectar
            </a>
          </div>
        </div>
      )}

      <h2>Demandas captadas</h2>
      <p className="sub">
        {leads.length === 0
          ? "Nenhuma demanda ainda."
          : `${leads.length} registro(s), mais recentes primeiro.`}
      </p>

      {leads.length === 0 ? (
        <div className="card empty">
          Assim que alguém concluir o Flow, a demanda aparece aqui.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recebido</th>
                <th>Contato</th>
                <th>Serviço</th>
                <th>Demanda</th>
                <th>Urgência</th>
                <th>Orçamento</th>
                <th>Agenda</th>
                <th>Retorno por</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>{formatarData(lead.created_at)}</td>
                  <td>
                    {lead.nome ?? lead.contacts?.profile_name ?? "—"}
                    <br />
                    <span className="badge">{lead.contacts?.wa_id ?? "—"}</span>
                  </td>
                  <td>{labelOf(SERVICOS, lead.tipo_servico ?? undefined)}</td>
                  <td style={{ maxWidth: "22rem" }}>{lead.descricao ?? "—"}</td>
                  <td>
                    <span
                      className={
                        lead.urgencia === "imediata" ? "badge urgente" : "badge"
                      }
                    >
                      {labelOf(URGENCIAS, lead.urgencia ?? undefined)}
                    </span>
                  </td>
                  <td>{labelOf(ORCAMENTOS, lead.orcamento ?? undefined)}</td>
                  <td>
                    {lead.data_preferida
                      ? `${formatarDia(lead.data_preferida)} ${lead.horario_preferido ?? ""}`
                      : "—"}
                  </td>
                  <td>{labelOf(CANAIS, lead.canal_preferido ?? undefined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function formatarData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatarDia(date: string): string {
  const [ano, mes, dia] = date.split("-");
  return `${dia}/${mes}/${ano}`;
}
