/** Exact money arithmetic on API decimal strings ("450.00") via integer paise — never floats. */
export function toPaise(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`Invalid money amount: ${amount}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

export function fromPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const sumMoney = (amounts: string[]): string => fromPaise(amounts.reduce((total, amount) => total + toPaise(amount), 0));
