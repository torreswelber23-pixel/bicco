export default function Home() {
  return (
    <main>
      <h1>Bicco · corrida e entrega sob demanda pelo WhatsApp</h1>
      <p className="sub">
        Quem manda mensagem recebe um formulário nativo do WhatsApp (Flow) pra
        pedir uma corrida ou uma entrega, e o pedido é oferecido na hora aos
        motoristas e entregadores disponíveis.
      </p>

      <h2>Endpoints</h2>
      <div className="card">
        <strong>Webhook</strong>
        <br />
        <code>/api/whatsapp/webhook</code> — recebe as mensagens, dispara o
        Flow e trata as respostas dos motoristas. Cadastre esta URL em
        Configuration → Webhooks.
      </div>
      <div className="card">
        <strong>Endpoint de dados do Flow</strong>
        <br />
        <code>/api/whatsapp/flow</code> — alimenta as telas e grava o pedido.
        Cadastre esta URL no Flow Builder, campo &ldquo;Endpoint URI&rdquo;.
      </div>
      <div className="card">
        <strong>Painel</strong>
        <br />
        <code>/admin</code> — pedidos e motoristas cadastrados.
      </div>

      <h2>Configuração</h2>
      <p className="sub">
        O passo a passo completo (app na Meta, chaves, publicação do Flow) está
        em <code>docs/SETUP.md</code> no repositório.
      </p>
    </main>
  );
}
