import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, isAdmin, sessionValue } from "@/lib/admin-auth";
import { criarChave, listarChaves, revogarChave } from "@/lib/api-keys";
import { env } from "@/lib/env";
import { descobrirNumeros } from "@/lib/meta-oauth";
import { listContacts } from "@/lib/repository";
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
import { listarWebhooks } from "@/lib/webhooks-out";

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

/**
 * Cria a chave e guarda o valor em claro para exibição única.
 *
 * O valor não volta pela URL de propósito: ficaria no histórico do navegador
 * e nos logs de acesso do servidor, que é exatamente onde uma credencial não
 * pode estar.
 */
async function novaChaveApi(formData: FormData): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return;

  try {
    const { chave } = await criarChave(nome);
    await writeSetting(SETTINGS_KEYS.apiKeyReveal, { nome, chave });
    await deleteSetting(SETTINGS_KEYS.apiKeyError);
  } catch (erro) {
    console.error("[admin] falha ao criar chave de API:", erro);
    await writeSetting(SETTINGS_KEYS.apiKeyError, {
      mensagem: erro instanceof Error ? erro.message : "Falha desconhecida.",
    });
  }

  revalidatePath("/admin");
}

async function esconderChaveApi(): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  await deleteSetting(SETTINGS_KEYS.apiKeyReveal);
  revalidatePath("/admin");
}

async function esconderErroChaveApi(): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  await deleteSetting(SETTINGS_KEYS.apiKeyError);
  revalidatePath("/admin");
}

async function revogarChaveApi(formData: FormData): Promise<void> {
  "use server";

  if (!(await isAdmin())) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  try {
    await revogarChave(id);
  } catch (erro) {
    console.error("[admin] falha ao revogar chave:", erro);
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
        <h1>Painel</h1>
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
  const [
    credenciais,
    metadata,
    pendente,
    chaves,
    webhooks,
    contatos,
    reveladaOuNao,
    erroChave,
  ] = await Promise.all([
    loadWhatsAppConfig(),
    loadTokenMetadata(),
    readSetting<PendingConnection>(SETTINGS_KEYS.pendingConnection),
    listarChaves().catch(() => []),
    listarWebhooks().catch(() => []),
    listContacts({ limit: 20, offset: 0 }).catch(() => []),
    readSetting<{ nome: string; chave: string }>(SETTINGS_KEYS.apiKeyReveal),
    readSetting<{ mensagem: string }>(SETTINGS_KEYS.apiKeyError),
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

      <h2>API</h2>
      <p className="sub">
        Chaves para outras plataformas usarem este WhatsApp. A documentação
        dos endpoints está em <code>docs/API.md</code>.
      </p>

      {erroChave && (
        <div className="card aviso erro">
          <p style={{ marginTop: 0, marginBottom: 0 }}>
            Não foi possível criar a chave: {erroChave.mensagem}
          </p>
          {erroChave.mensagem.includes("api_keys") && (
            <p className="sub" style={{ marginBottom: 0 }}>
              Parece que a migração <code>supabase/migrations/0003_api.sql</code>{" "}
              ainda não foi rodada no Supabase. Rode no SQL Editor do projeto.
            </p>
          )}
          <form action={esconderErroChaveApi}>
            <button type="submit" className="botao secundario">
              Ok
            </button>
          </form>
        </div>
      )}

      {reveladaOuNao && (
        <div className="card aviso ok">
          <p style={{ marginTop: 0 }}>
            Chave <strong>{reveladaOuNao.nome}</strong> criada. Copie agora —
            ela não aparece de novo:
          </p>
          <p>
            <code style={{ wordBreak: "break-all" }}>{reveladaOuNao.chave}</code>
          </p>
          <form action={esconderChaveApi}>
            <button type="submit">Já copiei</button>
          </form>
        </div>
      )}

      <div className="card">
        <form action={novaChaveApi} className="acoes" style={{ marginTop: 0 }}>
          <input
            type="text"
            name="nome"
            placeholder="Nome da integração (ex.: CRM barbearia)"
            required
            style={{ flex: 1 }}
          />
          <button type="submit">Criar chave</button>
        </form>
      </div>

      {chaves.length === 0 ? (
        <div className="card empty">Nenhuma chave criada ainda.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Chave</th>
                <th>Criada</th>
                <th>Último uso</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {chaves.map((chave) => (
                <tr key={chave.id}>
                  <td>{chave.nome}</td>
                  <td>
                    <code>{chave.prefixo}…</code>
                  </td>
                  <td>{formatarData(chave.created_at)}</td>
                  <td>
                    {chave.last_used_at ? formatarData(chave.last_used_at) : "—"}
                  </td>
                  <td>
                    <span className={chave.revoked_at ? "badge" : "badge urgente"}>
                      {chave.revoked_at ? "Revogada" : "Ativa"}
                    </span>
                  </td>
                  <td>
                    {!chave.revoked_at && (
                      <form action={revogarChaveApi}>
                        <input type="hidden" name="id" value={chave.id} />
                        <button type="submit" className="botao secundario">
                          Revogar
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {webhooks.length > 0 && (
        <>
          <h2>Webhooks de saída</h2>
          <p className="sub">
            Destinos que recebem os eventos. Cadastrados pela própria API, em{" "}
            <code>POST /api/v1/webhooks</code>.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Eventos</th>
                  <th>Última entrega</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((webhook) => (
                  <tr key={webhook.id}>
                    <td style={{ maxWidth: "22rem", wordBreak: "break-all" }}>
                      {webhook.url}
                    </td>
                    <td>{webhook.eventos.join(", ")}</td>
                    <td>
                      {webhook.last_sent_at
                        ? formatarData(webhook.last_sent_at)
                        : "—"}
                    </td>
                    <td>
                      {webhook.last_error ? (
                        <span className="error">{webhook.last_error}</span>
                      ) : (
                        <span className="badge">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Contatos recentes</h2>
      <p className="sub">
        Quem já mandou mensagem pro número. Nenhuma mensagem daqui gera
        resposta automática — o que chega vira o evento{" "}
        <code>message.received</code> nos webhooks cadastrados.
      </p>

      {contatos.length === 0 ? (
        <div className="card empty">Nenhuma mensagem recebida ainda.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
              </tr>
            </thead>
            <tbody>
              {contatos.map((contato) => (
                <tr key={contato.id}>
                  <td>{contato.profile_name ?? "—"}</td>
                  <td>{contato.wa_id}</td>
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
