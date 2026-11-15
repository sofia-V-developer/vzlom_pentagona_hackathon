from html import escape
from itertools import groupby

from app.simulation.scenarios import SCENARIOS


def fmt(value, unit=""):
    return "—" if value is None else f"{value:.1f}{unit}"


def markdown(snapshot, budget, events):
    config, p, coverage = snapshot["config"], snapshot["protection"], snapshot["coverage"]
    layout = config["layout"]
    lines = [
        "# МЦОД Связь · " + config["label"], "", "**Симуляция · расчётные данные**", "",
        f"Снимок `{snapshot['snapshot_id']}`, {snapshot['timestamp']}",
        f"Ревизия {snapshot['config_revision']}, модель {snapshot['model_version']}, "
        f"сценарий «{SCENARIOS[snapshot['scenario']][0]}», seed {snapshot['seed']}, t = {snapshot['simulation_time']} с.", "",
        "## Покрытие рабочей площади", "",
        f"Модельный порог RSRP {fmt(config['radio']['coverage_threshold_dbm'], ' dBm')}. "
        "Для UL принят запас ≥ 0 dB.", "",
        "| Показатель | До | После |", "| --- | ---: | ---: |",
    ]
    for name, key, unit in (
        ("Покрытие DL", "coverage_pct", "%"), ("Оба критерия", "both_pct", "%"),
        ("Минимальный RSRP", "min_rsrp_dbm", " dBm"), ("Медианный RSRP", "median_rsrp_dbm", " dBm"),
        ("Худший запас UL", "worst_ul_margin_db", " dB"),
    ):
        lines.append(f"| {name} | {fmt(coverage['before'][key], unit)} | {fmt(coverage['after'][key], unit)} |")
    if coverage["rooms"]:
        rooms = {room["id"]: room for room in layout["rooms"]}
        lines.extend(["", "### Покрытие по помещениям", "",
                      "| Помещение | DL до | DL после | DL и UL после |",
                      "| --- | ---: | ---: | ---: |"])
        for room in coverage["rooms"]:
            lines.append(f"| {rooms[room['id']]['label']} | {fmt(room['before']['coverage_pct'], '%')} | "
                         f"{fmt(room['after']['coverage_pct'], '%')} | {fmt(room['after']['both_pct'], '%')} |")
    lines.extend(["", "## Защита", "", f"{p['label']}. {p['reason']}.", "",
                  f"DL {fmt(p['dl']['requested_gain_db'])} → {fmt(p['dl']['applied_gain_db'], ' dB')}. "
                  f"UL {fmt(p['ul']['requested_gain_db'])} → {fmt(p['ul']['applied_gain_db'], ' dB')}.", "",
                  f"Проверка GSM после действий защиты — {p['gsm']['status']}. Доставка SMS не проверяется."])
    for title, gsm in (("Текущие условия", p["gsm"]), ("До защитного отключения", snapshot["trip_gsm"])):
        if gsm is None:
            continue
        lines.extend(["", f"### {title}", "", "Допущение; требуется подтверждение параметрами модема.", ""])
        for ch in gsm["channels"]:
            lines.append(f"- {ch['center_mhz']:g} МГц / {ch['bandwidth_khz']:g} кГц · "
                         f"{fmt(ch['power_dbm'], ' dBm')}, предел {fmt(ch['limit_dbm'], ' dBm')}")
        lines.append(f"- Внеполосная мощность {fmt(gsm['blocker_dbm'], ' dBm')}, "
                     f"предел {fmt(gsm['blocker_limit_dbm'], ' dBm')}.")
        for c in gsm["components"]:
            lines.append(f"- {c['label']} · {c['frequency_mhz']:g} МГц, на входе GSM {fmt(c['receiver_dbm'], ' dBm')}. "
                         f"{c['origin']}")
        if gsm["missing"]:
            lines.append("- Недостающие данные — " + ", ".join(gsm["missing"]))
    lines.extend(["", "## Топология и оборудование", "",
                  "БС ↔ донорная антенна ↔ донорный фильтр ↔ репитер ↔ выходной фильтр ↔ делитель ↔ панели.",
                  "Существующая GSM-антенна ↔ GSM-модем. Кабельного соединения с новой системой нет.", "",
                  f"Помещение {layout['width_m']:g} × {layout['depth_m']:g} × {layout['height_m']:g} м.", ""])
    if layout["source"]:
        lines.extend([f"Основа планировки — {layout['source']}. Площади помещений по экспликации:", ""])
        lines.extend(f"- {room['label']} · {room['drawing_area_m2']:g} м²" for room in layout["rooms"])
        lines.append("")
    equipment = [(layout["donor"]["label"], layout["donor"]), ("GSM-антенна (существующая)", layout["gsm_antenna"]),
                 ("Репитер", layout["repeater"]), ("Делитель", layout["splitter"]),
                 *((item["label"], item) for item in layout["panels"])]
    for name, item in equipment:
        lines.append(f"- {name} · ({item['x']:g}, {item['y']:g}, {item['z']:g}) м")
    for item in config["filters"]:
        status = "исправен" if item["healthy"] else "отказ"
        lines.append(f"- {item['label']} · {status}, вносимые потери {item['insertion_loss_db']:g} dB")
    point = budget["point"]
    lines.extend(["", "## Бюджет контрольной точки", "", f"({point['x']:.2f}, {point['y']:.2f}, {point['z']:.2f}) м. "
                  f"Запас UL после {fmt(budget['after_ul_margin_db'], ' dB')}."])
    for side, direction in (("before", "dl"), ("before", "ul"), ("after", "dl"), ("after", "ul")):
        when = "До" if side == "before" else "После"
        lines.extend(["", f"### {when} · {direction.upper()}", "", "| Узел | Значение | Уровень, dBm |",
                      "| --- | ---: | ---: |"])
        rows = budget[f"{side}_{direction}_rows"]
        for row in rows:
            lines.append(f"| {row['label']} | {fmt(row['value'], ' ' + row['unit'])} | {fmt(row['total_dbm'])} |")
        if not rows:
            lines.append("| Нет полезного сигнала | — | — |")
    lines.extend(["", "## Журнал до времени снимка", ""])
    lines.extend(f"- {event['timestamp']} · {event['label']}" for event in events)
    lines.extend(["", "## Условия применения", "", "Координаты антенн, каналы, потери, пороги и источники заданы для симуляции. "
                  "Требуется проверка на реальном оборудовании. Доставка SMS и голосовые вызовы не проверяются.", ""])
    return "\n".join(lines)



def printable(text):
    def kind(line):
        if line.startswith("#"):
            return "heading"
        if line.startswith("| "):
            return "table"
        if line.startswith("- "):
            return "list"
        return "paragraph" if line else "blank"

    sections = []
    for name, group in groupby(text.splitlines(), kind):
        lines = list(group)
        match name:
            case "heading":
                for line in lines:
                    marker, title = line.split(" ", 1)
                    level = len(marker)
                    sections.append(f"<h{level}>{escape(title)}</h{level}>")
            case "table":
                rows = []
                for i, line in enumerate(lines):
                    if i == 1:
                        continue
                    cells = line.strip("|").split("|")
                    tag = "th" if i == 0 else "td"
                    rows.append("<tr>" + "".join(f"<{tag}>{escape(cell.strip())}</{tag}>" for cell in cells) + "</tr>")
                sections.append("<table>" + "".join(rows) + "</table>")
            case "list":
                sections.append("<ul>" + "".join(f"<li>{escape(line[2:])}</li>" for line in lines) + "</ul>")
            case "paragraph":
                sections.extend(f"<p>{escape(line.strip('*'))}</p>" for line in lines)

    return ('<!doctype html><html lang="ru"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>МЦОД Связь — отчёт</title>'
            '<style>body{max-width:60rem;margin:2rem auto;padding:0 1rem;color:#17222d;font:15px/1.5 system-ui}'
            'h1,h2,h3{line-height:1.22;margin-bottom:.4em;break-after:avoid}'
            'h2{margin-top:1.35em;border-bottom:1px solid #a5b7bf;padding-bottom:5px}'
            'table{border-collapse:collapse;width:100%;margin:.65rem 0}td,th{border:1px solid #a5b7bf;'
            'padding:4px 8px;text-align:left}th{background:#e5eef1}tr{break-inside:avoid}'
            'p{overflow-wrap:anywhere}button{font:inherit;padding:6px 10px}'
            '@media print{button{display:none}body{margin:0;padding:0;font-size:10pt}}</style></head><body>'
            '<button type="button" onclick="print()">Печать отчёта</button>' + "".join(sections) + '</body></html>')
