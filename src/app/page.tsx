export default function Home() {
  return (
    <main>
      <h1>Bicco · corrida e entrega sob demanda pelo WhatsApp</h1>
      <p className="sub">
        Quem manda mensagem responde uma conversa curta — lista pra escolher
        corrida ou entrega, localização pra endereços — sem sair do WhatsApp.
        O pedido é oferecido na hora aos motoristas e entregadores
        disponíveis.
      </p>

      <h2>Endpoints</h2>
      <div className="card">
        <strong>Webhook</strong>
        <br />
        <code>/api/whatsapp/webhook</code> — recebe as mensagens, conduz a
        conversa do pedido e trata as respostas dos motoristas. Cadastre esta
        URL em Configuration → Webhooks.
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
