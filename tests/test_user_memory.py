import tempfile
import unittest
from pathlib import Path

from lumi.user_memory.learning import learn_preferences_from_turns
from lumi.user_memory.prompt import preference_system_addon
from lumi.user_memory.store import DEFAULT_PREFERENCES, UserMemoryStore, sanitize_user_id


class UserMemoryTests(unittest.TestCase):
    def test_sanitize_user_id_ascii(self):
        self.assertEqual(sanitize_user_id("Uyên"), "uyen")

    def test_sanitize_user_id_unicode_fallback(self):
        user_id = sanitize_user_id("李明")
        self.assertTrue(user_id.startswith("user_"))

    def test_append_turn_and_preferences(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = UserMemoryStore(root_dir=tmpdir)
            login = store.login("Minh")
            user_id = login["user_id"]
            store.append_turn(user_id, "sess-1", "nói ngắn thôi nhé", "Dạ, Lumi hiểu rồi.")
            turns = store.read_session_transcript(user_id, "sess-1")
            self.assertEqual(len(turns), 1)
            updated = learn_preferences_from_turns(turns, store.load_preferences(user_id))
            store.save_preferences(user_id, updated)
            prefs = store.load_preferences(user_id)
            self.assertEqual(prefs["response_length"], "short")
            addon = preference_system_addon(prefs)
            self.assertIn("ngắn", addon)

    def test_default_preferences_inject_on_first_session(self):
        addon = preference_system_addon(DEFAULT_PREFERENCES)
        self.assertIn("SỞ THÍCH", addon)

    def test_login_creates_profile_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            store = UserMemoryStore(root_dir=tmpdir)
            result = store.login("An")
            base = Path(tmpdir) / result["user_id"]
            self.assertTrue((base / "profile.json").exists())
            self.assertTrue((base / "preferences.json").exists())


if __name__ == "__main__":
    unittest.main()
