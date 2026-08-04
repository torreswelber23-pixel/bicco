/**
 * Origem (protocolo + host) da requisição atual.
 *
 * Usada para montar o link do formulário de pedido que vai na mensagem do
 * WhatsApp — assim preview e produção funcionam sem variável de ambiente.
 */
export function baseUrlDe(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const protocolo = host.startsWith("localhost") ? "http" : "https";
  return `${protocolo}://${host}`;
}
