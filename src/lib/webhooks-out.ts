import crypto from "node:crypto";
import { supabase } from "./supabase";

/**
 * Webhooks de saída: como o mundo externo fica sabendo do que acontece aqui.
 *
 * A API sozinha resolveria só metade do problema — dá pra enviar mensagem,
 * mas descobrir que chegou uma exigiria o CRM ficar perguntando de tempos em
 * tempos. Com webhook o evento chega no instante em que acontece.
 */

export type EventoApi = "message.received";

export interface WebhookEndpoint {
  id: string;
  url: string;
  eventos: string[];
  ativo: boolean;
  created_at: string;
  last_error: string | null;
  last_sent_at: string | null;
}

export async function registrarWebhook(params: {
  url: string;
  eventos?: string[];
  apiKeyId?: string;
}): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const secret = crypto.randomBytes(32).toString("base64url");

  const { data, error } = await supabase()
    .from("webhook_endpoints")
    .insert({
      url: params.url,
      secret,
      api_key_id: params.apiKeyId ?? null,
      ...(params.eventos?.length ? { eventos: params.eventos } : {}),
    })
    .select("id, url, eventos, ativo, created_at, last_error, last_sent_at")
    .single();

  if (error) throw new Error(`Falha ao registrar webhook: ${error.message}`);
  return { endpoint: data as WebhookEndpoint, secret };
}

export async function listarWebhooks(): Promise<WebhookEndpoint[]> {
  const { data, error } = await supabase()
    .from("webhook_endpoints")
    .select("id, url, eventos, ativo, created_at, last_error, last_sent_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Falha ao listar webhooks: ${error.message}`);
  return (data ?? []) as WebhookEndpoint[];
}

export async function removerWebhook(id: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("webhook_endpoints")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`Falha ao remover webhook: ${error.message}`);
  return Boolean(data);
}

/**
 * Entrega um evento a todos os endpoints inscritos nele.
 *
 * Nunca lança: isso roda no meio do atendimento, e uma integração externa
 * fora do ar não pode derrubar a conversa de quem está pedindo uma corrida.
 * O erro fica gravado em `last_error`, que é o que o painel mostra.
 */
export async function emitirEvento(
  evento: EventoApi,
  dados: unknown,
): Promise<void> {
  try {
    const { data, error } = await supabase()
      .from("webhook_endpoints")
      .select("id, url, secret, eventos")
      .eq("ativo", true)
      .contains("eventos", [evento]);

    if (error) {
      console.error("[webhooks] falha ao listar destinos:", error.message);
      return;
    }

    const destinos = (data ?? []) as {
      id: string;
      url: string;
      secret: string;
    }[];

    if (destinos.length === 0) return;

    const corpo = JSON.stringify({
      event: evento,
      created_at: new Date().toISOString(),
      data: dados,
    });

    await Promise.all(destinos.map((destino) => entregar(destino, corpo)));
  } catch (erro) {
    console.error("[webhooks] erro inesperado ao emitir evento:", erro);
  }
}

async function entregar(
  destino: { id: string; url: string; secret: string },
  corpo: string,
): Promise<void> {
  // A assinatura é sobre o corpo exato que vai na requisição — o destino
  // recalcula sobre os bytes recebidos, então reserializar quebraria.
  const assinatura = crypto
    .createHmac("sha256", destino.secret)
    .update(corpo, "utf-8")
    .digest("hex");

  try {
    const resposta = await fetch(destino.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bicco-Signature": `sha256=${assinatura}`,
      },
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });

    await marcar(
      destino.id,
      resposta.ok ? null : `HTTP ${resposta.status} em ${destino.url}`,
    );
  } catch (erro) {
    await marcar(destino.id, erro instanceof Error ? erro.message : String(erro));
  }
}

async function marcar(id: string, erro: string | null): Promise<void> {
  if (erro) console.error(`[webhooks] entrega falhou (${id}):`, erro);

  const { error } = await supabase()
    .from("webhook_endpoints")
    .update({ last_error: erro, last_sent_at: new Date().toISOString() })
    .eq("id", id);

  if (error) console.error("[webhooks] falha ao gravar status:", error.message);
}
