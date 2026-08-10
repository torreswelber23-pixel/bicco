export default function Home() {
  return (
    <main>
      <h1>Bicco · API do WhatsApp Cloud API</h1>
      <p className="sub">
        Uma API sobre um número de WhatsApp conectado. Sem resposta
        automática: quando chega mensagem, ela só é gravada e disparada como
        evento pra sua plataforma — quem decide o que responder é você, pela
        API.
      </p>

      <h2>Endpoints</h2>
      <div className="card">
        <strong>Webhook (recebimento)</strong>
        <br />
        <code>/api/whatsapp/webhook</code> — recebe as mensagens da Meta,
        grava e dispara o evento <code>message.received</code>. Cadastre esta
        URL em Configuration → Webhooks, no app da Meta.
      </div>
      <div className="card">
        <strong>API</strong>
        <br />
        <code>/api/v1</code> — enviar qualquer tipo de mensagem (texto,
        mídia, botões, lista, template...), ler conversas e assinar eventos
        por webhook. Autenticação por chave; referência completa em{" "}
        <code>docs/API.md</code>.
      </div>
      <div className="card">
        <strong>Painel</strong>
        <br />
        <code>/admin</code> — conexão com a Meta, chaves de API e webhooks
        cadastrados.
      </div>

      <h2>Configuração</h2>
      <p className="sub">
        O passo a passo completo (app na Meta, conexão OAuth, webhook) está em{" "}
        <code>docs/SETUP.md</code> no repositório.
      </p>
    </main>
  );
}
