class LumiProviderError(RuntimeError):
    """Lỗi cấu hình hoặc runtime của provider model."""


class MissingDependencyError(LumiProviderError):
    """Provider cần dependency chưa được cài."""
