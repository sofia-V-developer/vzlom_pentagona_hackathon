import asyncio
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.report import markdown, printable
from app.schemas import ConfigUpdate, ScenarioCommand
from app.service import ServiceError, SimulationService
from app.simulation.engine import MODEL_VERSION
from app.simulation.scenarios import SCENARIOS
from app.simulation.spectrum import products
from app.storage import Storage

ROOT = Path(__file__).resolve().parents[2]
logger = logging.getLogger(__name__)
Coordinate = Annotated[float, Query(ge=0, le=30)]


async def simulation_loop(service):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + 1
    while True:
        await asyncio.sleep(max(0, deadline - loop.time()))
        tick = asyncio.create_task(asyncio.to_thread(service.tick))
        try:
            await asyncio.shield(tick)
        except asyncio.CancelledError:
            await asyncio.gather(tick, return_exceptions=True)
            raise
        except Exception:
            logger.exception("Simulation step failed")
        deadline = max(deadline + 1, loop.time() + 0.05)


def create_app(db_path: Path | None = None, *, clock=True, static_path: Path | None = None):
    @asynccontextmanager
    async def lifespan(app):
        storage = Storage(db_path or Path(os.getenv("MCOD_DB", ROOT / "data/mcod.sqlite3")))
        worker = None
        try:
            app.state.service = SimulationService(storage, ROOT / "configs")
            worker = asyncio.create_task(simulation_loop(app.state.service)) if clock else None
            yield
        finally:
            if worker:
                worker.cancel()
                with suppress(asyncio.CancelledError):
                    await worker
            if hasattr(app.state, "service"):
                with app.state.service.lock:
                    storage.close()
            else:
                storage.close()

    app = FastAPI(title="МЦОД Связь", version=MODEL_VERSION, lifespan=lifespan,
                  openapi_url="/api/v1/openapi.json", docs_url=None, redoc_url=None)
    api = APIRouter(prefix="/api/v1")

    @app.exception_handler(ServiceError)
    async def service_error(_, exc):
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_, exc):
        descriptions = {
            "missing": "обязательное поле", "extra_forbidden": "поле недоступно для изменения",
            "finite_number": "нужно конечное число", "json_invalid": "некорректный JSON",
            "float_parsing": "нужно число", "int_parsing": "нужно целое число", "literal_error": "неизвестное значение",
        }
        errors = []
        for e in exc.errors():
            message = descriptions.get(e["type"], "значение не соответствует типу или допустимому диапазону")
            if e["type"] == "value_error" and "error" in e.get("ctx", {}):
                message = str(e["ctx"]["error"])
            errors.append({"field": ".".join(str(i) for i in e["loc"]), "message": message})
        return JSONResponse({"detail": "Проверьте входные параметры", "errors": errors}, status_code=422)

    def svc(request):
        return request.app.state.service

    @api.get("/health")
    def health():
        return {"status": "ok", "data_source": "simulated", "model_version": MODEL_VERSION}

    @api.get("/scenarios")
    def scenarios():
        return [{"id": id, "label": title, "description": desc} for id, (title, desc) in SCENARIOS.items()]

    @api.get("/sites")
    def sites(request: Request):
        return svc(request).list_sites()

    @api.get("/sites/{site_id}/config")
    def config(request: Request, site_id: str):
        return svc(request).get_config(site_id)

    @api.put("/sites/{site_id}/config")
    def update(request: Request, site_id: str, body: ConfigUpdate):
        return svc(request).set_config(site_id, body)

    @api.post("/sites/{site_id}/config/restore")
    def restore(request: Request, site_id: str):
        return svc(request).restore(site_id)

    @api.get("/sites/{site_id}/snapshot")
    def snapshot(request: Request, site_id: str, snapshot_id: str | None = None):
        return svc(request).snapshot(site_id, snapshot_id)

    @api.get("/sites/{site_id}/imd-products")
    def imd_products(request: Request, site_id: str, f1: Annotated[float, Query(gt=0, le=10000)],
                     f2: Annotated[float, Query(gt=0, le=10000)], snapshot_id: str | None = None):
        current = svc(request).snapshot(site_id, snapshot_id)
        windows = current["config"]["gsm_criteria"]["protected_bands"]
        return {"snapshot_id": current["snapshot_id"], "products": [
            {"frequency_mhz": f, "protected_band_hit": any(b["low_mhz"] <= f <= b["high_mhz"] for b in windows)}
            for f in products(f1, f2)
        ]}

    @api.get("/sites/{site_id}/history")
    def history(request: Request, site_id: str):
        return svc(request).history(site_id)

    @api.get("/sites/{site_id}/events")
    def events(request: Request, site_id: str, limit: Annotated[int, Query(ge=1, le=200)] = 50):
        return svc(request).events(site_id, limit)

    @api.post("/sites/{site_id}/scenario")
    def set_scenario(request: Request, site_id: str, body: ScenarioCommand):
        return svc(request).scenario(site_id, body)

    @api.post("/sites/{site_id}/simulation/{action}")
    def control(request: Request, site_id: str, action: Literal["start", "pause", "step", "reset", "clear-trip"]):
        return svc(request).control(site_id, action)

    @api.get("/sites/{site_id}/budget")
    def budget(request: Request, site_id: str, x: Coordinate, y: Coordinate, snapshot_id: str | None = None):
        return svc(request).budget(site_id, snapshot_id, x, y)

    @api.get("/sites/{site_id}/export/config.json")
    def export_config(request: Request, site_id: str):
        result = svc(request).get_config(site_id)
        return JSONResponse(result, headers={"Content-Disposition": f'attachment; filename="{site_id}-config.json"'})

    @api.get("/sites/{site_id}/export/report.{format}")
    def report(request: Request, site_id: str, format: Literal["json", "md", "html"],
               x: Annotated[float | None, Query(ge=0, le=30)] = None,
               y: Annotated[float | None, Query(ge=0, le=30)] = None, snapshot_id: str | None = None):
        service = svc(request)
        with service.lock:
            current = service.snapshot(site_id, snapshot_id)
            layout = current["config"]["layout"]
            point = service.budget(site_id, current["snapshot_id"], layout["width_m"] / 2 if x is None else x,
                                   layout["depth_m"] / 2 if y is None else y)
            log = [e for e in service.events(site_id, 200) if e["timestamp"] <= current["timestamp"]][:50]
        headers = {"Content-Disposition": f'attachment; filename="{site_id}-report.{format}"'}
        if format == "json":
            return JSONResponse({"snapshot": current, "budget": point, "events": log}, headers=headers)
        text = markdown(current, point, log)
        if format == "md":
            return PlainTextResponse(text, media_type="text/markdown", headers=headers)
        return HTMLResponse(printable(text))

    app.include_router(api)
    dist = static_path or ROOT / "frontend/dist"
    if dist.is_dir():
        if (dist / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/favicon.svg", include_in_schema=False)
        def favicon():
            return FileResponse(dist / "favicon.svg", media_type="image/svg+xml")

        @app.get("/", include_in_schema=False)
        def frontend():
            return FileResponse(dist / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        def instructions():
            return HTMLResponse('<html lang="ru"><meta charset="utf-8"><h1>МЦОД Связь</h1>'
                                '<p>Соберите интерфейс командой <code>npm run build</code> в папке frontend '
                                'и перезапустите сервер.</p><a href="/api/v1/openapi.json">OpenAPI</a></html>')
    return app


app = create_app()
