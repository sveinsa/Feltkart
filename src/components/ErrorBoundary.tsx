// Feilfanger: viser en lesbar feilmelding i stedet for en hvit side når noe i appen krasjer.
// Brukes rundt hele appen (main.tsx) og rundt Terreng 3D-fanen (App.tsx).
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { VERSION_LABEL } from '../version';

interface Props {
  /** Hva som krasjet, vises i overskriften (for eksempel «Terreng 3D») */
  label?: string;
  /** Dekker hele siden i stedet for bare området den står i */
  fullPage?: boolean;
  /** Ekstra knapp, for eksempel «Tilbake til kartet» */
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
  copied: boolean;
}

/** Feil som oppstår når nettleseren har en gammel utgave av siden og ikke finner en kodebit som er byttet ut */
const CHUNK_RE = /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch dynamically|error loading dynamically/i;

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Feltkart] Feil i ${this.props.label ?? 'appen'}:`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private report(): string {
    const { error, componentStack } = this.state;
    const lines = (s: string | undefined | null, n: number) => (s ?? '').split('\n').slice(0, n).join('\n');
    return [
      `Feltkart ${VERSION_LABEL}`,
      `Sted: ${this.props.label ?? 'hele appen'}`,
      `Nettleser: ${typeof navigator !== 'undefined' ? navigator.userAgent : ''}`,
      `Feil: ${error?.name ?? ''}: ${error?.message ?? ''}`,
      '',
      lines(error?.stack, 12),
      '',
      lines(componentStack, 8),
    ].join('\n');
  }

  private copy = async () => {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      // Eldre nettlesere eller blokkert utklippstavle: marker teksten så den kan kopieres for hånd
      const pre = document.getElementById('eb-report');
      if (pre) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pre);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    const { label, fullPage, action } = this.props;
    const stale = CHUNK_RE.test(error.message);
    return (
      <div className={`eb ${fullPage ? 'eb-full' : ''}`} role="alert">
        <div className="eb-box">
          <h2>{stale ? 'Siden må lastes inn på nytt' : `Noe gikk galt${label ? ` i ${label}` : ''}`}</h2>
          {stale ? (
            <p>Det er sannsynligvis lagt ut en ny versjon av Feltkart, og nettleseren har fortsatt den gamle. Trykk «Last siden på nytt» (eller Ctrl + F5).</p>
          ) : (
            <p>Resten av Feltkart er ikke berørt. Send gjerne feilmeldingen under til den som vedlikeholder løsningen.</p>
          )}
          <pre id="eb-report" className="eb-report">{this.report()}</pre>
          <div className="eb-actions">
            <button className="btn primary" onClick={() => window.location.reload()}>Last siden på nytt</button>
            <button className="btn" onClick={this.copy}>{copied ? 'Kopiert ✓' : 'Kopier feilmelding'}</button>
            {action && <button className="btn" onClick={action.onClick}>{action.label}</button>}
          </div>
        </div>
      </div>
    );
  }
}
