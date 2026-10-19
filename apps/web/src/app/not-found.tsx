import type { Metadata } from 'next';

import { sq } from '@/lib/copy/sq';

export const metadata: Metadata = {
  title: sq.notFound.title,
};

/** The 404: two sentences and the only link that always works. */
export default function NotFound() {
  return (
    <main>
      <h1>{sq.notFound.title}</h1>
      <p className="muted">{sq.notFound.body}</p>
      <p className="footnote">
        <a href="/">{sq.notFound.back}</a>
      </p>
    </main>
  );
}
