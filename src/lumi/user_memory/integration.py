from __future__ import annotations

import re
from http import HTTPStatus
from typing import Any
from urllib.parse import parse_qs, urlparse

from lumi.config import LumiConfig
from lumi.mvp_pipeline import LumiMvpPipeline
from lumi.user_memory.generator import PreferenceInjectingGenerator, wrap_response_generator
from lumi.user_memory.learning import PreferenceLearningWorker
from lumi.user_memory.store import UserMemoryStore, sanitize_user_id

USER_ID_HEADER = "X-User-Id"
_INSTALLED = False


class UserMemoryRuntime:
    def __init__(self, config: LumiConfig):
        self.config = config
        self.store = UserMemoryStore(config)
        self.worker = PreferenceLearningWorker(self.store)
        self._session_users: dict[str, str] = {}
        self._original_remember = LumiMvpPipeline._remember


def install_user_memory(handler_cls: type, config: LumiConfig) -> UserMemoryRuntime:
    """Attach user-memory routes and hooks without editing core handler/pipeline code."""
    global _INSTALLED
    runtime = UserMemoryRuntime(config)
    handler_cls.user_memory = runtime

    if not _INSTALLED:
        _patch_pipeline_remember(runtime)
        _patch_session_manager(handler_cls)
        _patch_handler_routes(handler_cls)
        _patch_cors_headers(handler_cls)
        _INSTALLED = True
        print("[user_memory] Đã bật học kiểu trả lời ưa thích (session-end, background).")

    return runtime


def _patch_cors_headers(handler_cls: type) -> None:
    original = handler_cls.end_headers

    def end_headers(self) -> None:
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Session-Id, X-User-Id, X-Bot-Pronoun, X-User-Pronoun, X-Owner-Name, X-Sample-Index, X-Prompt",
        )
        original(self)

    handler_cls.end_headers = end_headers


def _patch_pipeline_remember(runtime: UserMemoryRuntime) -> None:
    original = runtime._original_remember

    def remember_with_memory(self: LumiMvpPipeline, user_text: str, response_text: str) -> None:
        original(self, user_text, response_text)
        user_id = getattr(self, "_memory_user_id", None)
        session_id = getattr(self, "_memory_session_id", None)
        if user_id and session_id:
            runtime.store.append_turn(user_id, session_id, user_text, response_text)

    LumiMvpPipeline._remember = remember_with_memory


def _patch_session_manager(handler_cls: type) -> None:
    mgr_cls = type(handler_cls.session_manager)
    original_new_pipeline = mgr_cls._new_pipeline

    def new_pipeline_with_memory(self):
        pipeline = original_new_pipeline(self)
        runtime: UserMemoryRuntime | None = getattr(handler_cls, "user_memory", None)
        if runtime is not None:
            _ensure_memory_wrapped(pipeline, self.prototype, runtime)
        return pipeline

    mgr_cls._new_pipeline = new_pipeline_with_memory


def _unwrap_generator(generator: Any) -> Any:
    if isinstance(generator, PreferenceInjectingGenerator):
        return generator._inner
    return generator


def _ensure_memory_wrapped(
    pipeline: LumiMvpPipeline,
    prototype: LumiMvpPipeline,
    runtime: UserMemoryRuntime,
) -> None:
    if getattr(pipeline, "_memory_generator_wrapped", False):
        return

    def addon_provider() -> str:
        user_id = getattr(pipeline, "_memory_user_id", None)
        return runtime.store.preference_prompt_addon(user_id)

    base_generator = _unwrap_generator(prototype.response_generator)
    pipeline.response_generator = wrap_response_generator(base_generator, addon_provider)
    pipeline._memory_generator_wrapped = True


def _bind_pipeline_context(
    pipeline: LumiMvpPipeline,
    prototype: LumiMvpPipeline,
    runtime: UserMemoryRuntime,
    session_id: str,
    user_id: str | None,
) -> None:
    pipeline._memory_session_id = session_id
    if not user_id:
        return
    clean_id = _resolve_user_id(user_id)
    if clean_id == "guest":
        return
    runtime._session_users[session_id] = clean_id
    pipeline._memory_user_id = clean_id
    _ensure_memory_wrapped(pipeline, prototype, runtime)


def _resolve_user_id(raw: str) -> str:
    cleaned = raw.strip()
    if not cleaned:
        raise ValueError("user_id rỗng.")
    if re.fullmatch(r"[a-z0-9_-]{1,64}", cleaned):
        return cleaned
    return sanitize_user_id(cleaned)


def _extract_user_id(payload: dict | None, headers: Any) -> str | None:
    if payload:
        raw = payload.get("user_id") or payload.get("userId")
        if raw:
            return str(raw).strip()
    header_val = headers.get(USER_ID_HEADER) if headers else None
    if header_val:
        return str(header_val).strip()
    return None


def _patch_handler_routes(handler_cls: type) -> None:
    original_do_post = handler_cls.do_POST
    original_do_get = handler_cls.do_GET
    original_session_for_payload = handler_cls._session_for_payload

    def session_for_payload_with_memory(self, payload: dict | None = None):
        session = original_session_for_payload(self, payload)
        runtime: UserMemoryRuntime | None = getattr(self, "user_memory", None)
        if runtime is None:
            return session
        session_id = getattr(self, "_active_session_id", None) or ""
        user_id = _extract_user_id(payload, self.headers)
        if not user_id and session_id:
            user_id = runtime._session_users.get(session_id)
        _bind_pipeline_context(session.pipeline, self.session_manager.prototype, runtime, session_id, user_id)
        return session

    def do_post_with_memory(self):
        path = urlparse(self.path).path
        runtime: UserMemoryRuntime | None = getattr(self, "user_memory", None)
        if runtime is not None:
            if path == "/api/login":
                _handle_login(self, runtime)
                return
            if path == "/api/session/end":
                _handle_session_end(self, runtime)
                return
        return original_do_post(self)

    def do_get_with_memory(self):
        path = urlparse(self.path).path
        runtime: UserMemoryRuntime | None = getattr(self, "user_memory", None)
        if runtime is not None and path == "/api/memory":
            _handle_memory_get(self, runtime)
            return
        return original_do_get(self)

    handler_cls._session_for_payload = session_for_payload_with_memory
    handler_cls.do_POST = do_post_with_memory
    handler_cls.do_GET = do_get_with_memory


def _handle_login(handler: Any, runtime: UserMemoryRuntime) -> None:
    payload = handler._read_json()
    display_name = str(payload.get("display_name") or payload.get("name") or "").strip()
    if not display_name:
        handler._send_json({"error": "Thiếu display_name."}, HTTPStatus.BAD_REQUEST)
        return
    try:
        result = runtime.store.login(display_name)
    except ValueError as exc:
        handler._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return
    handler._send_json(result)


def _handle_session_end(handler: Any, runtime: UserMemoryRuntime) -> None:
    payload = handler._read_json()
    user_id = _extract_user_id(payload, handler.headers)
    session_id = handler._request_session_id(payload)
    reason = str(payload.get("reason") or "session_end").strip() or "session_end"

    if not user_id:
        handler._send_json({"status": "ignored", "reason": "missing_user_id"}, HTTPStatus.ACCEPTED)
        return

    try:
        clean_user_id = _resolve_user_id(user_id)
    except ValueError as exc:
        handler._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return

    if clean_user_id == "guest":
        handler._send_json({"status": "ignored", "reason": "guest_user"}, HTTPStatus.ACCEPTED)
        return

    runtime.worker.schedule_session_end(clean_user_id, session_id, reason=reason)
    handler._send_json(
        {
            "status": "scheduled",
            "user_id": clean_user_id,
            "session_id": session_id,
            "reason": reason,
        },
        HTTPStatus.ACCEPTED,
    )


def _handle_memory_get(handler: Any, runtime: UserMemoryRuntime) -> None:
    query = parse_qs(urlparse(handler.path).query)
    user_id = (query.get("user_id") or query.get("userId") or [None])[0]
    if not user_id:
        handler._send_json({"error": "Thiếu user_id."}, HTTPStatus.BAD_REQUEST)
        return
    try:
        clean_user_id = _resolve_user_id(str(user_id))
    except ValueError as exc:
        handler._send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        return
    handler._send_json(runtime.store.get_memory_summary(clean_user_id))
