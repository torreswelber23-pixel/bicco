/**
 * Leitura centralizada das variáveis de ambiente.
 *
 * Nada aqui roda no browser: todas as chaves são segredos de servidor.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Veja .env.example e docs/SETUP.md.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

/**
 * Variáveis que cada rota precisa antes de conseguir responder qualquer coisa.
 *
 * Checar isso na entrada evita o pior modo de falha: o getter lançar no meio da
 * expressão e o Next devolver 500 de corpo vazio, que não diz nada a quem está
 * configurando na Meta.
 *
 * Só o mínimo indispensável entra aqui. O `ping` do health check, por exemplo,
 * nunca toca no Supabase — exigir as chaves do banco reprovaria uma verificação
 * que na prática funcionaria.
 */
export const REQUIRED_ENV = {
  /** Decifrar e validar assinatura: todo POST do Flow passa por isso. */
  flowEndpoint: ["WHATSAPP_APP_SECRET", "FLOW_PRIVATE_KEY"],
  /** Handshake do webhook compara só o verify token. */
  webhookVerify: ["WHATSAPP_VERIFY_TOKEN"],
  /** Recebimento de mensagens: valida assinatura antes de qualquer coisa. */
  webhookReceive: ["WHATSAPP_APP_SECRET"],
  /** Tudo que o atendimento completo usa, para o diagnóstico do GET. */
  todas: [
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_VERIFY_TOKEN",
    "FLOW_PRIVATE_KEY",
    "WHATSAPP_FLOW_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_PASSWORD",
  ],
} as const;

/** Nomes das variáveis ausentes. Nunca devolve valores, só nomes. */
export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]);
}

export const env = {
  /** Token permanente do System User com permissão whatsapp_business_messaging. */
  get whatsappToken() {
    return required("WHATSAPP_TOKEN");
  },
  /** ID do número de telefone (Phone Number ID), não o número em si. */
  get phoneNumberId() {
    return required("WHATSAPP_PHONE_NUMBER_ID");
  },
  /** App Secret do app Meta — usado para validar a assinatura X-Hub-Signature-256. */
  get appSecret() {
    return required("WHATSAPP_APP_SECRET");
  },
  /** Token arbitrário que você escolhe e repete no painel da Meta ao registrar o webhook. */
  get verifyToken() {
    return required("WHATSAPP_VERIFY_TOKEN");
  },
  /**
   * Chave privada RSA (PEM) do endpoint de dados do Flow.
   *
   * Aceita três formatos, nessa ordem de tentativa:
   *   1. PEM multi-linha, colado com quebras de linha reais.
   *   2. PEM em uma linha, com "\n" literal no lugar das quebras.
   *   3. O PEM inteiro codificado em base64, sem quebras.
   *
   * O formato 3 existe porque campos de texto (e IAs colando por engano)
   * tendem a corromper quebras de linha e espaços ao colar um PEM. Base64
   * não usa nenhum desses caracteres como parte do conteúdo, então é
   * impossível um campo de texto "quebrar" o valor — na pior das hipóteses
   * insere espaço em branco, que a gente remove antes de decodificar.
   */
  get flowPrivateKey() {
    const raw = required("FLOW_PRIVATE_KEY").trim();

    if (raw.includes("BEGIN")) {
      return raw.replace(/\\n/g, "\n");
    }

    const semEspacos = raw.replace(/\s+/g, "");
    return Buffer.from(semEspacos, "base64").toString("utf-8");
  },
  /** Passphrase da chave privada, se ela tiver sido gerada com uma. */
  get flowPrivateKeyPassphrase() {
    return optional("FLOW_PRIVATE_KEY_PASSPHRASE");
  },
  /** ID do Flow publicado, usado ao enviar a mensagem interativa. */
  get flowId() {
    return required("WHATSAPP_FLOW_ID");
  },
  get graphApiVersion() {
    return optional("GRAPH_API_VERSION", "v21.0");
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  /** Service role key — bypassa RLS, portanto só pode existir no servidor. */
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Senha simples para abrir /admin. */
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
};
