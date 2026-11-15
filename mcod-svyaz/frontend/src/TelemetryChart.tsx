import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Telemetry } from './types';
import { Icon, Section, timeLabel } from './ui';

const signalSeries = [
  { key: 'rsrp_dbm', name: 'Медиана RSRP', color: '#2856a6' },
  { key: 'donor_rsrp_dbm', name: 'Донорный RSRP', color: '#22735e' },
  { key: 'donor_rssi_dbm', name: 'Донорный RSSI', color: '#9b5b27' },
] as const;
const gainSeries = [
  { key: 'gain_dl_db', name: 'Усиление DL', color: '#2856a6' },
] as const;

export default function TelemetryChart({ history }: { history: Telemetry[] }) {
  const [graph, setGraph] = useState<'rsrp' | 'gain'>('rsrp');
  const series = graph === 'rsrp' ? signalSeries : gainSeries;
  const unit = graph === 'rsrp' ? 'dBm' : 'dB';
  const samples = history.map((item, index) => ({ ...item, index: index + 1 }));
  return (
    <Section
      title="Телеметрия"
      subtitle={`Снимки: ${history.length} из 300`}
      action={
        <div className="segmented">
          <button
            aria-pressed={graph === 'rsrp'}
            onClick={() => setGraph('rsrp')}
          >
            Уровень
          </button>
          <button
            aria-pressed={graph === 'gain'}
            onClick={() => setGraph('gain')}
          >
            Усиление
          </button>
        </div>
      }
    >
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      {history.length < 2 ? (
        <div className="chart-empty">
          <Icon name="clock" />
          <p>Запустите сценарий или выполните шаг для графика.</p>
        </div>
      ) : (
        <div className="chart">
          <ResponsiveContainer width="100%" height={155}>
            <LineChart
              data={samples}
              margin={{ top: 12, right: 20, bottom: 2, left: -8 }}
            >
              <CartesianGrid stroke="#e4e9ef" vertical={false} />
              <XAxis
                dataKey="index"
                type="number"
                domain={[1, samples.length]}
                tickCount={6}
                allowDecimals={false}
                tick={{ fill: '#536272', fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                domain={graph === 'rsrp' ? ['auto', 'auto'] : [0, 'auto']}
                tick={{ fill: '#536272', fontSize: 11 }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #cbd4df',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelFormatter={(n) => {
                  const sample = history[Number(n) - 1];
                  return sample
                    ? `${timeLabel(sample.timestamp)} · t = ${sample.simulation_time} с`
                    : 'Снимок';
                }}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={`${s.name}, ${unit}`}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={history.length < 4}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}
