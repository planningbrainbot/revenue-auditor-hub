import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Security — Planning Opsboard" },
      {
        name: "description",
        content:
          "How Planning Opsboard handles authentication, data access, retention, subprocessors, and privacy requests.",
      },
      { property: "og:title", content: "Trust & Security — Planning Opsboard" },
      {
        property: "og:description",
        content:
          "Security and privacy practices for Planning Opsboard, including access controls, data handling, and how to contact us.",
      },
    ],
  }),
  component: TrustPage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function TrustPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Trust Center
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Security & Privacy</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This page is maintained by Planning Opsboard to answer common security and privacy
          questions about the application. It describes current, app-visible controls and is not
          an independent certification.
        </p>
      </header>

      <div className="space-y-10">
        <Section title="Access & authentication">
          <p>
            Access requires an authenticated account. Sessions are managed by our authentication
            provider; all protected routes verify a valid session on every request.
          </p>
          <p>
            Permissions are enforced server-side through role-based access control. Roles are
            stored in a dedicated table and checked through a security-definer function so a user
            cannot grant themselves elevated privileges from the client.
          </p>
        </Section>

        <Section title="Platform & hosting">
          <p>
            The application is hosted on Vercel and backed by a managed Postgres database on
            Supabase. Row Level Security is enabled on user-data tables and scoped to the
            signed-in user or their assigned role.
          </p>
        </Section>

        <Section title="Data collection & use">
          <p>
            We store the operational data required to run the product: organization records,
            contracts, receivables, expenses, and the profile information you provide. Data is
            used only to operate the features you see in the app and to support your account.
          </p>
          <p>
            Sensitive partner identifiers (such as tax IDs) are restricted to administrators and
            directors and are never exposed to auditor-role accounts.
          </p>
        </Section>

        <Section title="Subprocessors & integrations">
          <p>
            We rely on Vercel (application hosting) and Supabase (database, authentication, file
            storage), and may integrate with third-party systems you connect (for example,
            Pipedrive, Pipefy, Omie). Data sent to a connected system is governed by that
            provider's terms.
          </p>
        </Section>

        <Section title="Retention & deletion">
          <p>
            Operational records are retained while your account is active. To request export or
            deletion of your data, contact us at the address below.
          </p>
        </Section>

        <Section title="Privacy requests & contact">
          <p>
            For privacy requests, security questions, or to report a vulnerability, contact the
            project owner through your usual Planning Opsboard channel. Please include enough
            detail for us to reproduce or act on the request.
          </p>
        </Section>

        <Section title="Changes to this page">
          <p>
            This page is editable content owned by Planning Opsboard and may be updated as the
            product evolves. Check back for the latest information.
          </p>
        </Section>
      </div>

      <footer className="mt-12 border-t border-border pt-6 text-sm">
        <Link to="/" className="text-primary-text hover:underline">
          ← Back to app
        </Link>
      </footer>
    </main>
  );
}
