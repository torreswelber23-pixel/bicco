import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { CANAIS, ORCAMENTOS, SERVICOS, URGENCIAS, labelOf } from "@/lib/catalog";
import { listLeads } from "@/lib/repository";

export const dynamic = "force-dynamic";

const COOKIE = "bicco_admin";

/** Valor esperado no cookie: derivado da senha, para não guardá-la em claro. */
function sessionValue(): string {
  return crypto.createHash("sha256").update(env.adminPassword).digest("hex");
}

async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(COOKIE)?.value;
  if (!value) return false;

  const expected = Buffer.from(sessionValue(), "hex");
  const received = Buffer.from(value, "hex");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

async function login(formData: FormData): Promise<void> {
  "use server";

  const senha = String(formData.get("senha") ?? "");
  if (senha !== env.adminPassword) return;

  const store = await cookies();
  store.set(COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
}

export default async function Admin() {
  if (!(await isAuthenticated())) {
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

  const leads = await listLeads();

  return (
    <main>
      <h1>Demandas captadas</h1>
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
                    <span className="badge">
                      {lead.contacts?.wa_id ?? "—"}
                    </span>
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
