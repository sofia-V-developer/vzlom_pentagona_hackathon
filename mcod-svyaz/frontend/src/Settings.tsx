import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { api } from './api';
import type { Band, Config, ConfigResponse, Snapshot } from './types';
import { Icon, Section } from './ui';

function Num({
  label,
  unit,
  value,
  change,
  optional = false,
}: {
  label: string;
  unit: string;
  value: number | null;
  change: (n: number | null) => void;
  optional?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          type="number"
          step="any"
          value={value ?? ''}
          required={!optional}
          onChange={(e) =>
            change(e.target.value === '' ? null : e.target.valueAsNumber)
          }
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}
function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}
function Bands({
  values,
  update,
  max,
}: {
  values: Band[];
  update: (values: Band[]) => void;
  max: number;
}) {
  return (
    <div className="band-editor">
      {values.map((band, i) => (
        <div className="band-row" key={i}>
          <Num
            label="Начало"
            unit="МГц"
            value={band.low_mhz}
            change={(n) =>
              update(
                values.map((b, j) => (j === i ? { ...b, low_mhz: n ?? 0 } : b)),
              )
            }
          />
          <Num
            label="Конец"
            unit="МГц"
            value={band.high_mhz}
            change={(n) =>
              update(
                values.map((b, j) =>
                  j === i ? { ...b, high_mhz: n ?? 0 } : b,
                ),
              )
            }
          />
          <button
            type="button"
            onClick={() => update(values.filter((_, j) => j !== i))}
          >
            Удалить
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={values.length >= max}
        onClick={() => update([...values, { low_mhz: 935, high_mhz: 960 }])}
      >
        Добавить окно
      </button>
    </div>
  );
}

export function Settings({
  s,
  onCommit,
}: {
  s: Snapshot;
  onCommit: (s: Snapshot) => void;
}) {
  const [base, setBase] = useState<ConfigResponse | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  async function load() {
    const result = await api.config(s.site_id);
    setBase(result);
    setDraft(result.config);
  }
  useEffect(() => {
    let disposed = false;
    api
      .config(s.site_id)
      .then((result) => {
        if (!disposed) {
          setBase(result);
          setDraft(result.config);
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [s.site_id]);

  function patch(edit: (config: Config) => void) {
    setDraft((current) => {
      if (!current) return current;
      const copy = structuredClone(current);
      edit(copy);
      return copy;
    });
    setNotice('');
  }

  async function operation(run: () => Promise<void>) {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Операция не выполнена');
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!base || !draft) return;
    void operation(async () => {
      const result = await api.save(s.site_id, base.config_revision, draft);
      onCommit(result);
      await load();
      setNotice('Конфигурация сохранена');
    });
  }

  if (!draft || !base)
    return (
      <Section title="Настройки">
        <div className="body">
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button onClick={() => void operation(load)}>Повторить</button>
            </>
          ) : (
            'Загрузка конфигурации…'
          )}
        </div>
      </Section>
    );
  const { radio, repeater, layout, gsm_criteria: gsm, profile } = draft;
  return (
    <form onSubmit={submit} className="settings-form">
      <Section
        title="Конфигурация"
        subtitle={`Базовая ревизия ${base.config_revision} · ${draft.label}`}
        action={
          <div className="actions">
            <a className="button" href={api.exportConfig(s.site_id)}>
              <Icon name="download" size={16} /> JSON
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() => upload.current?.click()}
            >
              <Icon name="upload" size={16} /> Импорт
            </button>
            <button className="primary" disabled={busy} type="submit">
              Применить
            </button>
          </div>
        }
      >
        <div className="body">
          <p className="muted">
            Сценарии накладывают временные изменения поверх сохранённой
            конфигурации.
          </p>
          {base.config_revision !== s.config_revision && (
            <p className="inline-warning">
              На сервере есть более новая ревизия.{' '}
              <button type="button" onClick={() => void operation(load)}>
                Загрузить
              </button>
            </p>
          )}
          {notice && (
            <p className="good-text" role="status">
              {notice}
            </p>
          )}
          {error && (
            <pre className="inline-error" role="alert">
              {error}
            </pre>
          )}
          <input
            ref={upload}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void operation(async () => {
                if (file.size > 500_000)
                  throw new Error('Размер JSON превышает 500 КБ');
                const parsed = JSON.parse(await file.text());
                const candidate = parsed?.config ?? parsed;
                const result = await api.save(
                  s.site_id,
                  base.config_revision,
                  candidate,
                );
                onCommit(result);
                await load();
                setNotice('JSON загружен и применён');
              });
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void operation(async () => {
                onCommit(await api.restore(s.site_id));
                await load();
                setNotice('Демонстрационная конфигурация восстановлена');
              })
            }
          >
            <Icon name="reset" size={16} /> Вернуть демонстрационные настройки
          </button>
        </div>
      </Section>
      <Section title="Профиль оператора и репитер">
        <div className="body form-blocks">
          <div className="fields">
            <Num
              label="Центр DL"
              unit="МГц"
              value={profile.dl_mhz}
              change={(n) =>
                patch((c) => {
                  c.profile.dl_mhz = n ?? 0;
                })
              }
            />
            <Num
              label="Центр UL"
              unit="МГц"
              value={profile.ul_mhz}
              change={(n) =>
                patch((c) => {
                  c.profile.ul_mhz = n ?? 0;
                })
              }
            />
            <Num
              label="Ширина канала"
              unit="МГц"
              value={profile.bandwidth_mhz}
              change={(n) =>
                patch((c) => {
                  c.profile.bandwidth_mhz = n ?? 0;
                })
              }
            />
            <Num
              label="Требуемый запас устойчивости"
              unit="dB"
              value={repeater.required_margin_db}
              change={(n) =>
                patch((c) => {
                  c.repeater.required_margin_db = n ?? 0;
                })
              }
            />
          </div>
          <div className="actions">
            <label className="field">
              <span>Режим</span>
              <select
                value={repeater.mode}
                onChange={(e) =>
                  patch((c) => {
                    c.repeater.mode =
                      e.target.value === 'manual' ? 'manual' : 'auto';
                  })
                }
              >
                <option value="auto">Автоматический</option>
                <option value="manual">Ручной запрос</option>
              </select>
            </label>
            <Toggle
              checked={repeater.enabled}
              onChange={(value) =>
                patch((c) => {
                  c.repeater.enabled = value;
                })
              }
            >
              Репитер включён
            </Toggle>
          </div>
          {(['dl', 'ul'] as const).map((direction) => (
            <fieldset key={direction}>
              <legend>{direction.toUpperCase()}</legend>
              <div className="fields">
                {(
                  [
                    ['requested_gain_db', 'Запрошенное усиление', 'dB'],
                    ['max_gain_db', 'Предел усиления', 'dB'],
                    ['max_output_dbm', 'Предел полной мощности', 'dBm'],
                    ['isolation_db', 'Межантенная изоляция', 'dB'],
                  ] as const
                ).map(([key, label, unit]) => (
                  <Num
                    key={key}
                    label={label}
                    unit={unit}
                    value={repeater[direction][key]}
                    change={(n) =>
                      patch((c) => {
                        c.repeater[direction][key] = n ?? 0;
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Section>
      <Section title="Наружный сигнал и радиолиния">
        <div className="body fields">
          {(
            [
              [
                'donor_rsrp_dbm',
                'RSRP на выходе донорной антенны',
                'dBm',
                true,
              ],
              [
                'donor_rssi_dbm',
                'RSSI на выходе донорной антенны',
                'dBm',
                true,
              ],
              ['facade_rsrp_dbm', 'RSRP у наружной грани', 'dBm', true],
              ['envelope_loss_db', 'Затухание оболочки', 'dB', false],
              ['splitter_loss_db', 'Потери делителя', 'dB', false],
              ['path_exponent', 'Показатель потерь n', '', false],
              ['phone_power_dbm', 'Мощность телефона', 'dBm', false],
              ['outdoor_path_loss_db', 'Потери до БС', 'dB', false],
              [
                'base_receiver_threshold_dbm',
                'Порог приёмника БС',
                'dBm',
                false,
              ],
              ['coverage_threshold_dbm', 'Модельный порог RSRP', 'dBm', false],
            ] as const
          ).map(([key, label, unit, optional]) => (
            <Num
              key={key}
              label={label}
              unit={unit}
              value={radio[key]}
              optional={optional}
              change={(n) =>
                patch((c) => {
                  if (optional) c.radio[key] = n;
                  else c.radio[key] = n ?? 0;
                })
              }
            />
          ))}
        </div>
      </Section>
      <Section title="Планировка и антенны">
        <div className="body form-blocks">
          <div className="fields">
            {(
              [
                ['width_m', 'Длина'],
                ['depth_m', 'Ширина'],
                ['height_m', 'Высота'],
                ['receiver_height_m', 'Высота телефона'],
              ] as const
            ).map(([key, label]) => (
              <Num
                key={key}
                label={label}
                unit="м"
                value={layout[key]}
                change={(n) =>
                  patch((c) => {
                    c.layout[key] = n ?? 0;
                  })
                }
              />
            ))}
          </div>
          {[...layout.panels, layout.donor].map((panel, i) => {
            const target = (c: Config) =>
              i < c.layout.panels.length ? c.layout.panels[i] : c.layout.donor;
            return (
              <fieldset key={panel.id}>
                <legend>{panel.label}</legend>
                <div className="fields">
                  {(
                    [
                      ['x', 'X', 'м'],
                      ['y', 'Y', 'м'],
                      ['z', 'Z', 'м'],
                      ['azimuth_deg', 'Азимут', '°'],
                      ['beamwidth_deg', 'Ширина диаграммы', '°'],
                      ['gain_dbi', 'Усиление', 'dBi'],
                      ['back_loss_db', 'Предел заднего ослабления', 'dB'],
                      ['cable_loss_db', 'Потери кабеля', 'dB'],
                    ] as const
                  ).map(([key, label, unit]) => (
                    <Num
                      key={key}
                      label={label}
                      unit={unit}
                      value={panel[key]}
                      change={(n) =>
                        patch((c) => {
                          target(c)[key] = n ?? 0;
                        })
                      }
                    />
                  ))}
                  <Toggle
                    checked={panel.enabled}
                    onChange={(value) =>
                      patch((c) => {
                        target(c).enabled = value;
                      })
                    }
                  >
                    Включена
                  </Toggle>
                </div>
              </fieldset>
            );
          })}
          <details>
            <summary>Препятствия</summary>
            <div className="form-blocks">
              {layout.obstacles.map((o, i) => (
                <fieldset key={o.id}>
                  <legend>{o.label}</legend>
                  <div className="fields">
                    {(
                      [
                        ['x', 'X', 'м'],
                        ['y', 'Y', 'м'],
                        ['z', 'Z', 'м'],
                        ['width', 'Длина', 'м'],
                        ['depth', 'Ширина', 'м'],
                        ['height', 'Высота', 'м'],
                        ['loss_db', 'Дополнительные потери', 'dB'],
                      ] as const
                    ).map(([key, label, unit]) => (
                      <Num
                        key={key}
                        label={label}
                        unit={unit}
                        value={o[key]}
                        change={(n) =>
                          patch((c) => {
                            c.layout.obstacles[i][key] = n ?? 0;
                          })
                        }
                      />
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </details>
        </div>
      </Section>
      <Section title="Фильтрация">
        <div className="body form-blocks">
          {draft.filters.map((f, i) => (
            <fieldset key={f.id}>
              <legend>{f.label}</legend>
              <div className="fields">
                <label className="field">
                  <span>Положение</span>
                  <select
                    value={f.side}
                    onChange={(e) =>
                      patch((c) => {
                        c.filters[i].side =
                          e.target.value === 'donor' ? 'donor' : 'service';
                      })
                    }
                  >
                    <option value="donor">Донорный тракт</option>
                    <option value="service">Внутренний тракт</option>
                  </select>
                </label>
                {(
                  [
                    ['insertion_loss_db', 'Вносимые потери'],
                    ['stop_loss_db', 'Подавление вне полосы'],
                    ['failed_loss_db', 'Потери при отказе'],
                  ] as const
                ).map(([key, label]) => (
                  <Num
                    key={key}
                    label={label}
                    unit="dB"
                    value={f[key]}
                    change={(n) =>
                      patch((c) => {
                        c.filters[i][key] = n ?? 0;
                      })
                    }
                  />
                ))}
                <Toggle
                  checked={f.healthy}
                  onChange={(value) =>
                    patch((c) => {
                      c.filters[i].healthy = value;
                    })
                  }
                >
                  Исправен
                </Toggle>
              </div>
              <details>
                <summary>Полосы пропускания и подавления</summary>
                <p>Пропускание</p>
                <Bands
                  values={f.passbands}
                  max={4}
                  update={(values) =>
                    patch((c) => {
                      c.filters[i].passbands = values;
                    })
                  }
                />
                <p>Подавление</p>
                <Bands
                  values={f.stopbands}
                  max={8}
                  update={(values) =>
                    patch((c) => {
                      c.filters[i].stopbands = values;
                    })
                  }
                />
              </details>
            </fieldset>
          ))}
        </div>
      </Section>
      <Section
        title="Контрольные критерии GSM"
        subtitle="Допущение; требуется подтверждение параметрами модема"
      >
        <div className="body form-blocks">
          <p className="muted">
            Существующая линия · {base.gsm_line.antenna_range_mhz.join('–')} МГц
            · только чтение. Координаты на плане условны.
          </p>
          <div className="fields">
            {(
              [
                ['interference_limit_dbm', 'Порог внутри канала', 'dBm'],
                ['blocker_limit_dbm', 'Внеполосный порог', 'dBm'],
                ['coupling_loss_db', 'Потери связи до GSM-входа', 'dB'],
              ] as const
            ).map(([key, label, unit]) => (
              <Num
                key={key}
                label={label}
                unit={unit}
                value={gsm[key]}
                optional
                change={(n) =>
                  patch((c) => {
                    c.gsm_criteria[key] = n;
                  })
                }
              />
            ))}
          </div>
          <details>
            <summary>Защищаемые окна и каналы</summary>
            <Bands
              values={gsm.protected_bands}
              max={8}
              update={(values) =>
                patch((c) => {
                  c.gsm_criteria.protected_bands = values;
                })
              }
            />
            <div className="band-editor">
              {gsm.channels.map((channel, i) => (
                <div className="band-row" key={i}>
                  <Num
                    label="Центр канала"
                    unit="МГц"
                    value={channel.center_mhz}
                    change={(n) =>
                      patch((c) => {
                        c.gsm_criteria.channels[i].center_mhz = n ?? 0;
                      })
                    }
                  />
                  <Num
                    label="Полоса измерения"
                    unit="кГц"
                    value={channel.bandwidth_khz}
                    change={(n) =>
                      patch((c) => {
                        c.gsm_criteria.channels[i].bandwidth_khz = n ?? 0;
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch((c) => {
                        c.gsm_criteria.channels.splice(i, 1);
                      })
                    }
                  >
                    Удалить
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={gsm.channels.length >= 12}
                onClick={() =>
                  patch((c) => {
                    c.gsm_criteria.channels.push({
                      center_mhz: 950,
                      bandwidth_khz: 200,
                    });
                  })
                }
              >
                Добавить канал
              </button>
            </div>
          </details>
        </div>
      </Section>
      <div className="form-end">
        {error && (
          <pre className="inline-error" role="alert">
            {error}
          </pre>
        )}
        <button type="submit" className="primary" disabled={busy}>
          Применить настройки
        </button>
      </div>
    </form>
  );
}
