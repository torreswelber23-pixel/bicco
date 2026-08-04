export default function Home() {
  return (
    <main>
      <h1>Bicco · corrida e entrega sob demanda pelo WhatsApp</h1>
      <p className="sub">
        Quem manda mensagem recebe um botão que abre, dentro do próprio
        WhatsApp, uma página pra pedir uma corrida ou uma entrega. O pedido é
        oferecido na hora aos motoristas e entregadores disponíveis.
      </p>

      <h2>Endpoints</h2>
      <div className="card">
        <strong>Webhook</strong>
        <br />
        <code>/api/whatsapp/webhook</code> — recebe as mensagens, manda o link
        do pedido e trata as respostas dos motoristas. Cadastre esta URL em
        Configuration → Webhooks.
      </div>
      <div className="card">
        <strong>Formulário de pedido</strong>
        <br />
        <code>/pedido</code> — página que o cliente abre pelo botão do
        WhatsApp; escolhe corrida ou entrega e envia.
      </div>
      <div className="card">
        <strong>Painel</strong>
        <br />
        <code>/admin</code> — pedidos e motoristas cadastrados.
      </div>

      <h2>Configuração</h2>
      <p className="sub">
        O passo a passo completo (app na Meta, conexão OAuth, webhook) está em{" "}
        <code>docs/SETUP.md</code> no repositório.
      </p>
    </main>
  );
}
