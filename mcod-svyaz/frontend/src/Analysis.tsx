import { useState } from 'react';
import type { Budget, Gsm, Phase, Row, Snapshot, XY } from './types';
import { api } from './api';
import { EquipmentTable, FloorPlan } from './Overview';
import { Chip, format, Icon, radioTone, Section, whole } from './ui';

function Rows({ rows }: { rows: Row[] }) {
  if (!rows.length)
    return (
      <p className="body muted">
        Полезный сигнал отсутствует в заданных условиях.
      </p>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Узел и точка отсчёта</th>
            <th>Значение</th>
            <th>Уровень, dBm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.label}</td>
              <td className="number">
                {format(r.value)} {r.unit}
              </td>
              <td className="number">{format(r.total_dbm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spectrum({ gsm }: { gsm: Gsm }) {
  const x = (mhz: number) => 50 + (mhz * 760) / maxFrequency;
  const maxFrequency = Math.max(
    3600,
    ...gsm.components.map((c) => c.frequency_mhz + 100),
    ...gsm.protected_bands.map((b) => b.high_mhz + 100),
  );
  const ticks =
    maxFrequency <= 3600
      ? [0, 900, 1800, 2700, 3600]
      : [0, 1, 2, 3, 4].map((i) => Math.round((i * maxFrequency) / 4));
  return (
    <svg
      className="spectrum"
      viewBox="0 0 860 128"
      role="img"
      aria-label="Расчётные частотные компоненты и защищаемые окна"
    >
      <rect x="50" y="18" width="760" height="72" rx="5" fill="#eef2f7" />
      {gsm.protected_bands.map((b) => (
        <rect
          key={b.low_mhz}
          x={x(b.low_mhz)}
          width={Math.max(2, x(b.high_mhz) - x(b.low_mhz))}
          y="18"
          height="72"
          fill="#d99540"
          opacity=".45"
        >
          <title>
            {b.low_mhz}–{b.high_mhz} МГц
          </title>
        </rect>
      ))}
      {gsm.components.map((c, i) => (
        <g key={i} opacity={c.enabled ? 1 : 0.5}>
          <path
            d={`M${x(c.frequency_mhz)},89v-${38 + (i % 3) * 7}`}
            stroke="#2452a4"
            strokeWidth="2"
          />
          <circle
            cx={x(c.frequency_mhz)}
            cy={51 - (i % 3) * 7}
            r="3"
            fill="#2452a4"
          >
            <title>
              {c.label} · {c.frequency_mhz} МГц
            </title>
          </circle>
        </g>
      ))}
      {ticks.map((n) => (
        <g key={n}>
          <path d={`M${x(n)},90v6`} stroke="#58697a" />
          <text
            x={x(n)}
            y="111"
            textAnchor="middle"
            fill="#536272"
            fontSize="12"
          >
            {n}
          </text>
        </g>
      ))}
      <text x="834" y="111" textAnchor="middle" fill="#536272" fontSize="11">
        МГц
      </text>
    </svg>
  );
}

function GsmDetails({ gsm }: { gsm: Gsm }) {
  return (
    <>
      <div className="body form-blocks">
        <p className="muted">
          Допущение; требуется подтверждение параметрами модема. Доставка SMS не
          проверяется.
        </p>
        <div className="actions">
          <span>Внеполосная мощность {format(gsm.blocker_dbm)} dBm</span>
          <span className="muted">
            Предел {format(gsm.blocker_limit_dbm)} dBm
          </span>
        </div>
        {gsm.missing.length > 0 && (
          <p className="inline-warning">
            Недостаточно данных: {gsm.missing.join(', ')}.
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Контрольный канал</th>
              <th>Полоса</th>
              <th>Мощность на GSM-входе</th>
              <th>Модельный предел</th>
            </tr>
          </thead>
          <tbody>
            {gsm.channels.map((ch, i) => (
              <tr key={i}>
                <td>{whole(ch.center_mhz)} МГц</td>
                <td>{whole(ch.bandwidth_khz)} кГц</td>
                <td className={ch.exceeded ? 'danger-text' : ''}>
                  {format(ch.power_dbm)} dBm
                </td>
                <td>{format(ch.limit_dbm)} dBm</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Spectrum gsm={gsm} />
      <p className="spectrum-caption">
        Расчётные частотные компоненты; не измерение анализатором. Высота
        маркеров условна.
      </p>
      {gsm.components.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Источник / узел</th>
                <th>Частота / полоса</th>
                <th>В узле</th>
                <th>Фильтр / путь</th>
                <th>На GSM-входе</th>
              </tr>
            </thead>
            <tbody>
              {gsm.components.map((c, i) => (
                <tr key={i}>
                  <td>
                    <strong>{c.label}</strong>
                    <small>
                      {c.node === 'external'
                        ? 'Внешний'
                        : c.node === 'before_service_filter'
                          ? 'До выходного фильтра'
                          : 'После выходного фильтра'}{' '}
                      · {c.origin}
                    </small>
                  </td>
                  <td>
                    {whole(c.frequency_mhz)} МГц
                    <small>
                      {c.bandwidth_khz === 0
                        ? 'Узкий тон'
                        : `${c.bandwidth_khz} кГц`}
                      {c.protected_band_hit ? ' · в окне' : ''}
                    </small>
                  </td>
                  <td className="number">{format(c.power_dbm)} dBm</td>
                  <td className="number">
                    {whole(c.filter_loss_db)} / {whole(c.coupling_loss_db)} dB
                  </td>
                  <td className="number">
                    {c.enabled
                      ? `${format(c.receiver_dbm)} dBm`
                      : 'Источник отключён'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ImdCalculator({ s }: { s: Snapshot }) {
  const [tones, setTones] = useState(['1740', '2530']);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof api.products>
  > | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Section
      title="Двухтональный калькулятор"
      subtitle="Частоты 2f₁ − f₂ и 2f₂ − f₁ и попадание в модельные окна GSM"
    >
      <form
        className="body form-blocks"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError('');
          try {
            setResult(
              await api.products(s.site_id, tones[0], tones[1], s.snapshot_id),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Расчёт не выполнен');
          } finally {
            setPending(false);
          }
        }}
      >
        <div className="actions">
          {tones.map((tone, i) => (
            <label className="field" key={i}>
              <span>Тон {i + 1}, МГц</span>
              <input
                type="number"
                min="0.001"
                max="10000"
                step="any"
                required
                value={tone}
                onChange={(e) => {
                  setTones((values) =>
                    values.map((v, j) => (j === i ? e.target.value : v)),
                  );
                  setResult(null);
                }}
              />
            </label>
          ))}
          <button type="submit" disabled={pending} style={{ alignSelf: 'end' }}>
            Рассчитать
          </button>
        </div>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {result && (
          <div className="actions" role="status">
            {result.products.map((p, i) => (
              <Chip key={i} tone={p.protected_band_hit ? 'warning' : 'neutral'}>
                {format(p.frequency_mhz)} МГц ·{' '}
                {p.protected_band_hit
                  ? 'в защищаемом окне'
                  : 'за пределами окон'}
              </Chip>
            ))}
          </div>
        )}
        <p className="muted">
          Частотное совпадение указывает на возможный путь воздействия. Уровень
          зависит от нелинейного узла, фильтров и потерь до модема.
        </p>
      </form>
    </Section>
  );
}

export function Analysis({
  s,
  budget,
  phase,
  setPhase,
  point,
}: {
  s: Snapshot;
  budget: Budget | null;
  phase: Phase;
  setPhase: (p: Phase) => void;
  point: XY;
}) {
  const p = s.protection;
  return (
    <>
      <Section
        title="Устойчивость и ограничения"
        subtitle={p.reason}
        action={<Chip tone={radioTone(p.state)}>{p.label}</Chip>}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Направление</th>
                <th>Запрос → факт, dB</th>
                <th>Изоляция, dB</th>
                <th>Запас, dB</th>
                <th>Полная мощность выход / предел, dBm</th>
                <th>Определяющий предел</th>
              </tr>
            </thead>
            <tbody>
              {(['dl', 'ul'] as const).map((key) => (
                <tr key={key}>
                  <td>{key.toUpperCase()}</td>
                  <td>
                    {whole(p[key].requested_gain_db)} →{' '}
                    {whole(p[key].applied_gain_db)}
                  </td>
                  <td>{whole(p[key].isolation_db)}</td>
                  <td>{whole(p[key].stability_margin_db)}</td>
                  <td>
                    {format(p[key].output_power_dbm)} /{' '}
                    {format(p[key].max_output_dbm)}
                  </td>
                  <td>{p[key].limiter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="body muted">
          Требуемый запас {whole(p.required_margin_db)} dB. Мощность и
          дополнительное ограничение UL зависят от контрольной точки.
        </p>
      </Section>
      <Section
        title="Бюджет контрольной точки"
        subtitle={`X ${format(point.x, 2)} м · Y ${format(point.y, 2)} м`}
        action={
          <div className="segmented">
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
        {budget ? (
          <div className="budget-grid">
            <div>
              <h3>
                Downlink <span>{format(budget[`${phase}_dl_dbm`])} dBm</span>
              </h3>
              <Rows rows={budget[`${phase}_dl_rows`]} />
            </div>
            <div>
              <h3>
                Uplink{' '}
                <span>запас {format(budget[`${phase}_ul_margin_db`])} dB</span>
              </h3>
              <Rows rows={budget[`${phase}_ul_rows`]} />
              <p className="body muted">
                Порог приёмника БС {whole(budget.base_receiver_threshold_dbm)}{' '}
                dBm.
              </p>
            </div>
          </div>
        ) : (
          <p className="body muted">Расчёт контрольной точки…</p>
        )}
      </Section>
      <Section
        title="Воздействие на GSM"
        subtitle="Текущий снимок после действий защиты"
        action={<Chip tone={radioTone(p.gsm.status)}>{p.gsm.status}</Chip>}
      >
        <GsmDetails gsm={p.gsm} />
      </Section>
      {s.trip_gsm && (
        <Section
          title="Причина отключения"
          subtitle="Последний расчёт GSM до срабатывания защиты"
          action={<Chip tone="danger">FAIL</Chip>}
        >
          <GsmDetails gsm={s.trip_gsm} />
        </Section>
      )}
      <ImdCalculator key={s.site_id + ':' + s.config_revision} s={s} />
      <Section title="Фильтры и границы модели">
        <div className="body form-blocks">
          {s.config.filters.map((f) => (
            <div key={f.id}>
              <strong>{f.label}</strong> ·{' '}
              {f.side === 'donor'
                ? 'между донором и репитером'
                : 'между репитером и делителем'}{' '}
              · {f.healthy ? 'исправен' : 'отказ'}
              <p className="muted">
                Полоса{' '}
                {f.passbands
                  .map((b) => `${b.low_mhz}–${b.high_mhz}`)
                  .join(', ')}{' '}
                МГц · потери {f.insertion_loss_db} dB · подавление{' '}
                {f.stop_loss_db} dB в заданных окнах.
              </p>
            </div>
          ))}
          <p className="muted">
            Band 7 входит в диапазон антенны 790–2700 МГц. Проверки частотных
            окон, побочных составляющих, интермодуляции и перегрузки используют
            синтетические данные. Положение нелинейного узла определяет, ослабит
            ли фильтр его продукт.
          </p>
        </div>
      </Section>
    </>
  );
}

export function Report({ s, point }: { s: Snapshot; point: XY }) {
  const nodes = [
    'БС оператора',
    'Донорная антенна',
    'Донорный тракт',
    'Репитер',
    'Выходной фильтр',
    'Делитель',
    'Панели',
  ];
  return (
    <>
      <Section
        title="Отчёт по снимку"
        subtitle={`Ревизия ${s.config_revision} · модель ${s.model_version} · t = ${s.simulation_time} с`}
        action={
          <div className="actions">
            <a
              className="button"
              href={api.report(s.site_id, 'md', point, s.snapshot_id)}
            >
              <Icon name="download" size={16} /> Markdown
            </a>
            <a
              className="button"
              href={api.report(s.site_id, 'json', point, s.snapshot_id)}
            >
              <Icon name="download" size={16} /> JSON
            </a>
            <a
              className="button primary"
              href={api.report(s.site_id, 'html', point, s.snapshot_id)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="print" size={16} /> Печать
            </a>
          </div>
        }
      >
        <p className="body muted">
          Отчёт включает карту в данных JSON, показатели «до / после», защиту
          GSM, оборудование, журнал и бюджеты точки X {format(point.x, 2)} м · Y{' '}
          {format(point.y, 2)} м.
        </p>
      </Section>
      <Section title="Схема подключения" subtitle="Раздельные кабельные тракты">
        <div className="body form-blocks">
          <div className="topology">
            {nodes.map((node, i) => (
              <div key={node}>
                <span>{node}</span>
                {i < nodes.length - 1 && <b aria-hidden="true">↔</b>}
              </div>
            ))}
          </div>
          <div className="topology gsm-path">
            <div>
              <span>Существующая GSM-антенна</span>
              <b aria-hidden="true">↔</b>
            </div>
            <div>
              <span>Существующий GSM-модем</span>
            </div>
          </div>
        </div>
      </Section>
      <Section
        title="Схема размещения"
        subtitle={
          s.config.layout.source
            ? 'Помещения по чертежу · координаты антенн заданы для расчёта'
            : 'Модельные координаты оборудования'
        }
      >
        <FloorPlan s={s} phase="after" point={point} />
      </Section>
      <Section title="Состав оборудования">
        <EquipmentTable s={s} />
        <p className="body muted">
          Класс компонента выбран; конкретная модель не подтверждена.
        </p>
      </Section>
      <Section title="Допущения">
        <div className="body form-blocks">
          <p>
            Частотный профиль, антенны и источники воздействия заданы для
            симуляции. Фактические каналы GSM и параметры модема нужно уточнить.
          </p>
          <p>
            Требуется проверка на реальном оборудовании. Покрытие LTE само по
            себе не подтверждает голосовую связь. Телефоны, SIM, VoLTE и сеть
            оператора проверяются отдельно.
          </p>
        </div>
      </Section>
    </>
  );
}
