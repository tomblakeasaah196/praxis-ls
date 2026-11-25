import * as React from "react";
import { ClientLogoBand } from "@/components/site/proof-bands";
import { afterPaint } from "@/lib/after-paint";
import { EMPTY_PROOF, getPublicProof, type PublicProof } from "@/lib/site-api";

/**
 * The homepage's client logo band (PR 4; the CEO's review of 24 Nov 2026: no
 * case studies, a scrolling band of client logos instead).
 *
 * Its own module, loaded lazily by the homepage, because it sits below the
 * fold and the homepage route is held to 16 kB of its own on the first paint
 * (scripts/check-bundle.mjs). The read starts after paint for the same reason.
 */
export default function HomeClientBand() {
  const [proof, setProof] = React.useState<PublicProof>(EMPTY_PROOF);
  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const cancel = afterPaint(() => {
      getPublicProof({ signal: controller.signal }).then((pr) => alive && setProof(pr));
    });
    return () => {
      alive = false;
      cancel();
      controller.abort();
    };
  }, []);
  return <ClientLogoBand proof={proof} />;
}
