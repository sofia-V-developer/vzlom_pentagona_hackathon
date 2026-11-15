import { lazy, Suspense, useId, type MouseEvent } from 'react';
import type { Budget, Event, Phase, Snapshot, Telemetry, XY } from './types';
import { Chip, format, Icon, radioTone, Section, timeLabel, whole } from './ui';

const TelemetryChart = lazy(() => import('./TelemetryChart'));

const palette: [number, number[]][] = [
  [-125, [211, 201, 213]],
  [-113, [173, 181, 215]],
  [-103, [147, 184, 218]],
  [-94, [135, 196, 207]],
  [-85, [146, 204, 180]],
  [-74, [191, 219, 155]],
  [-65, [232, 232, 171]],
];
const gradient = palette
  .map(
    ([level, color]) =>
      `rgb(${color.join(',')}) ${((level + 125) / 60) * 100}%`,
  )
  .join(', ');
function heat(value: number | null) {
  if (value === null) return '#e7e7e2';
  const index = palette.findIndex(([level]) => level > value);
  if (index < 0) return `rgb(${palette[palette.length - 1][1].join(',')})`;
  if (index === 0) return `rgb(${palette[0][1].join(',')})`;
  const [low, a] = palette[index - 1],
    [high, b] = palette[index];
  const ratio = (value - low) / (high - low);
  return `rgb(${a.map((component, i) => Math.round(component + (b[i] - component) * ratio)).join(',')})`;
}

export function FloorPlan({
  s,
  phase,
  point,
  onPoint,
}: {
  s: Snapshot;
  phase: Phase;
  point?: XY;
  onPoint?: (point: XY) => void;
}) {
  const hatch = useId();
  const { layout } = s.config;
  const rooms = layout.rooms ?? [];
  const scale = 64,
    left = 38,
    top = 83;
  const width = layout.width_m * scale,
    depth = layout.depth_m * scale;
  const outside = [layout.donor, layout.gsm_antenna];
  const [minX, minY, maxX, maxY] = [
    Math.min(0, ...outside.map((p) => p.x)) * scale + left - 34,
    Math.min(0, ...outside.map((p) => p.y)) * scale + top - 25,
    Math.max(layout.width_m, ...outside.map((p) => p.x)) * scale + left + 34,
    Math.max(layout.depth_m, ...outside.map((p) => p.y)) * scale + top + 44,
  ];
  const X = (x: number) => left + x * scale,
    Y = (y: number) => top + y * scale;
  const { cells, cell_width_m: cw, cell_depth_m: ch } = s.coverage;
  const markers = [
    { ...layout.donor, label: 'Донор', tone: '#2451a6' },
    { ...layout.gsm_antenna, label: 'GSM', tone: '#91511d', azimuth_deg: null },
  ];
  function select(e: MouseEvent<SVGRectElement>) {
    const root = e.currentTarget.ownerSVGElement;
    const transform = root?.getScreenCTM();
    if (!root || !transform || !onPoint) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      transform.inverse(),
    );
    const x = (p.x - left) / scale,
      y = (p.y - top) / scale;
    const cell = cells.find(
      (c) =>
        Math.abs(c.x - x) <= cw / 2 + 0.0001 &&
        Math.abs(c.y - y) <= ch / 2 + 0.0001,
    );
    if (cell) onPoint({ x: cell.x, y: cell.y });
  }
  return (
    <div className="floor-wrap">
      <svg
        className={`floor${rooms.length ? ' floor-with-rooms' : ''}`}
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        role="img"
        aria-label="Пропорциональный план МЦОД и карта RSRP"
      >
        <defs>
          <pattern
            id={hatch}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(40)"
          >
            <rect width="6" height="6" fill="#394250" />
            <path d="M0 0V6" stroke="#626d7a" strokeWidth="2" />
          </pattern>
        </defs>
        <rect x={left} y={top} width={width} height={depth} fill="#e7e7e2" />
        {cells.map((c) => (
          <rect
            key={`${c.x}:${c.y}`}
            x={X(c.x - cw / 2)}
            y={Y(c.y - ch / 2)}
            width={cw * scale + 0.1}
            height={ch * scale + 0.1}
            fill={heat(c[`${phase}_dl_dbm`])}
            opacity={c.working ? 1 : 0.35}
          />
        ))}
        {Array.from({ length: Math.floor(layout.width_m) + 1 }, (_, i) => (
          <g key={i}>
            <path
              d={`M${X(i)},${top}v${depth}`}
              stroke="#354957"
              strokeOpacity=".25"
            />
            {i % (layout.width_m > 16 ? 4 : 2) === 0 && (
              <text
                x={X(i)}
                y={top + depth + 22}
                textAnchor="middle"
                className="floor-axis"
              >
                {i} м
              </text>
            )}
          </g>
        ))}
        {Array.from({ length: Math.floor(layout.depth_m) + 1 }, (_, i) => (
          <g key={i}>
            <path
              d={`M${left},${Y(i)}h${width}`}
              stroke="#354957"
              strokeOpacity=".25"
            />
            <text
              x={left - 8}
              y={Y(i) + 4}
              textAnchor="end"
              className="floor-axis"
            >
              {i} м
            </text>
          </g>
        ))}
        <rect
          x={left}
          y={top}
          width={width}
          height={depth}
          fill="none"
          stroke="#3a4b57"
          strokeWidth="1.3"
        />
        {layout.obstacles.map((o) => (
          <g key={o.id}>
            <rect
              x={X(o.x)}
              y={Y(o.y)}
              width={o.width * scale}
              height={o.depth * scale}
              rx={o.kind === 'partition' ? 0 : 1.5}
              fill={
                o.kind === 'partition'
                  ? '#394250'
                  : o.kind === 'equipment'
                    ? '#7b8791'
                    : `url(#${hatch})`
              }
              stroke="#2c3640"
              strokeWidth=".8"
            >
              <title>{o.label}</title>
            </rect>
            {o.kind !== 'partition' && o.width >= 0.55 && (
              <text
                x={X(o.x + o.width / 2)}
                y={Y(o.y + o.depth / 2) + 4}
                className="rack-label"
                textAnchor="middle"
              >
                {o.label}
              </text>
            )}
          </g>
        ))}
        {rooms.map((room) => (
          <text
            key={room.id}
            className="room-label"
            x={X(room.x + room.width / 2)}
            y={Y(room.y) + 23}
            textAnchor="middle"
          >
            {room.label}
          </text>
        ))}
        <path
          d={`M${X(layout.donor.x)} ${Y(layout.donor.y)}L${X(layout.repeater.x)} ${Y(layout.repeater.y)}L${X(layout.splitter.x)} ${Y(layout.splitter.y)}`}
          fill="none"
          stroke="#263d63"
          strokeOpacity=".65"
          strokeDasharray="4 4"
        />
        {layout.panels.map((p) => (
          <path
            key={p.id}
            d={`M${X(layout.splitter.x)} ${Y(layout.splitter.y)}L${X(p.x)} ${Y(p.y)}`}
            stroke="#263d63"
            strokeOpacity=".42"
            strokeDasharray="3 5"
          />
        ))}
        <rect
          x={X(layout.repeater.x) - 5}
          y={Y(layout.repeater.y) - 5}
          width="10"
          height="10"
          rx="2"
          fill="#f7faff"
          stroke="#263d63"
        >
          <title>Репитер</title>
        </rect>
        <circle
          cx={X(layout.splitter.x)}
          cy={Y(layout.splitter.y)}
          r="4"
          fill="#f7faff"
          stroke="#263d63"
        >
          <title>Делитель</title>
        </circle>
        {layout.panels.map((p) => (
          <g key={p.id} opacity={p.enabled ? 1 : 0.5}>
            <g
              transform={`translate(${X(p.x)},${Y(p.y)}) rotate(${p.azimuth_deg})`}
            >
              <path
                d="M-8-9h7V9h-7zM3-7l11 7L3 7z"
                fill="#f8fbff"
                stroke="#213b68"
                strokeWidth="1.3"
              />
            </g>
            <text
              x={X(p.x)}
              y={Y(p.y) + 23}
              textAnchor="middle"
              className="panel-label"
            >
              {p.label}
            </text>
          </g>
        ))}
        {markers.map((p) => (
          <g key={p.label} transform={`translate(${X(p.x)},${Y(p.y)})`}>
            <circle r="7" fill="#f6f8fb" stroke={p.tone} strokeWidth="1.4" />
            <circle r="2" fill={p.tone} />
            {p.azimuth_deg !== null && (
              <path
                d="M7 0l8 -3v6z"
                transform={`rotate(${p.azimuth_deg})`}
                fill={p.tone}
              />
            )}
            <text x="11" y="4" className="floor-marker" fill={p.tone}>
              {p.label}
            </text>
          </g>
        ))}
        {point && (
          <g transform={`translate(${X(point.x)},${Y(point.y)})`}>
            <circle
              r="9"
              fill="#25303b"
              fillOpacity=".75"
              stroke="#fcfdff"
              strokeWidth="1.5"
            />
            <path
              d="M-14 0h9m10 0h9M0-14v9m0 10v9"
              stroke="#fcfdff"
              strokeWidth="1.4"
            />
            <circle r="2.8" fill="#fcfdff" />
          </g>
        )}
        {onPoint && (
          <rect
            x={left}
            y={top}
            width={width}
            height={depth}
            fill="transparent"
            className="map-target"
            onClick={select}
          />
        )}
      </svg>
    </div>
  );
}

export function EquipmentTable({ s }: { s: Snapshot }) {
  const entries: {
    label: string;
    kind: string;
    status: string;
    tone: ReturnType<typeof radioTone>;
  }[] = [
    {
      label: 'Донорная антенна',
      kind: 'Наружная · направленная',
      status: s.config.layout.donor.enabled ? 'Включена' : 'Выключена',
      tone: s.config.layout.donor.enabled ? 'good' : 'neutral',
    },
    {
      label: 'Репитер',
      kind: 'Двунаправленный · ' + s.config.profile.label,
      status: s.protection.label,
      tone: radioTone(s.protection.state),
    },
    ...s.config.filters.map((f): (typeof entries)[number] => ({
      label: f.label,
      kind: f.side === 'donor' ? 'Донорный тракт' : 'Внутренний тракт',
      status: f.healthy ? 'Исправен' : 'Отказ',
      tone: radioTone(f.healthy ? 'NORMAL' : 'FAIL'),
    })),
    {
      label: 'Делитель',
      kind: `${s.config.layout.panels.length} выхода · ${whole(s.config.radio.splitter_loss_db)} dB`,
      status: 'Пассивный',
      tone: 'neutral',
    },
    ...s.branches.map((b): (typeof entries)[number] => ({
      label: b.label,
      kind: 'Внутренняя панель',
      status: b.active
        ? 'Активна'
        : b.enabled
          ? 'Нет ретрансляции'
          : 'Выключена',
      tone: radioTone(b.active ? 'NORMAL' : 'OFF'),
    })),
    {
      label: 'Антенна и модем GSM',
      kind: 'Отдельная линия аварийных SMS',
      status: 'Только чтение',
      tone: 'neutral',
    },
  ];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Компонент</th>
            <th>Назначение</th>
            <th>Состояние</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.label}>
              <td>{e.label}</td>
              <td>{e.kind}</td>
              <td>
                <Chip tone={e.tone}>{e.status}</Chip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({
  s,
  phase,
  setPhase,
  point,
  setPoint,
  budget,
  history,
  events,
  openBudget,
}: {
  s: Snapshot;
  phase: Phase;
  setPhase: (phase: Phase) => void;
  point: XY;
  setPoint: (p: XY) => void;
  budget: Budget | null;
  history: Telemetry[];
  events: Event[];
  openBudget: () => void;
}) {
  const metrics = s.coverage[phase],
    previous = s.coverage.before,
    p = s.protection,
    r = s.config.radio;
  const layout = s.config.layout;
  const hall = layout.rooms?.find((room) => room.id === 'hall');
  const centerY = hall ? hall.y + hall.depth / 2 : layout.depth_m / 2;
  const presets = s.coverage.cells
    .filter((c) => c.working)
    .filter(
      (c) => Math.abs(c.y - centerY) < s.coverage.cell_depth_m / 2 + 0.001,
    );
  const dlBranch = s.branches.find((branch) => branch.id === budget?.dl_branch);
  const ulBranch = s.branches.find((branch) => branch.id === budget?.ul_branch);
  const shortcuts = [
    presets[Math.floor(presets.length * 0.15)],
    presets[Math.floor(presets.length * 0.5)],
    presets[Math.floor(presets.length * 0.85)],
  ];
  return (
    <>
      <section className="metrics" aria-label="Показатели покрытия и защиты">
        <article className="metric">
          <div className="metric-label">Покрытие DL</div>
          <div className="metric-value">
            {format(metrics.coverage_pct)}
            <small> %</small>
          </div>
          <p>
            Порог {whole(r.coverage_threshold_dbm)} dBm
            {phase === 'after' && <> · до {format(previous.coverage_pct)}%</>}
          </p>
        </article>
        <article className="metric">
          <div className="metric-label">Худший запас UL</div>
          <div
            className={`metric-value ${metrics.worst_ul_margin_db !== null && metrics.worst_ul_margin_db < 0 ? 'amber-text' : ''}`}
          >
            {format(metrics.worst_ul_margin_db)}
            <small> dB</small>
          </div>
          <p>{format(metrics.both_pct)}% площади проходят DL и UL</p>
        </article>
        <article className="metric">
          <div className="metric-label">Усиление DL / UL</div>
          <div className="metric-value">
            {whole(p.dl.applied_gain_db)}{' '}
            <span className="metric-divider">/</span>{' '}
            {whole(p.ul.applied_gain_db)}
            <small> dB</small>
          </div>
          <p>
            Запрос {whole(p.dl.requested_gain_db)} /{' '}
            {whole(p.ul.requested_gain_db)} dB
          </p>
        </article>
        <article className="metric">
          <div className="metric-label">Проверка GSM</div>
          <div
            className={`metric-value compact ${radioTone(p.gsm.status)}-text`}
          >
            <span className="status-dot" />
            {p.gsm.status === 'PASS'
              ? 'В пределах порогов'
              : p.gsm.status === 'FAIL'
                ? 'Порог превышен'
                : 'Нет данных'}
          </div>
          <p>Доставка SMS не проверяется</p>
        </article>
      </section>
      <div className="overview-grid">
        <Section
          className="coverage-panel"
          title="Карта покрытия"
          subtitle={`RSRP · ${format(layout.width_m, 2)} × ${format(layout.depth_m, 2)} м${layout.source ? ' · по чертежу' : ''}`}
          action={
            <div className="segmented" aria-label="Режим карты">
              <button
                aria-pressed={phase === 'before'}
                onClick={() => setPhase('before')}
              >
                До
              </button>
              <button
                aria-pressed={phase === 'after'}
                onClick={() => setPhase('after')}
              >
                После
              </button>
            </div>
          }
        >
          <FloorPlan s={s} phase={phase} point={point} onPoint={setPoint} />
          <div className="map-footer">
            <div className="map-legend">
              <span className="legend-unit">RSRP, dBm</span>
              <div className="legend-scale">
                <div
                  style={{ background: `linear-gradient(90deg,${gradient})` }}
                />
                <span>
                  <i>≤ −125</i>
                  <i>−110</i>
                  <i>−95</i>
                  <i>−80</i>
                  <i>≥ −65</i>
                </span>
              </div>
              <span className="legend-item">
                <i className="rack-key" />
                Стойка
              </span>
              {!!layout.rooms?.length && (
                <span className="legend-item">
                  <i className="wall-key" />
                  Перегородка
                </span>
              )}
              <span className="legend-item">
                <i className="null-key" />
                Нет сигнала
              </span>
            </div>
            <div className="map-summary">
              <span>
                Минимум <strong>{format(metrics.min_rsrp_dbm)} dBm</strong>
              </span>
              <span>
                Медиана <strong>{format(metrics.median_rsrp_dbm)} dBm</strong>
              </span>
            </div>
          </div>
        </Section>
        <Section
          className="point-panel"
          title="Контрольная точка"
          subtitle="Нажмите на карту для расчёта"
        >
          <div className="point-position">
            <Icon name="point" size={17} />
            <span>
              X {format(point.x, 2)} м <b>·</b> Y {format(point.y, 2)} м
            </span>
          </div>
          <div className="point-shortcuts" aria-label="Быстрый выбор точки">
            {shortcuts.map(
              (c, i) =>
                c && (
                  <button
                    key={i}
                    className="subtle"
                    aria-pressed={point.x === c.x && point.y === c.y}
                    onClick={() => setPoint(c)}
                  >
                    {['Слева', 'Центр', 'Справа'][i]}
                  </button>
                ),
            )}
          </div>
          <dl className="point-readings">
            <div>
              <dt>
                RSRP <small>Порог {whole(r.coverage_threshold_dbm)} dBm</small>
              </dt>
              <dd>
                {format(budget?.[`${phase}_dl_dbm`])} <small>dBm</small>
              </dd>
            </div>
            <div>
              <dt>
                Запас UL <small>Порог 0 dB</small>
              </dt>
              <dd
                className={
                  (budget?.[`${phase}_ul_margin_db`] ?? 0) < 0
                    ? 'amber-text'
                    : undefined
                }
              >
                {format(budget?.[`${phase}_ul_margin_db`])} <small>dB</small>
              </dd>
            </div>
          </dl>
          <p className="point-note">
            {budget?.signal_note ??
              (!budget ? (
                'Расчёт точки…'
              ) : !budget.working ? (
                'Точка на площади стойки'
              ) : phase === 'before' ? (
                'Базовое проникновение'
              ) : (
                <>
                  DL · {dlBranch?.label ?? 'базовый путь'}
                  <br />
                  UL · {ulBranch?.label ?? 'базовый путь'}
                </>
              ))}
          </p>
          <button className="point-link" onClick={openBudget}>
            Бюджет DL / UL <Icon name="arrow" size={16} />
          </button>
        </Section>
      </div>
      {!!s.coverage.rooms?.length && (
        <Section title="Покрытие по помещениям">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Помещение</th>
                  <th>Площадь по плану, м²</th>
                  <th>DL, %</th>
                  <th>DL и UL, %</th>
                </tr>
              </thead>
              <tbody>
                {s.coverage.rooms.map((entry) => {
                  const room = layout.rooms?.find(
                    (item) => item.id === entry.id,
                  );
                  return (
                    <tr key={entry.id}>
                      <td>{room?.label}</td>
                      <td className="number">
                        {format(room?.drawing_area_m2)}
                      </td>
                      <td className="number">
                        {format(entry[phase].coverage_pct)}
                      </td>
                      <td className="number">
                        {format(entry[phase].both_pct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <div className="overview-grid secondary-grid">
        <Suspense
          fallback={
            <Section title="Телеметрия">
              <p className="chart-empty">Загрузка графика…</p>
            </Section>
          }
        >
          <TelemetryChart history={history} />
        </Suspense>
        <Section title="Журнал событий">
          <div className="events">
            {events.length ? (
              events.map((e) => (
                <div className="event" key={e.seq}>
                  <time dateTime={e.timestamp}>{timeLabel(e.timestamp)}</time>
                  <span className={`event-dot ${radioTone(e.state ?? '')}`} />
                  <div>
                    <span>{e.label}</span>
                    <small>Модельное время {e.simulation_time} с</small>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Событий пока нет</p>
            )}
          </div>
        </Section>
      </div>
      <Section title="Состояние оборудования">
        <EquipmentTable s={s} />
      </Section>
    </>
  );
}
