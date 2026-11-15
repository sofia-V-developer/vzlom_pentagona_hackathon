import type { ReactNode } from 'react';

export type IconName =
  | 'signal'
  | 'chevron'
  | 'play'
  | 'pause'
  | 'step'
  | 'reset'
  | 'arrow'
  | 'point'
  | 'clock'
  | 'download'
  | 'upload'
  | 'print'
  | 'server'
  | 'info';

const paths: Record<IconName, ReactNode> = {
  signal: <path d="M4 19v-3m5 3v-6m5 6V9m5 10V5" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  play: <path d="m8 5 11 7-11 7z" fill="currentColor" strokeWidth="1.2" />,
  pause: <path d="M9 5v14m6-14v14" strokeWidth="2.4" />,
  step: (
    <>
      <path d="m5 6 9 6-9 6z" fill="currentColor" />
      <path d="M18 5v14" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 1 1.8 5M4 12V6m0 6h6" />
    </>
  ),
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
  point: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v5m0 10v5M2 12h5m10 0h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
    </>
  ),
  print: (
    <>
      <path d="M6 8V3h12v5M6 17H3V9h18v8h-3m-12-3h12v7H6zM17 11h1" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4" width="16" height="7" rx="1" />
      <rect x="4" y="13" width="16" height="7" rx="1" />
      <path d="M7 7.5h1m-1 9h1m4-9h5m-5 9h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </>
  ),
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Section({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return (
    <span className={`chip ${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
export const format = (value: number | null | undefined, digits = 1) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
        .format(value)
        .replace('-', '−');
export const whole = (value: number | null | undefined) => format(value, 0);
export const timeLabel = (timestamp: string) =>
  new Date(timestamp).toLocaleTimeString('ru-RU', { hour12: false });
export const radioTone = (state: string) =>
  state === 'NORMAL' || state === 'PASS'
    ? 'good'
    : state === 'TRIPPED' || state === 'FAIL'
      ? 'danger'
      : state === 'LIMITED' || state === 'UNKNOWN'
        ? 'warning'
        : 'neutral';
