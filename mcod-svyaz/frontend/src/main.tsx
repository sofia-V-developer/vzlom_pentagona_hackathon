import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import { Analysis, Report } from './Analysis';
import { api } from './api';
import { Overview } from './Overview';
import { Settings } from './Settings';
import type {
  Budget,
  Event,
  Page,
  Phase,
  Scenario,
  Site,
  Snapshot,
  Telemetry,
  XY,
} from './types';
import { Chip, Icon, radioTone, timeLabel } from './ui';
import './style.css';

const pages: { id: Page; name: string }[] = [
  { id: 'overview', name: 'Обзор' },
  { id: 'settings', name: 'Настройки' },
  { id: 'emc', name: 'ЭМС и расчёты' },
  { id: 'report', name: 'Оборудование и отчёт' },
];
const subtitles: Partial<Record<Page, string>> = {
  settings: 'Входные условия, конфигурация оборудования и модельные пороги',
  emc: 'Пошаговый бюджет радиолинии, устойчивость и воздействие на GSM',
  report: 'Схема подключения, размещение и экспорт расчётов',
};
function pageFromHash(): Page {
  const value = location.hash.slice(1);
  return pages.find((page) => page.id === value)?.id ?? 'overview';
}

function selectPoint(snapshot: Snapshot, picked?: XY) {
  const { width_m: width, depth_m: depth, rooms } = snapshot.config.layout;
  if (picked && picked.x <= width && picked.y <= depth) return picked;
  const hall = rooms?.find((room) => room.id === 'hall');
  const center = hall
    ? { x: hall.x + hall.width / 2, y: hall.y + hall.depth / 2 }
    : { x: width / 2, y: depth / 2 };
  const distance = (c: XY) => Math.hypot(c.x - center.x, c.y - center.y);
  return snapshot.coverage.cells.reduce<XY>(
    (best, c) => (c.working && distance(c) < distance(best) ? c : best),
    snapshot.coverage.cells.find((c) => c.working) ?? center,
  );
}

function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [sites, setSites] = useState<Site[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [siteId, setSiteId] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Telemetry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [phase, setPhase] = useState<Phase>('after');
  const [picked, setPicked] = useState<(XY & { site: string }) | undefined>();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [budgetError, setBudgetError] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [commandError, setCommandError] = useState('');
  const [busy, setBusy] = useState(false);
  const [seedDraft, setSeedDraft] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const currentSite = useRef(siteId);
  currentSite.current = siteId;
  const s = snapshot?.site_id === siteId ? snapshot : null;
  const point = s
    ? selectPoint(s, picked?.site === siteId ? picked : undefined)
    : null;
  const pointX = point?.x,
    pointY = point?.y,
    snapshotId = s?.snapshot_id;
  const currentBudget =
    budget?.snapshot_id === snapshotId &&
    budget?.point.x === pointX &&
    budget?.point.y === pointY
      ? budget
      : null;

  useEffect(() => {
    const onHash = () => {
      setPage(pageFromHash());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    let disposed = false;
    Promise.all([api.sites(), api.scenarios()])
      .then(([available, presets]) => {
        if (disposed) return;
        setSites(available);
        setScenarios(presets);
        setError('');
        const saved = sessionStorage.getItem('mcod-site');
        setSiteId(
          (id) =>
            id ||
            available.find((item) => item.id === saved)?.id ||
            available[0]?.id ||
            '',
        );
      })
      .catch(() => {
        if (!disposed)
          setError('Сервер недоступен. Проверьте запуск приложения.');
      });
    return () => {
      disposed = true;
    };
  }, [reload]);
  useEffect(() => {
    if (!siteId) return;
    let disposed = false,
      pending = false;
    setEvents([]);
    setHistory([]);
    const poll = async () => {
      if (pending) return;
      pending = true;
      const epoch = generation.current;
      try {
        const [fresh, samples, log] = await Promise.all([
          api.snapshot(siteId),
          api.history(siteId),
          api.events(siteId),
        ]);
        if (!disposed && epoch === generation.current) {
          setSnapshot(fresh);
          setHistory(samples);
          setEvents(log);
          setConnected(true);
          setError('');
        }
      } catch {
        if (!disposed && epoch === generation.current) {
          setConnected(false);
          setError(
            'Связь с сервером потеряна. Показан последний доступный снимок.',
          );
        }
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [siteId, reload]);
  useEffect(() => {
    if (!snapshotId || pointX === undefined || pointY === undefined) return;
    let disposed = false;
    api
      .budget(siteId, { x: pointX, y: pointY }, snapshotId)
      .then((value) => {
        if (!disposed) {
          setBudget(value);
          setBudgetError('');
        }
      })
      .catch(() => {
        if (!disposed)
          setBudgetError('Не удалось загрузить бюджет контрольной точки.');
      });
    return () => {
      disposed = true;
    };
  }, [siteId, snapshotId, pointX, pointY]);

  function commit(next: Snapshot) {
    generation.current++;
    if (currentSite.current === next.site_id) {
      setSnapshot(next);
      setSites((all) =>
        all.map((site) =>
          site.id === next.site_id
            ? { ...site, label: next.config.label }
            : site,
        ),
      );
      void Promise.all([api.history(next.site_id), api.events(next.site_id)])
        .then(([samples, log]) => {
          if (currentSite.current === next.site_id) {
            setHistory(samples);
            setEvents(log);
          }
        })
        .catch(() => {});
    }
  }
  async function command(run: () => Promise<Snapshot>) {
    setBusy(true);
    setCommandError('');
    try {
      commit(await run());
    } catch (e) {
      setCommandError(e instanceof Error ? e.message : 'Команда не выполнена');
    } finally {
      setBusy(false);
    }
  }
  const nav = pages.find((item) => item.id === page)!;
  const activeScenario = scenarios.find((preset) => preset.id === s?.scenario);
  const applySeed = (preset: string, seed: number) =>
    void command(() => api.scenario(siteId, preset, seed));

  return (
    <>
      <header className="topbar">
        <div className="masthead shell">
          <a className="brand" href="#overview" aria-label="МЦОД Связь — обзор">
            <span className="brand-icon">
              <Icon name="signal" size={22} />
            </span>
            МЦОД Связь
          </a>
          <div className="masthead-context">
            <div className="select-icon">
              <Icon name="server" size={17} />
              <select
                aria-label="Выбрать МЦОД"
                value={siteId}
                disabled={!sites.length}
                onChange={(e) => {
                  sessionStorage.setItem('mcod-site', e.target.value);
                  setSiteId(e.target.value);
                  setSeedDraft('');
                  setCommandError('');
                  setBudgetError('');
                }}
              >
                {!sites.length && <option value="">Загрузка МЦОД…</option>}
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={15} />
            </div>
          </div>
        </div>
        <div className="nav-row shell">
          <nav aria-label="Разделы">
            {pages.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-label={item.name}
                aria-current={page === item.id ? 'page' : undefined}
              >
                {item.id === 'report' ? (
                  <>
                    <span className="nav-full-label">{item.name}</span>
                    <span className="nav-short-label">Отчёт</span>
                  </>
                ) : (
                  item.name
                )}
              </a>
            ))}
          </nav>
          <div className="connection">
            <span className={`dot ${connected ? 'good-text' : 'amber-text'}`} />
            {connected ? 'Сервер доступен' : 'Ожидание сервера'}
          </div>
        </div>
      </header>
      <main className="shell">
        <div className="page-head">
          <div>
            <h1>{page === 'overview' ? 'Обзор покрытия' : nav.name}</h1>
            {subtitles[page] && <p>{subtitles[page]}</p>}
          </div>
          {s && page === 'overview' && (
            <dl className="profile">
              <div>
                <dt>Профиль</dt>
                <dd>{s.config.profile.label}</dd>
              </div>
              <div>
                <dt>DL / UL</dt>
                <dd>
                  {s.config.profile.dl_mhz} / {s.config.profile.ul_mhz} МГц
                </dd>
              </div>
            </dl>
          )}
        </div>
        {error && (
          <div className="connection-error" role="alert">
            <Icon name="info" />
            {error}
            <button onClick={() => setReload((n) => n + 1)}>Повторить</button>
          </div>
        )}
        {!s || !point ? (
          <div className="panel body" role="status">
            {error ? 'Снимок пока недоступен.' : 'Загрузка расчётного снимка…'}
          </div>
        ) : (
          <>
            <section
              className="scenario-panel"
              aria-label="Управление симуляцией"
            >
              <div className="scenario-row">
                <div className="scenario-select">
                  <label htmlFor="scenario-select">Сценарий</label>
                  <select
                    id="scenario-select"
                    value={s.scenario}
                    disabled={busy}
                    onChange={(e) => {
                      setSeedDraft('');
                      applySeed(e.target.value, s.seed);
                    }}
                  >
                    {scenarios.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="scenario-buttons">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void command(() =>
                        api.control(siteId, s.running ? 'pause' : 'start'),
                      )
                    }
                  >
                    <Icon name={s.running ? 'pause' : 'play'} size={16} />
                    {s.running ? 'Пауза' : 'Запустить'}
                  </button>
                  <button
                    disabled={s.running || busy}
                    onClick={() =>
                      void command(() => api.control(siteId, 'step'))
                    }
                  >
                    <Icon name="step" size={16} />
                    Следующий шаг
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command(() => api.control(siteId, 'reset'))
                    }
                  >
                    <Icon name="reset" size={16} />
                    Сбросить
                  </button>
                </div>
                <div className="model-time">
                  <Icon name="clock" size={17} />
                  <span>Модельное время</span>
                  <strong>{s.simulation_time} с</strong>
                </div>
              </div>
              <div className="scenario-meta">
                <div>
                  <Chip tone={radioTone(s.protection.state)}>
                    {s.protection.label}
                  </Chip>
                  <span>
                    {s.protection.reason === 'Пределы соблюдены'
                      ? s.scenario === 'normal'
                        ? 'Запрошенное усиление применено'
                        : activeScenario?.description
                      : s.protection.reason}
                  </span>
                </div>
                {s.protection.latched && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void command(() => api.control(siteId, 'clear-trip'))
                    }
                  >
                    Сбросить защиту
                  </button>
                )}
                <details className="seed">
                  <summary title="Начальное число генератора">
                    Seed {s.seed}
                  </summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      applySeed(s.scenario, Number(seedDraft || s.seed));
                      setSeedDraft('');
                    }}
                  >
                    <label>
                      Seed{' '}
                      <input
                        type="number"
                        min="0"
                        max="4294967295"
                        step="1"
                        value={seedDraft || s.seed}
                        onChange={(e) => setSeedDraft(e.target.value)}
                      />
                    </label>
                    <button disabled={busy}>Применить</button>
                  </form>
                </details>
              </div>
              {commandError && (
                <pre className="inline-error" role="alert">
                  {commandError}
                </pre>
              )}
            </section>
            {budgetError && page !== 'settings' && (
              <p className="inline-error" role="alert">
                {budgetError}
              </p>
            )}
            {page === 'overview' && (
              <Overview
                s={s}
                phase={phase}
                setPhase={setPhase}
                point={point}
                setPoint={(p) => setPicked({ x: p.x, y: p.y, site: siteId })}
                budget={currentBudget}
                history={history.filter(
                  (sample) => sample.timestamp <= s.timestamp,
                )}
                events={events.filter(
                  (event) => event.timestamp <= s.timestamp,
                )}
                openBudget={() => {
                  location.hash = 'emc';
                }}
              />
            )}
            {page === 'settings' && (
              <Settings key={siteId} s={s} onCommit={commit} />
            )}
            {page === 'emc' && (
              <Analysis
                s={s}
                budget={currentBudget}
                phase={phase}
                setPhase={setPhase}
                point={point}
              />
            )}
            {page === 'report' && <Report s={s} point={point} />}
            <footer>
              <span>МЦОД Связь</span>
              <span>
                Снимок {timeLabel(s.timestamp)} · ревизия {s.config_revision} ·
                модель {s.model_version}
              </span>
            </footer>
          </>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
