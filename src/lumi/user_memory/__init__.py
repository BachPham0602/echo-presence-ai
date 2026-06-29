"""Per-user conversation memory and response-style learning (additive module)."""

from .integration import install_user_memory
from .store import UserMemoryStore

__all__ = ["UserMemoryStore", "install_user_memory"]
