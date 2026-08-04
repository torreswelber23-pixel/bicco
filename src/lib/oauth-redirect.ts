/**
 * URL de retorno do OAuth.
 *
 * Derivada da requisição em vez de fixada em variável de ambiente para que
 * preview e produção funcionem sem configuração extra. A Meta exige que o
 * valor seja idêntico nas duas chamadas (autorização e troca do code), por
 * isso ambas usam esta mesma função.
 *
 * Atenção: cada domínio usado precisa estar cadastrado no app da Meta em
 * "Login do Facebook → Configurações → URIs de redirecionamento válidos".
 */
export function redirectUriDe(request: Request): string {
  const url = new URL(request.url);

  // Atrás do proxy da Vercel, request.url pode vir como http interno.
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const protocolo = host.startsWith("localhost") ? "http" : "https";

  return `${protocolo}://${host}/api/auth/meta/callback`;
}
