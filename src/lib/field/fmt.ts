// Små formateringsfunksjoner for Felt (norsk desimalkomma)
export const nb = (v: number, d: number) => v.toFixed(d).replace('.', ',');
export const cm = (m: number | null) => (m === null ? '–' : m < 0.1 ? `±${nb(m * 100, 1)} cm` : `±${nb(m * 100, 0)} cm`);
