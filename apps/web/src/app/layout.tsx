import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'e-Invoice Exchange',
    template: '%s · e-Invoice Exchange',
  },
  description: 'Issue, send, accept and settle business invoices between companies.',
  applicationName: 'e-Invoice Exchange',
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="sq">
      <body>{children}</body>
    </html>
  );
}
