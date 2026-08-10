import crypto from "node:crypto";
import { supabase } from "./supabase";

/**
 * Chaves da API pública.
 *
 * A chave em claro existe uma única vez, no retorno de `criarChave()`. Depois
 * disso só o hash fica no banco — é o que garante que um dump do Postgres não
 * dá acesso à API, e é também por isso que o painel não consegue "mostrar de
 * novo" uma chave perdida: só resta revogar e criar outra.
 */

export interface ApiKey {
  id: string;
  nome: string;
  prefixo: string;
  escopos: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export const ESCOPOS_PADRAO = [
  "messages:send",
  "messages:read",
  "contacts:read",
  "orders:read",
  "orders:write",
];

const PREFIXO = "bic_live_";

function hashDe(chave: string): string {
  return crypto.createHash("sha256").update(chave).digest("hex");
}

/**
 * Cria uma chave nova e devolve o valor em claro — a única vez que ele
 * existe. Quem chama é responsável por entregá-lo ao usuário na mesma
 * resposta.
 */
export async function criarChave(
  nome: string,
  escopos: string[] = ESCOPOS_PADRAO,
): Promise<{ chave: string; registro: ApiKey }> {
  const segredo = crypto.randomBytes(32).toString("base64url");
  const chave = `${PREFIXO}${segredo}`;

  const { data, error } = await supabase()
    .from("api_keys")
    .insert({
      nome,
      key_hash: hashDe(chave),
      prefixo: chave.slice(0, PREFIXO.length + 6),
      escopos,
    })
    .select("id, nome, prefixo, escopos, created_at, last_used_at, revoked_at")
    .single();

  if (error) throw new Error(`Falha ao criar chave: ${error.message}`);
  return { chave, registro: data as ApiKey };
}

/**
 * Encontra a chave ativa correspondente ao valor apresentado.
 *
 * `last_used_at` é atualizado sem bloquear a requisição: é dado de
 * diagnóstico, e uma falha em gravá-lo não pode derrubar uma chamada válida.
 */
export async function verificarChave(chave: string): Promise<ApiKey | null> {
  if (!chave.startsWith(PREFIXO)) return null;

  const { data, error } = await supabase()
    .from("api_keys")
    .select("id, nome, prefixo, escopos, created_at, last_used_at, revoked_at")
    .eq("key_hash", hashDe(chave))
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("[api] falha ao verificar chave:", error.message);
    return null;
  }
  if (!data) return null;

  const registro = data as ApiKey;

  void supabase()
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", registro.id)
    .then(({ error: erro }) => {
      if (erro) console.error("[api] last_used_at:", erro.message);
    });

  return registro;
}

export async function listarChaves(): Promise<ApiKey[]> {
  const { data, error } = await supabase()
    .from("api_keys")
    .select("id, nome, prefixo, escopos, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar chaves: ${error.message}`);
  return (data ?? []) as ApiKey[];
}

/**
 * Revoga em vez de apagar: o histórico de qual integração existiu, e até
 * quando, é o que permite investigar um acesso indevido depois do fato.
 */
export async function revogarChave(id: string): Promise<void> {
  const { error } = await supabase()
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);

  if (error) throw new Error(`Falha ao revogar chave: ${error.message}`);
}
