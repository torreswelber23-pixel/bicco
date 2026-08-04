"use client";

import { useState } from "react";
import type { Option } from "@/lib/catalog";

type Tela =
  | "servico"
  | "corrida"
  | "entrega"
  | "agendamento"
  | "enviando"
  | "resumo"
  | "erro";

interface Draft {
  nome: string;
  tipo_servico: "" | "corrida" | "entrega";
  origem: string;
  destino: string;
  endereco_coleta: string;
  endereco_entrega: string;
  item_descricao: string;
  destinatario_nome: string;
  destinatario_telefone: string;
  quando: "agora" | "agendado";
  data_preferida: string;
  horario_preferido: string;
}

const DRAFT_INICIAL: Draft = {
  nome: "",
  tipo_servico: "",
  origem: "",
  destino: "",
  endereco_coleta: "",
  endereco_entrega: "",
  item_descricao: "",
  destinatario_nome: "",
  destinatario_telefone: "",
  quando: "agora",
  data_preferida: "",
  horario_preferido: "",
};

export default function PedidoForm({
  token,
  datas,
  servicos,
}: {
  token: string;
  datas: Option[];
  servicos: Option[];
}) {
  const [tela, setTela] = useState<Tela>("servico");
  const [draft, setDraft] = useState<Draft>(DRAFT_INICIAL);
  const [horarios, setHorarios] = useState<Option[]>([]);
  const [erro, setErro] = useState("");
  const [resultado, setResultado] = useState<{ protocolo: string; resumo: string } | null>(
    null,
  );

  function atualizar(patch: Partial<Draft>) {
    setDraft((atual) => ({ ...atual, ...patch }));
  }

  async function carregarHorarios(data: string) {
    atualizar({ data_preferida: data, horario_preferido: "" });
    try {
      const resposta = await fetch(`/api/pedido/horarios?data=${data}`);
      const corpo = await resposta.json();
      setHorarios(corpo.horarios ?? []);
    } catch {
      setHorarios([]);
    }
  }

  async function enviar(dadosFinais: Draft) {
    setTela("enviando");
    setErro("");

    try {
      const resposta = await fetch("/api/pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...dadosFinais }),
      });

      const corpo = await resposta.json();

      if (!resposta.ok) {
        setErro(corpo.erro ?? "Não foi possível enviar o pedido.");
        setTela("erro");
        return;
      }

      setResultado(corpo);
      setTela("resumo");
    } catch {
      setErro("Falha de conexão. Tente de novo.");
      setTela("erro");
    }
  }

  if (tela === "servico") {
    return (
      <ServicoScreen
        servicos={servicos}
        nome={draft.nome}
        onContinuar={(nome, tipoServico) => {
          atualizar({ nome, tipo_servico: tipoServico });
          setTela(tipoServico);
        }}
      />
    );
  }

  if (tela === "corrida") {
    return (
      <CorridaScreen
        onVoltar={() => setTela("servico")}
        onContinuar={(campos) => {
          const novo = { ...draft, ...campos };
          setDraft(novo);
          if (campos.quando === "agendado") setTela("agendamento");
          else enviar(novo);
        }}
      />
    );
  }

  if (tela === "entrega") {
    return (
      <EntregaScreen
        onVoltar={() => setTela("servico")}
        onContinuar={(campos) => {
          const novo = { ...draft, ...campos };
          setDraft(novo);
          if (campos.quando === "agendado") setTela("agendamento");
          else enviar(novo);
        }}
      />
    );
  }

  if (tela === "agendamento") {
    return (
      <AgendamentoScreen
        datas={datas}
        horarios={horarios}
        dataSelecionada={draft.data_preferida}
        horarioSelecionado={draft.horario_preferido}
        onSelecionarData={carregarHorarios}
        onVoltar={() => setTela(draft.tipo_servico === "entrega" ? "entrega" : "corrida")}
        onEnviar={(horario) => enviar({ ...draft, horario_preferido: horario })}
      />
    );
  }

  if (tela === "enviando") {
    return (
      <main>
        <h1>Enviando...</h1>
      </main>
    );
  }

  if (tela === "erro") {
    return (
      <div className="card aviso erro">
        <p style={{ marginTop: 0 }}>{erro}</p>
        <button type="button" onClick={() => setTela("servico")}>
          Recomeçar
        </button>
      </div>
    );
  }

  return (
    <div className="card aviso ok">
      <h1 style={{ marginTop: 0 }}>Buscando alguém pra te atender</h1>
      <p>
        Protocolo <strong>{resultado?.protocolo}</strong>
      </p>
      <p className="sub" style={{ whiteSpace: "pre-line" }}>
        {resultado?.resumo}
      </p>
      <p>
        Assim que um motorista ou entregador aceitar, avisamos por aqui mesmo
        no WhatsApp. Pode fechar esta página.
      </p>
    </div>
  );
}

function ServicoScreen({
  servicos,
  nome,
  onContinuar,
}: {
  servicos: Option[];
  nome: string;
  onContinuar: (nome: string, tipoServico: "corrida" | "entrega") => void;
}) {
  const [nomeLocal, setNomeLocal] = useState(nome);
  const [tipo, setTipo] = useState<"corrida" | "entrega" | "">("");

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Pedir corrida ou entrega</h1>
      <label>
        Seu nome
        <input
          type="text"
          value={nomeLocal}
          onChange={(e) => setNomeLocal(e.target.value)}
          required
        />
      </label>

      <p className="sub" style={{ marginBottom: "0.5rem" }}>
        O que você precisa?
      </p>
      {servicos.map((servico) => (
        <label key={servico.id} className="opcao">
          <input
            type="radio"
            name="tipo_servico"
            value={servico.id}
            checked={tipo === servico.id}
            onChange={() => setTipo(servico.id as "corrida" | "entrega")}
          />
          {servico.title}
          {servico.description ? ` — ${servico.description}` : ""}
        </label>
      ))}

      <button
        type="button"
        disabled={!nomeLocal.trim() || !tipo}
        onClick={() => onContinuar(nomeLocal.trim(), tipo as "corrida" | "entrega")}
      >
        Continuar
      </button>
    </div>
  );
}

function CorridaScreen({
  onVoltar,
  onContinuar,
}: {
  onVoltar: () => void;
  onContinuar: (campos: { origem: string; destino: string; quando: "agora" | "agendado" }) => void;
}) {
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [quando, setQuando] = useState<"agora" | "agendado">("agora");

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Detalhes da corrida</h1>
      <label>
        Endereço de partida
        <input type="text" value={origem} onChange={(e) => setOrigem(e.target.value)} required />
      </label>
      <label>
        Endereço de destino
        <input type="text" value={destino} onChange={(e) => setDestino(e.target.value)} required />
      </label>
      <QuandoField quando={quando} onChange={setQuando} />
      <div className="acoes">
        <button type="button" className="botao secundario" onClick={onVoltar}>
          Voltar
        </button>
        <button
          type="button"
          disabled={!origem.trim() || !destino.trim()}
          onClick={() => onContinuar({ origem: origem.trim(), destino: destino.trim(), quando })}
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function EntregaScreen({
  onVoltar,
  onContinuar,
}: {
  onVoltar: () => void;
  onContinuar: (campos: {
    endereco_coleta: string;
    endereco_entrega: string;
    item_descricao: string;
    destinatario_nome: string;
    destinatario_telefone: string;
    quando: "agora" | "agendado";
  }) => void;
}) {
  const [coleta, setColeta] = useState("");
  const [entrega, setEntrega] = useState("");
  const [item, setItem] = useState("");
  const [destNome, setDestNome] = useState("");
  const [destTelefone, setDestTelefone] = useState("");
  const [quando, setQuando] = useState<"agora" | "agendado">("agora");

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Detalhes da entrega</h1>
      <label>
        Endereço de coleta
        <input type="text" value={coleta} onChange={(e) => setColeta(e.target.value)} required />
      </label>
      <label>
        Endereço de entrega
        <input type="text" value={entrega} onChange={(e) => setEntrega(e.target.value)} required />
      </label>
      <label>
        O que vai ser entregue?
        <textarea value={item} onChange={(e) => setItem(e.target.value)} required maxLength={300} />
      </label>
      <label>
        Nome de quem vai receber (opcional)
        <input type="text" value={destNome} onChange={(e) => setDestNome(e.target.value)} />
      </label>
      <label>
        Telefone de quem vai receber (opcional)
        <input type="tel" value={destTelefone} onChange={(e) => setDestTelefone(e.target.value)} />
      </label>
      <QuandoField quando={quando} onChange={setQuando} />
      <div className="acoes">
        <button type="button" className="botao secundario" onClick={onVoltar}>
          Voltar
        </button>
        <button
          type="button"
          disabled={!coleta.trim() || !entrega.trim() || !item.trim()}
          onClick={() =>
            onContinuar({
              endereco_coleta: coleta.trim(),
              endereco_entrega: entrega.trim(),
              item_descricao: item.trim(),
              destinatario_nome: destNome.trim(),
              destinatario_telefone: destTelefone.trim(),
              quando,
            })
          }
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

function QuandoField({
  quando,
  onChange,
}: {
  quando: "agora" | "agendado";
  onChange: (valor: "agora" | "agendado") => void;
}) {
  return (
    <>
      <p className="sub" style={{ marginBottom: "0.5rem" }}>
        Quando?
      </p>
      <label className="opcao">
        <input
          type="radio"
          name="quando"
          checked={quando === "agora"}
          onChange={() => onChange("agora")}
        />
        Agora
      </label>
      <label className="opcao">
        <input
          type="radio"
          name="quando"
          checked={quando === "agendado"}
          onChange={() => onChange("agendado")}
        />
        Agendar para depois
      </label>
    </>
  );
}

function AgendamentoScreen({
  datas,
  horarios,
  dataSelecionada,
  horarioSelecionado,
  onSelecionarData,
  onVoltar,
  onEnviar,
}: {
  datas: Option[];
  horarios: Option[];
  dataSelecionada: string;
  horarioSelecionado: string;
  onSelecionarData: (data: string) => void;
  onVoltar: () => void;
  onEnviar: (horario: string) => void;
}) {
  const [horario, setHorario] = useState(horarioSelecionado);

  return (
    <div className="card">
      <h1 style={{ marginTop: 0 }}>Melhor horário</h1>
      <label>
        Dia
        <select value={dataSelecionada} onChange={(e) => onSelecionarData(e.target.value)}>
          <option value="" disabled>
            Escolha o dia
          </option>
          {datas.map((data) => (
            <option key={data.id} value={data.id}>
              {data.title}
            </option>
          ))}
        </select>
      </label>

      {dataSelecionada && (
        <>
          <p className="sub" style={{ marginBottom: "0.5rem" }}>
            Horário
          </p>
          {horarios.map((h) => (
            <label key={h.id} className="opcao">
              <input
                type="radio"
                name="horario"
                disabled={h.enabled === false}
                checked={horario === h.id}
                onChange={() => setHorario(h.id)}
              />
              {h.title}
            </label>
          ))}
        </>
      )}

      <div className="acoes">
        <button type="button" className="botao secundario" onClick={onVoltar}>
          Voltar
        </button>
        <button type="button" disabled={!dataSelecionada || !horario} onClick={() => onEnviar(horario)}>
          Enviar pedido
        </button>
      </div>
    </div>
  );
}
