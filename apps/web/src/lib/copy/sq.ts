/**
 * Every string the app shows a person, in Albanian (ADR 0007).
 *
 * There is no i18n runtime because there is exactly one locale: this is a typed constant, so a
 * mistyped key is a compile error rather than a blank label on a phone. Two kinds of text live
 * elsewhere on purpose:
 *
 *   * domain problem messages (`packages/shared/src/extraction/*`) — they embed computed amounts
 *     (`1.234,56`, `18 %`) and are built where those numbers are, so they read in Albanian *there*;
 *   * sentences that wrap `<code>` elements (`SetupNotice`) — markup stays next to its element.
 *
 * Machine-facing text stays English: the document title (`layout.tsx`), `/api/health`, API error
 * `code`s and logs. Money is already grouped the way this market writes it by `@einv/shared`
 * (`1.234,56`), so no formatter is configured here.
 */

import type { InvoiceStatus } from '@einv/shared';

/** Albanian counts: one thing takes the singular, everything else the plural. */
export function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export const sq = {
  app: {
    /**
     * Shown to people. `APP_NAME` ('e-Invoice Exchange') stays the machine-facing brand: the document
     * title and `/api/health` keep reporting it, by decision.
     */
    name: 'e-Fatura',
  },

  common: {
    /** The dash for "nothing here"; one character, so it is one constant. */
    noNumber: 'pa numër',
    noDate: 'pa datë',
    version: 'Versioni',
    allInvoices: 'Të gjitha faturat',
    captureAnother: 'Kap një tjetër',
    captureInvoice: 'Kap një faturë',
  },

  home: {
    badge: 'MVP · kap një faturë',
    title: 'Fotografo faturën e furnitorit',
    intro: (name: string) =>
      `${name} lexon fotografinë, të tregon çdo numër që gjen dhe ruan vetëm atë që konfirmon.`,
  },

  capture: {
    headingStart: 'Fillo këtu',
    headingAnother: 'Një faturë tjetër',
    hint: 'Fotografo faturën e furnitorit ose ngarko një PDF. Dokumenti lexohet në server dhe asgjë nuk ruhet derisa të kontrollosh çdo numër.',
    button: {
      idle: 'Fotografo faturën',
      uploading: 'Po ngarkohet…',
      reading: 'Po lexohet dokumenti…',
      review: 'Fotografo një faturë tjetër',
      saving: 'Po ruhet…',
    },
    secondary: 'Ngarko një foto ose PDF',

    /**
     * The live camera (ADR 0010). It is a modal overlay, so these strings are only ever read on
     * black: a title, one instruction, and one sentence per way the browser can refuse — because
     * "the camera did not open" is four different problems and only one of them is the person's.
     */
    camera: {
      title: 'Fotografo faturën',
      hint: 'Mbaje faturën brenda kornizës dhe shtyp butonin.',
      starting: 'Po hapet kamera…',
      /** Read under "Po hapet kamera…", while the browser's own prompt is on screen. */
      permissionHint: 'Shfletuesi po kërkon leje për kamerën — shtyp "Lejo" që të shfaqet pamja.',
      shutter: 'Kap foton',
      close: 'Mbyll',
      useFile: 'Zgjidh një skedar',
      /** A fresh request from a click: the only way to get the prompt back after a refusal. */
      retryCamera: 'Provo përsëri kamerën',
      /** `NotAllowedError` / `SecurityError`: the person, or a policy, said no. */
      denied: 'Shfletuesi nuk e lejoi kamerën. Lejoje në cilësimet e faqes, ose zgjidh një skedar.',
      /**
       * The same refusal, but the browser remembers it: it will not ask again, so the sentence has to
       * say how to undo the old answer rather than to try again.
       */
      deniedRemembered:
        'Kamerën e ke bllokuar më parë, prandaj shfletuesi nuk pyet më. Kliko ikonën e drynit pranë adresës, zgjidh "Kamera → Lejo", pastaj rifresko faqen — ose zgjidh një skedar.',
      /** `NotFoundError` / `OverconstrainedError`: there is no rear camera to open. */
      noCamera: 'Nuk u gjet asnjë kamerë në këtë pajisje. Zgjidh një skedar.',
      /** `NotReadableError` / `AbortError`: something else holds the camera. */
      busy: 'Kamera është e zënë nga një program tjetër. Mbyll atë dhe provo përsëri.',
      /** Anything else, including a browser that refuses without saying why. */
      unavailable: 'Kamera nuk mund të hapet në këtë pajisje. Zgjidh një skedar.',
      /**
       * Not a refusal: `canOpenLiveCamera` was false, so no prompt is possible on this origin at all.
       * Read on the card, before the button is pressed, where the fallback is about to happen.
       */
      notSecure:
        'Kamera e drejtpërdrejtë nuk hapet në këtë adresë (duhet https ose localhost). Butoni hap kamerën e telefonit ose një skedar.',
      /** The frame could not become a file: no first frame yet, or no 2D context to draw it into. */
      failed: 'Fotografia nuk mund të kapej. Provo përsëri.',
    },

    /** Fallbacks for a request that failed without an API message. */
    uploadFailed: (status: number) => `ngarkimi dështoi (${String(status)})`,
    uploadFailedGeneric: 'ngarkimi dështoi',
    noDocumentId: 'ngarkimi nuk ktheu një id dokumenti',
    extractionFailed: 'nxjerrja dështoi; provo një dokument tjetër',
    noDraft: 'nxjerrja nuk ktheu asnjë skicë',
    saveFailed: 'fatura nuk mund të ruhej',
  },

  review: {
    fixBeforeSaving: 'Rregullo këto përpara se të ruash',
    worthChecking: 'Vlen të kontrollohet',
    supplierSection: 'Furnitori',
    supplier: 'Furnitori',
    supplierVat: 'Numri i TVSH-së i furnitorit',
    supplierAddress: 'Adresa e furnitorit',
    country: 'Shteti',
    yourCompany: 'Kompania jote',
    invoiceNumber: 'Numri i faturës',
    issueDate: 'Data e lëshimit',
    dueDate: 'Afati i pagesës',
    currencyNote: (currency: string) =>
      `Lexuar në ${currency}; asgjë nuk konvertohet — fiton monedha e shkruar në faturë.`,
    linesRead: (lines: number) =>
      `${count(lines, 'rresht i lexuar', 'rreshta të lexuar')}. Asgjë nuk ruhet derisa të ` +
      'shtypësh “Ruaj”, dhe totalet e ruajtura rillogariten në server nga këto fusha.',

    /**
     * Who read the document. A draft is only as good as the reading behind it, and the `stub` provider
     * reads nothing at all — it returns a fixture — so that case is a card the person cannot miss, not
     * a footnote they scroll past.
     */
    readBy: (source: string) => `Lexuar nga ${source}`,
    demoTitle: 'Kujdes: ky është lexim demo, jo fatura jote',
    demoBody:
      'Provajderi “stub” nuk e hap dokumentin: shifrat më poshtë janë një shembull i përsëritshëm, ' +
      'jo përmbajtja e faturës. Për lexim të vërtetë vendos GEMINI_API_KEY në .env, rinis serverin ' +
      'dhe ngarko dokumentin përsëri.',

    /**
     * The duplicate gate. It names the invoice that already exists and the way to it, because "this is a
     * duplicate" without a destination leaves the person holding the paper with no next step.
     */
    duplicate: {
      title: 'Kjo faturë është regjistruar më parë',
      body: (number: string, supplier: string) =>
        `Nr. ${number} i ${supplier} ekziston tashmë në këtë kompani. Fatura nuk ruhet dy herë.`,
      bodyNoNumber: (supplier: string) =>
        `Furnitori ${supplier} ka tashmë një faturë me këtë numër. Fatura nuk ruhet dy herë.`,
      detail: (date: string, total: string) => `${date} · ${total}`,
      open: 'Hap faturën ekzistuese',
      blockedNote: 'Ruajtja është bllokuar: hap faturën ekzistuese ose ndrysho numrin e faturës.',
    },
  },

  lines: {
    title: 'Rreshtat',
    item: (position: number) => `Artikulli ${String(position)}`,
    quantity: 'Sasia',
    unitPrice: 'Çmimi i njësisë',
    discount: 'Zbritja',
    vatRate: 'Norma e TVSH-së',
    documentDiscount: 'Zbritje për të gjithë faturën',
    subtotal: 'Nëntotali',
    vat: 'TVSH',
    total: 'Totali',
    previewNote: 'Parapamje: serveri rillogarit çdo shumë nga këto fusha kur të ruash.',
    previewPaused: (error: string) => `Parapamja u ndal — ${error}`,
    save: (total: string, currency: string) => `Ruaj faturën (${total} ${currency})`,
    saveDisabledNote: 'Ruajtja mbetet e çaktivizuar derisa një gabim më lart të zgjidhet.',
    saved: 'U ruajt.',
    openInvoice: 'Hap faturën',
    unknownRate: (id: string) => `normë TVSH-je e panjohur “${id}”`,
  },

  /** Failures of the live preview, which runs the domain's own arithmetic in the browser. */
  preview: {
    amount: 'shuma ose zbritja nuk pranohet në këtë fushë',
    quantity: 'sasia nuk pranohet në këtë fushë',
    currency: 'monedha nuk njihet',
    notANumber: 'nuk është ende numër',
    other: (code: string) => `vlera nuk pranohet (${code})`,
  },

  invoices: {
    title: 'Faturat',
    heading: 'Faturat e kapura',
    summary: (company: string, captured: number) =>
      `${company} · ${count(captured, 'e ruajtur', 'të ruajtura')}`,
    empty: 'Asgjë ende',
    emptyHint: 'Fotografo faturën e furnitorit dhe do të shfaqet këtu sapo ta konfirmosh.',
    /** The search box: one field, and it searches the supplier's name and the lines together. */
    searchLabel: 'Furnitori ose përshkrimi i artikujve',
    searchPlaceholder: 'p.sh. Kafe Sh.p.k ose “kafe 1 kg”',
    searchAction: 'Kërko',
    searchClear: 'Pastro kërkimin',
    /** Replaces `summary` while a search is active, so the number is understood as the result count. */
    searchSummary: (query: string, found: number) =>
      `“${query}” · ${count(found, 'faturë', 'fatura')}`,
    noMatches: 'Asnjë përputhje',
    noMatchesHint: (query: string) =>
      `Asnjë furnitor dhe asnjë rresht i faturave nuk përmban “${query}”. Provo një fjalë tjetër.`,
    /** The count after a dash: `14.03.2026 · 3 rreshta`. */
    lineCount: (lines: number) => count(lines, 'rresht', 'rreshta'),
  },

  invoice: {
    title: 'Fatura',
    issueDateUnknown: 'data e lëshimit e panjohur',
    issuedOn: (date: string) => `lëshuar më ${date}`,
    dueOn: (date: string) => `afati i pagesës ${date}`,
    vatNumber: (vatNumber: string) => `TVSH ${vatNumber}`,
    inconsistentTitle: 'Këto totale nuk përputhen',
    inconsistentBody: (id: string) =>
      'Totalet e ruajtura nuk përputhen me rreshtat. Ky është gabim në program, jo diçka që ' +
      `rregullohet duke redaktuar faturën: raportoje me këtë id (${id}).`,
    parties: 'Palët',
    supplier: 'Furnitori',
    buyer: 'Blerësi',
    lines: 'Rreshtat',
    columns: {
      position: 'Nr.',
      description: 'Përshkrimi',
      quantity: 'Sasia',
      unit: 'Çm. njësie',
      vat: 'TVSH',
      total: 'Totali',
    },
    totals: 'Totalet',
    subtotal: 'Nëntotali',
    vat: 'TVSH',
    discount: 'Zbritja',
    total: 'Totali',
    vatByRate: 'TVSH sipas normës',
    vatByRateRow: (rate: string, base: string, tax: string) => `${rate} % mbi ${base} = ${tax}`,
    storedAs: (id: string) => `ruajtur ${id}`,
  },

  /** Signing in, signing out, and the two ways a round trip can fail (ADR 0009). */
  auth: {
    title: 'Hyr në llogarinë tënde',
    intro:
      'Faturat lidhen me llogarinë tënde: vetëm ti dhe kolegët e kompanisë i shihni. Pa hyrje asgjë nuk ruhet.',
    google: 'Vazhdo me Google',
    footnote:
      'Nuk krijojmë fjalëkalim. Identiteti vjen nga Google dhe ruajmë vetëm emrin dhe emailin e konfirmuar.',
    signedInAs: (email: string) => `Hyrur si ${email}`,
    signOut: 'Dil',
    notConfiguredTitle: 'Hyrja me Google nuk është konfiguruar',
    notConfiguredBody:
      'Vendos GOOGLE_CLIENT_ID dhe GOOGLE_CLIENT_SECRET në .env dhe rindiz serverin. Pa to butoni do të dështonte, ndaj nuk shfaqet.',
    errorTitle: 'Hyrja nuk përfundoi',
    errorUnknown: 'hyrja nuk përfundoi; provo përsëri',
    /** Keys are `AuthErrorCode`s; an unknown code still gets a sentence, never a blank alert. */
    errors: {
      OAUTH_FAILED: 'hyrja me Google dështoi ose skadoi; provo përsëri',
      EMAIL_UNVERIFIED:
        'Google nuk e konfirmon këtë adresë email; hyr me një llogari që e ka të konfirmuar',
      NOT_CONFIGURED: 'hyrja me Google nuk është konfiguruar në këtë server',
      CROSS_ORIGIN: 'kërkesa nuk erdhi nga kjo faqe; hape aplikacionin dhe provo përsëri',
      UNAUTHENTICATED: 'duhet të hysh për të vazhduar',
      /** Not an `AuthErrorCode`: the callback maps a database outage onto the same page. */
      DATABASE_UNAVAILABLE: 'baza e të dhënave nuk përgjigjet; provo pas një minute',
    },
  },

  setup: {
    title: 'Baza e të dhënave nuk është gati',
    then: 'Pastaj ringarko këtë faqe. Nxjerrja ka nevojë për ato rreshta: monedha e kompanisë dhe tabela e normave të saj janë ajo që e bën faturën e kapur të saktë e jo të përafërt.',
  },

  notFound: {
    title: 'Faqja nuk u gjet',
    body: 'Lidhja mund të jetë e vjetër ose fatura nuk ekziston.',
    back: 'Kthehu në faqen kryesore',
  },

  /** Messages a route or an extraction failure returns; the capture screen shows them verbatim. */
  api: {
    storageDriver: (driver: string) =>
      `STORAGE_DRIVER="${driver}" nuk është implementuar në këtë version; vendose në "local"`,
    multipartRequired: 'pritej një trup multipart/form-data me një pjesë "file"',
    noFilePart: 'kërkesa nuk përmban një pjesë "file"',
    documentIdRequired: 'dërgo {"documentId": "<id i ngarkimit>"}',
    documentNotFound: 'ky ngarkim nuk ekziston në këtë kompani',
    documentBytesMissing: (id: string) =>
      `skedari i ruajtur për ngarkimin ${id} mungon (incident, jo kërkesë e gabuar)`,
    invoiceNotSaveable: 'kjo faturë ka ende probleme të pazgjidhura; rregulloji dhe provo përsëri',
    invoiceNotFound: 'nuk ka faturë me këtë id në këtë kompani',
    internal: 'diçka shkoi keq në anën tonë',
    /** Every authenticated route answers this when the session is missing, revoked or expired. */
    unauthenticated: 'duhet të hysh për të vazhduar',

    /** Extraction provider failures (`server/extraction`); reported as a 502. */
    modelNoContent:
      'modeli nuk ktheu përmbajtje; imazhi mund të jetë bllokuar nga një filtër sigurie',
    modelNotJson: (excerpt: string) => `modeli nuk u përgjigj me JSON: “${excerpt}”`,
    requestTimedOut: (model: string, timeoutMs: number) =>
      `kërkesa për nxjerrje skadoi (modeli ${model}, afati ${String(timeoutMs)} ms)`,
    requestFailed: (model: string, timeoutMs: number) =>
      `kërkesa për nxjerrje dështoi (modeli ${model}, afati ${String(timeoutMs)} ms)`,
    providerAnswered: (status: number, body: string) =>
      `ofruesi i nxjerrjes u përgjigj ${String(status)}: ${body}`,
    missingKey:
      'AI_PROVIDER është "gemini" por GEMINI_API_KEY është bosh; vendos çelësin ose AI_PROVIDER="stub"',
  },
} as const;

/**
 * The sentence for an `AuthErrorCode` carried in `?error=…`.
 *
 * The sign-in page receives a code, never provider prose (a message from Google is a log line, not UI).
 * An unknown code still gets a sentence: a blank alert would look like a silent failure.
 */
export function authErrorLabel(code: string | null | undefined): string | null {
  if (code === null || code === undefined || code === '') {
    return null;
  }

  return (sq.auth.errors as Readonly<Record<string, string>>)[code] ?? sq.auth.errorUnknown;
}

/** The invoice status badge. The stored value is a contract; only the label is translated. */
const STATUS_LABELS: Readonly<Record<InvoiceStatus, string>> = {
  DRAFT: 'Skicë',
  ISSUED: 'Lëshuar',
  SENT: 'Dërguar',
  DELIVERED: 'Dorëzuar',
  ACCEPTED: 'Pranuar',
  DISPUTED: 'Kontestuar',
  REJECTED: 'Refuzuar',
  PAID: 'Paguar',
  CANCELLED: 'Anuluar',
};

/**
 * The label for a status. An unknown value is shown as stored rather than hidden: a status this
 * build does not know about is a fact the operator should see, not something to swallow.
 */
export function statusLabel(status: string): string {
  return (STATUS_LABELS as Readonly<Record<string, string>>)[status] ?? status;
}

/** Where a captured invoice came from, as a sentence fragment (`· kapur me kamerë`). */
const CAPTURE_SOURCES: Readonly<Record<string, string>> = {
  CAMERA: 'kapur me kamerë',
  UPLOAD: 'ngarkuar nga një skedar',
  MANUAL: 'shtuar me dorë',
};

export function captureSourceLabel(source: string): string {
  return CAPTURE_SOURCES[source] ?? `kapur (${source})`;
}
