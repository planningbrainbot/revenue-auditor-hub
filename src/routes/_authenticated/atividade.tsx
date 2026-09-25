import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { GitCommit, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Carregando, EstadoErro, EstadoVazio, StatusBadge } from "@/components/planning";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/atividade")({
  head: () => ({ meta: [{ title: "Atividade do Sistema – Planning" }] }),
  component: AtividadePage,
});

const REPO = "victoreliezek/revenue-auditor-hub";
const PAGE_SIZE = 100;
const MAX_PAGES = 5; // ~500 commits — cobre bem mais que os últimos dias de trabalho

type GithubCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string; avatar_url: string } | null;
};

type ParsedCommit = {
  sha: string;
  url: string;
  date: Date;
  subject: string;
  type: string | null;
  authorName: string;
};

// Prefixo "feat:", "fix:", "chore(escopo):" etc. — convenção conventional commits usada no repo
const CONVENTIONAL_RE = /^([a-z]+)(\([^)]+\))?:\s*(.+)$/i;

// Tipo do commit é categoria, não status: vai em StatusBadge neutro, sem ícone.
const TYPE_LABEL: Record<string, string> = {
  feat: "feature",
  fix: "correção",
  chore: "manutenção",
  refactor: "refatoração",
  docs: "docs",
  style: "estilo",
  perf: "performance",
  test: "teste",
};

function parseCommit(c: GithubCommit): ParsedCommit {
  const rawSubject = c.commit.message.split("\n")[0].trim();
  const match = rawSubject.match(CONVENTIONAL_RE);
  const type = match ? match[1].toLowerCase() : null;
  const subject = match ? match[3] : rawSubject;
  const dateStr = c.commit.author?.date;
  return {
    sha: c.sha,
    url: c.html_url,
    date: dateStr ? new Date(dateStr) : new Date(0),
    subject,
    type,
    authorName: c.commit.author?.name ?? c.author?.login ?? "—",
  };
}

function dayKey(d: Date) {
  // agrupa no fuso America/Sao_Paulo
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // sv-SE => YYYY-MM-DD
}

function dayLabel(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const formatted = dt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
  if (key === today) return `Hoje — ${formatted}`;
  if (key === yesterday) return `Ontem — ${formatted}`;
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function timeLabel(d: Date) {
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchAllCommits(): Promise<GithubCommit[]> {
  const all: GithubCommit[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) {
      if (res.status === 403)
        throw new Error(
          "Limite de requisições da API do GitHub atingido — tente novamente em alguns minutos.",
        );
      throw new Error(`Erro ao buscar commits (HTTP ${res.status}).`);
    }
    const batch = (await res.json()) as GithubCommit[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return all;
}

function AtividadePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commits, setCommits] = useState<ParsedCommit[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchAllCommits()
      .then((raw) => {
        if (!alive) return;
        setCommits(raw.map(parseCommit).sort((a, b) => b.date.getTime() - a.date.getTime()));
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Erro desconhecido.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const groups = useMemo(() => {
    const map = new Map<string, ParsedCommit[]>();
    for (const c of commits) {
      const key = dayKey(c.date);
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [commits]);

  return (
    <AppShell
      title="Atividade do Sistema"
      pergunta="O que mudou no sistema, e quem mudou?"
      subtitle={
        <>
          {!loading && !error
            ? `${commits.length} ${commits.length === 1 ? "commit" : "commits"} em ${groups.length} ${groups.length === 1 ? "dia" : "dias"} · `
            : ""}
          Histórico de commits do repositório {REPO} no GitHub (até {PAGE_SIZE * MAX_PAGES} mais
          recentes), agrupado por dia no horário de Brasília. Só leitura: nada aqui muda o sistema.
        </>
      }
      headerExtra={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      }
    >
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {loading ? (
          <Carregando variante="tabela" />
        ) : error ? (
          <EstadoErro
            titulo="Não foi possível carregar o histórico de commits"
            detalhe={error}
            tentarNovamente={() => setReloadKey((k) => k + 1)}
          />
        ) : groups.length === 0 ? (
          <EstadoVazio titulo="Nenhum commit encontrado" />
        ) : (
          groups.map(([key, items]) => (
            <div key={key}>
              <h2 className="mb-2 text-sm font-semibold text-foreground">{dayLabel(key)}</h2>
              <Card className="divide-y overflow-hidden">
                {items.map((c) => (
                  <a
                    key={c.sha}
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 px-4 py-2.5 text-sm transition-colors duration-120 ease-planning hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <GitCommit className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="break-words text-foreground">{c.subject}</span>
                      <span className="block text-xs text-muted-foreground">{c.authorName}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.type && TYPE_LABEL[c.type] && (
                        <StatusBadge tom="neutro" icone={false}>
                          {TYPE_LABEL[c.type]}
                        </StatusBadge>
                      )}
                      <span className="num whitespace-nowrap text-xs text-muted-foreground">
                        {timeLabel(c.date)}
                      </span>
                    </div>
                  </a>
                ))}
              </Card>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}
