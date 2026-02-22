import logging
import time
import uuid
from collections.abc import Callable

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.core.config import get_settings
from app.services.exceptions import ServiceException

settings = get_settings()
logger = logging.getLogger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Response]
    ) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        start_time = time.perf_counter()

        response = await call_next(request)

        process_time = time.perf_counter() - start_time

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time"] = f"{process_time:.4f}"

        logger.info(
            "request_completed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "process_time_ms": round(process_time * 1000, 2),
                "client_ip": request.client.host if request.client else None,
            },
        )

        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Response]
    ) -> Response:
        response = await call_next(request)

        if not settings.ENABLE_SECURITY_HEADERS:
            return response

        response.headers["X-Content-Type-Options"] = settings.CONTENT_TYPE_OPTIONS
        response.headers["X-Frame-Options"] = settings.FRAME_OPTIONS
        response.headers["X-XSS-Protection"] = settings.XSS_PROTECTION
        response.headers["Referrer-Policy"] = settings.REFERRER_POLICY
        response.headers["Permissions-Policy"] = settings.PERMISSIONS_POLICY

        if settings.ENVIRONMENT == "production":
            hsts_value = f"max-age={settings.HSTS_MAX_AGE}"
            if settings.HSTS_INCLUDE_SUBDOMAINS:
                hsts_value += "; includeSubDomains"
            if settings.HSTS_PRELOAD:
                hsts_value += "; preload"
            response.headers["Strict-Transport-Security"] = hsts_value

        return response


async def _service_exception_handler(
    request: Request, exc: ServiceException
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    logger.warning(
        "service_exception",
        extra={
            "request_id": request_id,
            "error_code": exc.error_code.value,
            "exception_message": exc.message,
            "details": exc.details,
            "path": request.url.path,
            "method": request.method,
        },
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.message,
            "error_code": exc.error_code.value,
            "message": exc.message,
            "details": exc.details,
            "request_id": request_id,
        },
    )


async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.detail,
            "error_code": "HTTP_ERROR",
            "message": exc.detail,
            "details": {},
            "request_id": request_id,
        },
    )


async def _global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())

    logger.error(
        "unhandled_exception",
        extra={
            "request_id": request_id,
            "path": request.url.path,
            "method": request.method,
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
        },
        exc_info=True,
    )

    return JSONResponse(
        status_code=500,
        content={
            "detail": "An internal server error occurred",
            "error_code": "INTERNAL_SERVER_ERROR",
            "message": "An internal server error occurred",
            "details": {},
            "request_id": request_id,
        },
    )


def setup_middleware(app: FastAPI) -> None:

    session_secret = settings.SESSION_SECRET_KEY or settings.SECRET_KEY
    app.add_middleware(SessionMiddleware, secret_key=session_secret)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestIdMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-Requested-With",
            "Accept",
            "Origin",
        ],
        expose_headers=["X-Message-Id", "X-Request-ID", "X-Process-Time"],
    )

    app.add_exception_handler(ServiceException, _service_exception_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(Exception, _global_exception_handler)
