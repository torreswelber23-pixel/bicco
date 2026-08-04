import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, isAdmin, sessionValue } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { CANAIS, ORCAMENTOS, SERVICOS, URGENCIAS, labelOf } from "@/lib/catalog";
import { listLeads } from "@/lib/repository";
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
  const [credenciais, metadata, leads] = await Promise.all([
    loadWhatsAppConfig(),
    loadTokenMetadata(),
    listLeads(),
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

      <h2>Conexão com a Meta</h2>

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
