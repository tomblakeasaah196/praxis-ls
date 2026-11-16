/**
 * `/privacy` and `/terms` — the two public legal pages.
 *
 * Outside RequireAuth and outside AppShell, like `/v` and `/s`: the reader is
 * a stranger (a Google reviewer, a prospect, someone deciding whether to
 * connect their mailbox) with no account, and the shell would fire
 * authenticated requests on mount. The text lives in `legal-content.ts`,
 * which says why it is data and why it is English-only.
 *
 * Deliberately plain: no tenant branding, because these documents are JBS
 * Praxis's own, served on every host — the same policy covers every tenant.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { PRIVACY, TERMS, type LegalBlock, type LegalDoc } from "./legal-content";

/**
 * Turn the email addresses and https URLs inside a paragraph into links.
 *
 * The content file is plain strings so it stays readable as a document; the
 * one thing a legal page must do that plain text cannot is let the reader
 * reach the contact address and the policies it cites.
 */
const LINKABLE = /(https:\/\/[^\s)]+[^\s).,;]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function Linked({ text }: { text: string }) {
  const parts = text.split(LINKABLE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <React.Fragment key={i}>{part}</React.Fragment>;
        const href = part.startsWith("https://") ? part : `mailto:${part}`;
        const external = href.startsWith("https://");
        return (
          <a
            key={i}
            href={href}
            className="break-words text-primary-ink underline underline-offset-2"
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (Array.isArray(block)) {
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {block.map((item, i) => (
          <li key={i}>
            <Linked text={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p>
      <Linked text={block} />
    </p>
  );
}

function LegalDocument({ doc, other }: { doc: LegalDoc; other: { to: string; label: string } }) {
  React.useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title} · Praxis LS`;
    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 border-b border-border pb-6">
          <p className="text-sm font-medium text-muted-foreground">Praxis LS</p>
          <h1 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">{doc.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated {doc.updated}</p>
        </header>

        <div className="space-y-4 text-sm leading-relaxed sm:text-base">
          {doc.intro.map((b, i) => (
            <Block key={i} block={b} />
          ))}
        </div>

        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-8">
            <h2 className="mb-3 font-display text-lg font-semibold">{s.heading}</h2>
            <div className="space-y-3 text-sm leading-relaxed sm:text-base">
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
          </section>
        ))}

        <footer className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground">
          <Link to={other.to} className="text-primary-ink underline underline-offset-2">
            {other.label}
          </Link>
          <Link to="/login" className="text-primary-ink underline underline-offset-2">
            Sign In
          </Link>
          <span>© 2026 JBS PRAXIS LIMITED</span>
        </footer>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} other={{ to: "/terms", label: "Terms of Service" }} />;
}

export function TermsPage() {
  return <LegalDocument doc={TERMS} other={{ to: "/privacy", label: "Privacy Policy" }} />;
}
