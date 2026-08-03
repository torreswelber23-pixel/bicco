export default function Home() {
  return (
    <main>
      <h1>Bicco · atendimento automatizado no WhatsApp</h1>
      <p className="sub">
        Quem manda mensagem recebe um formulário nativo do WhatsApp (Flow),
        responde três telas e vira uma demanda estruturada no banco.
      </p>

      <h2>Endpoints</h2>
      <div className="card">
        <strong>Webhook</strong>
        <br />
        <code>/api/whatsapp/webhook</code> — recebe as mensagens e dispara o
        Flow. Cadastre esta URL em Configuration → Webhooks.
      </div>
      <div className="card">
        <strong>Endpoint de dados do Flow</strong>
        <br />
        <code>/api/whatsapp/flow</code> — alimenta as telas e grava a demanda.
        Cadastre esta URL no Flow Builder, campo &ldquo;Endpoint URI&rdquo;.
      </div>
      <div className="card">
        <strong>Painel</strong>
        <br />
        <code>/admin</code> — demandas captadas, mais recentes primeiro.
      </div>

      <h2>Configuração</h2>
      <p className="sub">
        O passo a passo completo (app na Meta, chaves, publicação do Flow) está
        em <code>docs/SETUP.md</code> no repositório.
      </p>
    </main>
  );
}
