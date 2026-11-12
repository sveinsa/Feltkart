// Mappemaler: skrives som innrykket tekst (2 mellomrom eller tab per nivå).
// Variabler i mappenavn: {prosjektnr} {prosjektnavn} {år} {dato}

export interface FolderTemplate {
  id: string;
  name: string;
  text: string;
}

export interface TemplateNode {
  name: string;
  children: TemplateNode[];
}

export const DEFAULT_TEMPLATES: FolderTemplate[] = [
  {
    id: 'anlegg',
    name: 'Anleggsprosjekt (standard)',
    text: `{prosjektnr} {prosjektnavn}
  01 Kontrakt og økonomi
    Kontrakt
    Endringsmeldinger
    Fakturagrunnlag
  02 Prosjektering
    DXF
    LandXML
    Modeller (IFC)
    Tegninger (PDF)
  03 Innmåling
    Grunnlagsnett
    Innmålinger
    Kontrollmålinger
  04 Foto
    Bilder
    360-bilder
  05 Drone
    Ortofoto
    Terrengmodell
    Rådata
  06 HMS og KS
    SJA
    Avvik
    Sjekklister
  07 Møter
    Byggemøter
    Referater
  08 Sluttdokumentasjon
    FDV
    Som bygget`,
  },
  {
    id: 'enkel',
    name: 'Enkel',
    text: `{prosjektnr} {prosjektnavn}
  Bilder
  360-bilder
  Prosjektert (DXF)
  Ortofoto (drone)
  Dokumenter`,
  },
];

/** Tolker innrykket tekst til et tre. Tomme linjer og linjer som starter med # ignoreres. */
export function parseTemplate(text: string): { roots: TemplateNode[]; errors: string[] } {
  const roots: TemplateNode[] = [];
  const errors: string[] = [];
  const stack: { indent: number; node: TemplateNode }[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const expanded = raw.replace(/\t/g, '  ');
    const indent = expanded.length - expanded.trimStart().length;
    const name = expanded.trim().replace(/^[-*•]\s*/, '');
    if (/[\\/]/.test(name) && !/[{}]/.test(name)) errors.push(`Linje ${i + 1}: «${name}» inneholder / eller \\ – det blir tolket som én mappe.`);
    const node: TemplateNode = { name, children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ indent, node });
  });
  return { roots, errors };
}

/** Gjør et tre om til innrykket tekst (brukes når strukturen hentes fra kartets mapper). */
export function treeToText(roots: TemplateNode[], depth = 0): string {
  return roots.map((n) => '  '.repeat(depth) + n.name + (n.children.length ? '\n' + treeToText(n.children, depth + 1) : '')).join('\n');
}

export interface TemplateVars {
  prosjektnr: string;
  prosjektnavn: string;
}

export function applyVars(name: string, v: TemplateVars): string {
  const now = new Date();
  return name
    .replace(/\{prosjektnr\}/gi, v.prosjektnr.trim())
    .replace(/\{prosjektnavn\}/gi, v.prosjektnavn.trim())
    .replace(/\{år\}/gi, String(now.getFullYear()))
    .replace(/\{dato\}/gi, now.toISOString().slice(0, 10))
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveTree(roots: TemplateNode[], v: TemplateVars): TemplateNode[] {
  return roots
    .map((n) => ({ name: applyVars(n.name, v), children: resolveTree(n.children, v) }))
    .filter((n) => n.name.length > 0);
}

export function countNodes(roots: TemplateNode[]): number {
  return roots.reduce((s, n) => s + 1 + countNodes(n.children), 0);
}
