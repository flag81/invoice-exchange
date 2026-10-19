/**
 * The `stub` provider — a deterministic invoice derived from the image's own bytes.
 *
 * It exists so the whole capture pipeline can be exercised without an API key: the same photograph
 * always yields the same invoice (so a test can assert on it, and a demo is repeatable), while different
 * photographs yield visibly different documents (so nothing looks hard-coded in a demo). The draft it
 * produces is a *plausible, internally consistent* Kosovo supplier invoice and is marked as such in its
 * `notes`, because the one thing a stub must never do is let someone believe they are looking at real
 * extraction.
 *
 * It reads nothing from the image. That is the point: it tests the pipeline, not the model.
 */

import { createHash } from 'node:crypto';

import { type ExtractionProvider, type ExtractionRequest, type ExtractionResult } from './types';

const STUB_PROVIDER = 'stub';
const STUB_MODEL = 'stub-1';

const SUPPLIERS: readonly {
  readonly name: string;
  readonly vatNumber: string;
  readonly address: string;
}[] = [
  {
    name: 'NPT Kafe Sh.p.k',
    vatNumber: '811234567',
    address: 'Rr. Luan Haradinaj 12, Prishtinë',
  },
  { name: 'Furra e Qytetit', vatNumber: '810998877', address: 'Rr. UÇK 40, Prishtinë' },
  {
    name: 'Market Fresh Sh.p.k',
    vatNumber: '812345678',
    address: 'Magjistralja Prishtinë–Ferizaj km 4',
  },
  { name: 'Elektro Tehnika', vatNumber: '813456789', address: 'Rr. Garibaldi 7, Pejë' },
  { name: 'Hidro Instal Sh.p.k', vatNumber: '814567890', address: 'Rr. Skënderbeu 88, Gjakovë' },
];

const ITEMS: readonly {
  readonly description: string;
  readonly unitPrice: string;
  readonly taxRatePercent: string;
}[] = [
  { description: 'Kafe e bluar 1 kg', unitPrice: '12.50', taxRatePercent: '18' },
  { description: 'Ujë i natyrshëm 1.5 l', unitPrice: '0.65', taxRatePercent: '8' },
  { description: 'Miell gruri T-500 25 kg', unitPrice: '14.90', taxRatePercent: '8' },
  { description: 'Shërbim servisimi', unitPrice: '45.00', taxRatePercent: '18' },
  { description: 'Filtra ajri (set)', unitPrice: '22.40', taxRatePercent: '18' },
];

const QUANTITIES: readonly string[] = ['1', '2', '3', '0.5', '2.5'];

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Builds the fixture from a hex digest. Exported (and pure) so a test can pin the exact invoice a
 * known image produces, without going through the provider or a file system.
 */
export function stubInvoiceFromDigest(digest: string): Record<string, unknown> {
  const byteAt = (index: number): number =>
    Number.parseInt(digest.slice((index * 2) % 64, ((index * 2) % 64) + 2), 16);

  const supplier = SUPPLIERS[byteAt(1) % SUPPLIERS.length] ?? SUPPLIERS[0];
  const lineCount = 1 + (byteAt(2) % 3);
  const month = 1 + (byteAt(3) % 12);
  const day = 1 + (byteAt(4) % 28);

  const lines = Array.from({ length: lineCount }, (_unused, index) => {
    const item = ITEMS[byteAt(5 + index * 3) % ITEMS.length] ?? ITEMS[0];

    return {
      description: item?.description ?? 'Artikull',
      quantity: QUANTITIES[byteAt(6 + index * 3) % QUANTITIES.length] ?? '1',
      unitPrice: item?.unitPrice ?? '0.00',
      taxRatePercent: item?.taxRatePercent ?? '18',
      taxCategory: item?.taxRatePercent === '8' ? 'REDUCED' : 'STANDARD',
    };
  });

  return {
    supplierName: supplier?.name ?? 'Furnitor i panjohur',
    supplierVatNumber: supplier?.vatNumber ?? null,
    supplierAddress: supplier?.address ?? null,
    supplierCountryCode: 'XK',
    invoiceNumber: `STUB-${digest.slice(0, 6).toUpperCase()}`,
    issueDate: `2026-${pad(month)}-${pad(day)}`,
    dueDate: null,
    currency: 'EUR',
    lines,
    documentDiscount: null,
    notes: 'Produced by the stub extraction provider: a deterministic fixture, not a real reading.',
  };
}

export function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createStubProvider(): ExtractionProvider {
  return {
    name: STUB_PROVIDER,
    model: STUB_MODEL,
    extract: (request: ExtractionRequest): Promise<ExtractionResult> => {
      const startedAt = Date.now();
      const raw = stubInvoiceFromDigest(digestOf(request.bytes));

      return Promise.resolve({
        raw,
        provider: STUB_PROVIDER,
        model: STUB_MODEL,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}
