import json
import sqlite3
from pathlib import Path


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class Storage:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript("""
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS sites (
                id TEXT PRIMARY KEY, revision INTEGER NOT NULL, config TEXT NOT NULL, runtime TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS site_events ON events(site, seq DESC);
        """)

    def read_site(self, site_id):
        row = self.db.execute("SELECT revision, config, runtime FROM sites WHERE id=?", (site_id,)).fetchone()
        return (row[0], json.loads(row[1]), json.loads(row[2])) if row else None

    def commit(self, site_id, revision, config, runtime, events):
        with self.db:
            self.db.execute("""
                INSERT INTO sites(id, revision, config, runtime) VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, config=excluded.config, runtime=excluded.runtime
            """, (site_id, revision, dump(config), dump(runtime)))
            self.db.executemany("INSERT INTO events(site, payload) VALUES (?, ?)",
                                [(site_id, dump(event)) for event in events])

    def events(self, site_id, limit):
        rows = self.db.execute("SELECT seq, payload FROM events WHERE site=? ORDER BY seq DESC LIMIT ?",
                               (site_id, limit))
        return [{"seq": seq, **json.loads(payload)} for seq, payload in rows]

    def close(self):
        self.db.close()
