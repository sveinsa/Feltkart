// Liten, rask XML-leser (nok for LandXML). Navnerom-prefiks fjernes.
export interface XNode {
  tag: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = (s: string) => (s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m]));

export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) { stack[stack.length - 1].text += m[1]; continue; }
    if (m[2] !== undefined) { if (stack.length > 1) stack.pop(); continue; }
    if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      if (m[4]) { let a: RegExpExecArray | null; attrRe.lastIndex = 0; while ((a = attrRe.exec(m[4]))) attrs[a[1].replace(/^.*:/, '')] = decode(a[2] ?? a[3] ?? ''); }
      const node: XNode = { tag: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' };
      stack[stack.length - 1].children.push(node);
      if (!m[5]) stack.push(node);
      continue;
    }
    if (m[6] !== undefined && stack.length > 0) stack[stack.length - 1].text += decode(m[6]);
  }
  return root;
}

export const kids = (n: XNode | undefined, tag: string): XNode[] => (n ? n.children.filter((c) => c.tag === tag) : []);
export const kid = (n: XNode | undefined, tag: string): XNode | undefined => (n ? n.children.find((c) => c.tag === tag) : undefined);
export function descendants(n: XNode, tag: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) { if (c.tag === tag) out.push(c); descendants(c, tag, out); }
  return out;
}
export const nums = (s: string): number[] => (s.trim() ? s.trim().split(/\s+/).map(Number) : []);
