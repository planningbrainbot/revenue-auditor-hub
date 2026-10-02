import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronRight, Eye, KeyRound, Mail, Pencil, Phone, TriangleAlert } from "lucide-react";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
  Procedencia,
  Secao,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UnidadeDialog } from "@/components/unidades/unidade-dialog";
import {
  fichaDaUnidade,
  type FichaDaUnidade,
  type PessoaDaUnidade,
} from "@/lib/unidade-ficha.functions";
import { revealOmieSecret } from "@/lib/omie-credentials.functions";
import {
  pendenciasDaUnidade,
  statusDaUnidade,
  tempoDeCasa,
  type StatusUnidade,
} from "@/lib/unidades-cadastro";
import { haQuanto } from "@/lib/pessoas-situacao";

/**
 * Ficha da unidade: cadastro, regra de repasse, sócios e acessos, sistemas e
 * chaves, num lugar só. Substitui a tabela de Regras da Rede, que mostrava a
 * regra numa linha, os sócios numa linha expandida, e deixava o login em
 * /admin/usuarios e a chave do Omie em /admin/integracoes (01/10/2026).
 *
 * O que cada pessoa vê é decidido no servidor (`fichaDaUnidade`): a matriz abre
 * qualquer unidade, o sócio só a dele, e as chaves só o super admin. Arquétipo
 * Ficha (docs/design/ARQUETIPOS.md §4).
 */
export const Route = createFileRoute("/_authenticated/unidades/$unidadeId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Unidade – Planning" }] }),
  component: FichaUnidadePage,
});

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtData = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const ROTULO_STATUS: Record<StatusUnidade, string> = {
  ativa: "Ativa",
  futura: "Futura",
  interna: "Interna",
};
const TOM_STATUS: Record<StatusUnidade, TomStatus> = {
  ativa: "sucesso",
  futura: "info",
  interna: "neutro",
};

function FichaUnidadePage() {
  const { unidadeId } = Route.useParams();
  const id = Number(unidadeId);
  const fichaFn = useServerFn(fichaDaUnidade);
  const q = useQuery({
    queryKey: ["ficha-unidade", id],
    queryFn: () => fichaFn({ data: { id } }),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      {q.data?.pode.rede && (
        <nav
          aria-label="Trilha"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <span>Administração</span>
          <ChevronRight className="size-3.5" aria-hidden />
          <Link to="/unidades" className="hover:text-foreground hover:underline">
            Unidades
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-foreground">{q.data.unidade.nome_da_praca ?? "Unidade"}</span>
        </nav>
      )}
      {q.isLoading ? (
        <Carregando variante="pagina" />
      ) : q.isError || !q.data ? (
        <EstadoErro
          titulo="Não foi possível abrir a ficha desta unidade"
          detalhe={(q.error as Error)?.message ?? "Unidade inválida."}
          tentarNovamente={() => q.refetch()}
        />
      ) : (
        <Ficha f={q.data} atualizadoEm={new Date(q.dataUpdatedAt)} />
      )}
    </div>
  );
}

function Ficha({ f, atualizadoEm }: { f: FichaDaUnidade; atualizadoEm: Date }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const u = f.unidade;
  const nome = u.nome_da_praca ?? "Unidade";
  const status = statusDaUnidade(u);
  // Só edita quem recebeu a linha inteira: o servidor apaga regra e vínculos de
  // quem não os vê, e o diálogo gravaria esses vazios por cima do cadastro.
  const podeEditar = f.pode.cadastrar && f.pode.financeiro && f.pode.sistemas;
  const pendencias = podeEditar ? pendenciasDaUnidade(u, f.csc ? f.csc.noFaturamento : null) : [];
  const socios = f.pessoas.filter((p) => p.socioId != null);
  const sociosComLogin = socios.filter((p) => p.conta?.ativo).length;

  return (
    <>
      <PageHeader
        area={f.pode.rede ? "admin" : "minha_unidade"}
        titulo={nome}
        pergunta={`O que é preciso saber sobre ${nome}?`}
        descricao={[
          u.razao_social?.split("\n")[0],
          u.tipo === "interna" ? "unidade interna" : "unidade regional",
        ]
          .filter(Boolean)
          .join(" · ")}
        acoes={
          <>
            <StatusBadge tom={TOM_STATUS[status]}>{ROTULO_STATUS[status]}</StatusBadge>
            {podeEditar && (
              <Button onClick={() => setEditando(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Editar
              </Button>
            )}
          </>
        }
      />

      {pendencias.length > 0 && (
        <Secao titulo="O que falta no cadastro?" descricao="Cada item diz o efeito de não ter.">
          <ul className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm">
            {pendencias.map((p) => (
              <li key={p.chave} className="flex items-start gap-2 text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {p.texto}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Tempo de casa"
          valor={tempoDeCasa(u.data_inauguracao)}
          nota={`Inauguração ${fmtData(u.data_inauguracao)}`}
        />
        {f.pode.financeiro && (
          <KpiCard
            rotulo="Royalties"
            valor={
              u.royalties_percentual != null
                ? `${String(u.royalties_percentual).replace(".", ",")}%`
                : "—"
            }
            nota="Percentual vigente hoje"
          />
        )}
        {f.pode.financeiro && (
          <KpiCard rotulo="CSC" valor={cscTexto(u)} nota="Regra vigente hoje" />
        )}
        <KpiCard
          rotulo="Sócios"
          valor={socios.length}
          nota={`${sociosComLogin} com login no Ops`}
        />
      </KpiGrade>

      <Secao titulo="Quem é a unidade no papel?">
        <Campos>
          <CampoFicha rotulo="Razão social" valor={u.razao_social} multilinha />
          <CampoFicha
            rotulo={u.cnpj?.includes("\n") ? "CNPJs" : "CNPJ"}
            valor={u.cnpj}
            multilinha
          />
          <CampoFicha
            rotulo="Tipo"
            valor={u.tipo === "interna" ? "Interna (matriz e áreas)" : "Regional"}
          />
          <CampoFicha rotulo="Inauguração" valor={fmtData(u.data_inauguracao)} />
          <CampoFicha
            rotulo="E-mail do DP"
            valor={f.emailDp}
            ajuda="Para onde o Gente manda as movimentações de salário, cargo e setor."
          />
        </Campos>
      </Secao>

      {f.pode.financeiro && <SecaoRepasse f={f} />}

      <SecaoPessoas f={f} />

      {f.pode.sistemas && <SecaoSistemas f={f} />}

      <Procedencia
        fonte="Cadastro de unidades, sócios, contas do Ops, Gente e Omie (Supabase)"
        atualizadoEm={atualizadoEm}
        regua="cadastro vigente hoje"
      />

      {podeEditar && (
        <UnidadeDialog
          aberto={editando}
          aoMudarAberto={setEditando}
          unidade={u}
          noFaturamentoDoCsc={f.csc ? f.csc.noFaturamento : null}
          podeEditarCsc={f.pode.editarCsc}
          aoSalvar={() => {
            qc.invalidateQueries({ queryKey: ["ficha-unidade", u.id] });
            qc.invalidateQueries({ queryKey: ["unidades-lista"] });
          }}
        />
      )}
    </>
  );
}

function cscTexto(u: FichaDaUnidade["unidade"]): string {
  if (u.csc_valor_fixo != null) return `${fmtBRL(u.csc_valor_fixo)} fixo`;
  if (u.csc_percentual_base_antiga != null) return `${u.csc_percentual_base_antiga}% base antiga`;
  return "—";
}

function SecaoRepasse({ f }: { f: FichaDaUnidade }) {
  const u = f.unidade;
  const csc = f.csc?.registro;
  return (
    <Secao
      titulo="Qual é a regra de repasse?"
      descricao="A regra vigente hoje. A apuração de cada mês usa a regra que valia naquele mês."
      acoes={
        f.pode.rede ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/unidades/royalties">Apuração de Royalties</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/unidades/funil-cac">Funil de CAC</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/unidades/split">Split do Asaas</Link>
            </Button>
          </div>
        ) : undefined
      }
    >
      <Campos>
        <CampoFicha
          rotulo="Royalties"
          valor={
            u.royalties_percentual != null
              ? `${String(u.royalties_percentual).replace(".", ",")}%`
              : null
          }
        />
        <CampoFicha rotulo="CSC" valor={cscTexto(u)} />
        <CampoFicha
          rotulo="Mídia mensal"
          valor={u.midia_cac ? "Mídia é o CAC" : fmtBRL(u.midia_mensal)}
        />
        <CampoFicha rotulo="Absorve mídia" valor={u.absorve_midia ? "Sim" : "Não"} />
        <CampoFicha
          rotulo="CAC"
          valor={
            u.paga_cac ? (u.cac_desde ? `Paga desde ${fmtData(u.cac_desde)}` : "Paga") : "Não paga"
          }
        />
        {u.cac_honorario_minimo_mensal != null && (
          <CampoFicha
            rotulo="Honorário mínimo do CAC"
            valor={fmtBRL(u.cac_honorario_minimo_mensal)}
          />
        )}
        <CampoFicha
          rotulo="Split do Asaas"
          valor={u.split_ativo_desde ? `Ativo desde ${fmtData(u.split_ativo_desde)}` : "Não usa"}
        />
        <CampoFicha
          rotulo="Faturamento do CSC"
          valor={
            f.csc == null
              ? null
              : csc
                ? [
                    csc.sigla ? `Sigla ${csc.sigla}` : null,
                    csc.automatico ? "emissão automática" : "emissão manual",
                    csc.ativo ? null : "desligado",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Fora de Emitir faturas"
          }
        />
        {csc && csc.emails.length > 0 && (
          <CampoFicha rotulo="E-mails da fatura" valor={csc.emails.join("\n")} multilinha />
        )}
        {u.observacoes_financeiras && (
          <CampoFicha
            rotulo="Observações financeiras"
            valor={u.observacoes_financeiras}
            multilinha
            largo
          />
        )}
      </Campos>
    </Secao>
  );
}

function situacaoDoLogin(p: PessoaDaUnidade): { tom: TomStatus; texto: string } {
  if (!p.conta) return { tom: "neutro", texto: "Sem login" };
  if (!p.conta.ativo) return { tom: "perigo", texto: "Desativado" };
  if (p.conta.senhaProvisoria) return { tom: "atencao", texto: "Senha provisória" };
  if (!p.conta.ultimoLogin) return { tom: "atencao", texto: "Nunca entrou" };
  return { tom: "sucesso", texto: "Entra no Ops" };
}

function SecaoPessoas({ f }: { f: FichaDaUnidade }) {
  // Sócio é quem está no cadastro de sócios da unidade. Equipe é quem entra no
  // Ops com acesso só a esta unidade sem ser sócio, como a Gente de Maceió
  // (pedido do Eliezek em 02/10/2026: "tem que diferenciar sócios e equipe").
  const socios = f.pessoas.filter((p) => p.socioId != null);
  const equipe = f.pessoas.filter((p) => p.socioId == null);
  return (
    <>
      <Secao
        titulo="Quem são os sócios?"
        descricao="O cadastro de sócios da unidade e o login de cada um."
      >
        {socios.length === 0 ? (
          <EstadoVazio titulo="Nenhum sócio cadastrado para esta unidade" />
        ) : (
          <TabelaPessoas pessoas={socios} abreFichaDaPessoa={f.pode.chaves} rotuloPessoa="Sócio" />
        )}
      </Secao>
      <Secao
        titulo="Quem mais da unidade entra no Ops?"
        descricao="A equipe com acesso a esta unidade, fora do cadastro de sócios. A equipe da matriz, que vê a rede inteira, fica de fora."
      >
        {equipe.length === 0 ? (
          <EstadoVazio titulo="Ninguém da equipe da unidade tem acesso ao Ops" />
        ) : (
          <TabelaPessoas pessoas={equipe} abreFichaDaPessoa={f.pode.chaves} rotuloPessoa="Equipe" />
        )}
      </Secao>
    </>
  );
}

function TabelaPessoas({
  pessoas,
  abreFichaDaPessoa,
  rotuloPessoa,
}: {
  pessoas: PessoaDaUnidade[];
  /** Quem abre a ficha da pessoa é o super admin, o mesmo que vê as chaves. */
  abreFichaDaPessoa: boolean;
  rotuloPessoa: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{rotuloPessoa}</TableHead>
            <TableHead>Contato</TableHead>
            <TableHead>Perfil no Ops</TableHead>
            <TableHead>Login</TableHead>
            <TableHead>Último acesso</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pessoas.map((p) => {
            const s = situacaoDoLogin(p);
            return (
              <TableRow key={p.socioId ?? p.userId}>
                <TableCell>
                  <div className="font-medium">
                    {abreFichaDaPessoa && p.userId && p.conta ? (
                      <Link
                        to="/admin/usuarios/$userId"
                        params={{ userId: p.userId }}
                        className="hover:underline"
                      >
                        {p.nome}
                      </Link>
                    ) : (
                      p.nome
                    )}
                  </div>
                  {p.cargo && <div className="text-xs text-muted-foreground">{p.cargo}</div>}
                </TableCell>
                <TableCell className="space-y-1 text-xs">
                  {p.email && (
                    <a
                      href={`mailto:${p.email}`}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <Mail className="h-3 w-3" aria-hidden /> {p.email}
                    </a>
                  )}
                  {p.telefone && (
                    <a
                      href={`tel:${p.telefone.replace(/\D/g, "")}`}
                      className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <Phone className="h-3 w-3" aria-hidden /> {p.telefone}
                    </a>
                  )}
                  {!p.email && !p.telefone && (
                    <span className="text-muted-foreground">Sem contato</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {p.conta?.papeis.length ? p.conta.papeis.join(" + ") : "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge tom={s.tom}>{s.texto}</StatusBadge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.conta ? haQuanto(p.conta.ultimoLogin) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SecaoSistemas({ f }: { f: FichaDaUnidade }) {
  const u = f.unidade;
  return (
    <Secao
      titulo="Como a unidade aparece nos outros sistemas?"
      descricao="Os vínculos que os syncs usam para pôr contrato, cliente e fatura na unidade certa."
    >
      <Campos>
        <CampoFicha
          rotulo="Pipedrive (opção de Unidade de Negócio)"
          valor={u.pipedrive_opcao_id != null ? String(u.pipedrive_opcao_id) : null}
        />
        <CampoFicha rotulo="Pipefy (base de Unidades)" valor={u.pipefy_id} />
        <CampoFicha rotulo="Omie da Partners (cliente)" valor={u.id_omie} />
        <CampoFicha rotulo="Asaas (cliente)" valor={u.id_asaas} />
        {u.asaas_account_id && (
          <CampoFicha rotulo="Asaas (conta da unidade)" valor={u.asaas_account_id} />
        )}
      </Campos>

      <div className="mt-4">
        {f.chavesOmie == null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="h-4 w-4" aria-hidden />
            As chaves de acesso do Omie aparecem só para o super admin.
          </p>
        ) : (
          <ChavesOmie chaves={f.chavesOmie} />
        )}
      </div>
    </Secao>
  );
}

function ChavesOmie({ chaves }: { chaves: NonNullable<FichaDaUnidade["chavesOmie"]> }) {
  const revelarFn = useServerFn(revealOmieSecret);
  const [reveladas, setReveladas] = useState<Record<string, string>>({});
  const revelar = useMutation({
    mutationFn: (id: string) =>
      revelarFn({ data: { id } }).then((r) => ({ id, secret: r.app_secret })),
    onSuccess: ({ id, secret }) => setReveladas((v) => ({ ...v, [id]: secret })),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível revelar o APP_SECRET."),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4" aria-hidden />
          Chaves de acesso do Omie da unidade
        </h3>
        <Button asChild variant="link" size="sm">
          <Link to="/admin/integracoes">Gerenciar em Integrações</Link>
        </Button>
      </div>
      {chaves.length === 0 ? (
        <EstadoVazio titulo="Nenhum aplicativo do Omie ligado a esta unidade" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aplicativo</TableHead>
                <TableHead>APP_KEY</TableHead>
                <TableHead>APP_SECRET</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Atualizada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chaves.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.aplicativo}</TableCell>
                  <TableCell className="font-mono text-xs">{c.appKey}</TableCell>
                  <TableCell className="font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <span className="break-all">{reveladas[c.id] ?? c.appSecretMascarado}</span>
                      {!reveladas[c.id] && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={revelar.isPending}
                          onClick={() => revelar.mutate(c.id)}
                          aria-label={`Revelar o APP_SECRET de ${c.aplicativo}`}
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                          Revelar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.ativo ? (
                      <StatusBadge tom="sucesso">Ativa</StatusBadge>
                    ) : (
                      <StatusBadge tom="neutro">Desligada</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtData(c.atualizadoEm)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Campos({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </dl>
  );
}

function CampoFicha({
  rotulo,
  valor,
  ajuda,
  multilinha,
  largo,
}: {
  rotulo: string;
  valor: string | null | undefined;
  ajuda?: string;
  multilinha?: boolean;
  largo?: boolean;
}) {
  return (
    <div className={largo ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </dt>
      <dd
        className={`mt-1 text-sm ${multilinha ? "whitespace-pre-line" : ""} ${valor ? "text-foreground" : "text-muted-foreground"}`}
      >
        {valor || "Não preenchido"}
      </dd>
      {ajuda && <p className="mt-0.5 text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );
}
