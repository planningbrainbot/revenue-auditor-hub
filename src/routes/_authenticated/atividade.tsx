import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { GitCommit, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

const TYPE_LABEL: Record<string, { label: string; tone: string }> = {
  feat: {
    label: "feature",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  fix: { label: "correção", tone: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300" },
  chore: {
    label: "manutenção",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  refactor: {
    label: "refatoração",
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  },
  docs: {
    label: "docs",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  style: {
    label: "estilo",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  perf: {
    label: "performance",
    tone: "bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
  },
  test: {
    label: "teste",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
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
      subtitle="O que mudou no Ops Board, dia a dia — direto do histórico de commits"
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
        {error && (
          <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </Card>
        )}

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum commit encontrado.
          </Card>
        )}

        {!loading &&
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
                    className="flex items-start gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50"
                  >
                    <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="break-words text-foreground">{c.subject}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.type && TYPE_LABEL[c.type] && (
                        <Badge
                          variant="secondary"
                          className={`${TYPE_LABEL[c.type].tone} border-0`}
                        >
                          {TYPE_LABEL[c.type].label}
                        </Badge>
                      )}
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {timeLabel(c.date)}
                      </span>
                    </div>
                  </a>
                ))}
              </Card>
            </div>
          ))}
      </div>
    </AppShell>
  );
}
