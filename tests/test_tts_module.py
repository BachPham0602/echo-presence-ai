from __future__ import annotations

import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError
from lumi.providers.tts import EdgeTTS, NoAudioTTS, ZipVoiceTTS, _ensure_writable_dir, create_tts_provider


class FakeZipVoiceEngine:
    def __init__(self):
        self.calls = []
        self.sample_rate = 22050

    def synthesize(self, **kwargs):
        self.calls.append(kwargs)
        Path(kwargs['output_path']).write_bytes(b'fake wav')
        return {'sample_rate': self.sample_rate}


class TtsModuleTests(unittest.TestCase):
    def test_create_tts_provider_supports_zipvoice_alias(self):
        provider = create_tts_provider(LumiConfig(tts_provider='vizipvoice'))
        self.assertIsInstance(provider, ZipVoiceTTS)

    def test_create_tts_provider_supports_no_audio(self):
        provider = create_tts_provider(LumiConfig(tts_provider='no-audio'))
        self.assertIsInstance(provider, NoAudioTTS)



    def test_edge_tts_writes_audio_with_shared_output_dir_helper(self):
        class FakeCommunicate:
            def __init__(self, text, voice, rate=None, pitch=None):
                self.text = text
                self.voice = voice

            async def save(self, path):
                Path(path).write_bytes(b'fake mp3')

        fake_module = types.SimpleNamespace(Communicate=FakeCommunicate)
        with tempfile.TemporaryDirectory() as tmpdir:
            provider = EdgeTTS(LumiConfig(tts_provider='edge-tts', output_dir=tmpdir, output_subdir='test'))
            with patch.dict(sys.modules, {'edge_tts': fake_module}), patch('subprocess.run', side_effect=RuntimeError('no ffmpeg')):
                result = provider.synthesize_text('Xin chao')

            audio_path = Path(result.audio_path)
            self.assertTrue(audio_path.exists())
            self.assertEqual(audio_path.parent, Path(tmpdir) / 'test')
            self.assertEqual(result.engine, 'edge-tts:vi-VN-HoaiMyNeural')

    def test_writable_output_dir_uses_served_sibling_fallback_before_tmp(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / 'outputs'
            output_root.mkdir()
            blocked_date_path = output_root / '20260626'
            blocked_date_path.write_text('not a directory', encoding='utf-8')

            writable = _ensure_writable_dir(blocked_date_path)

            self.assertEqual(writable, output_root / '_tmp')
            self.assertTrue(writable.is_dir())

    def test_zipvoice_uses_sidecar_prompt_text_when_env_text_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            prompt_wav = tmp_path / 'owner.wav'
            prompt_txt = tmp_path / 'owner.txt'
            prompt_wav.write_bytes(b'RIFFfake')
            prompt_txt.write_text('Xin chao day la giong mau', encoding='utf-8')

            provider = ZipVoiceTTS(
                LumiConfig(
                    tts_provider='zipvoice',
                    tts_reference_wav=str(prompt_wav),
                    output_dir=str(tmp_path / 'outputs'),
                )
            )
            fake_engine = FakeZipVoiceEngine()
            provider._engine = fake_engine
            provider._load_engine = lambda: fake_engine

            result = provider.synthesize_text('Noi thu xem sao')

            self.assertTrue(Path(result.audio_path).exists())
            self.assertEqual(result.sample_rate, 22050)
            self.assertEqual(result.engine, 'zipvoice:owner')
            self.assertEqual(fake_engine.calls[0]['prompt_text'], 'Xin chao day la giong mau')
            self.assertEqual(fake_engine.calls[0]['prompt_wav'], str(prompt_wav))
            self.assertEqual(fake_engine.calls[0]['text'], 'Noi thu xem sao')

    def test_zipvoice_uses_single_owner_profile_when_no_wav_provided(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            owner_dir = tmp_path / 'owner_voices' / 'Uyên'
            owner_dir.mkdir(parents=True)
            prompt_wav = owner_dir / '01.wav'
            prompt_txt = owner_dir / '01.txt'
            prompt_wav.write_bytes(b'RIFFfake')
            prompt_txt.write_text('Xin chao Uyen', encoding='utf-8')

            provider = ZipVoiceTTS(
                LumiConfig(
                    tts_provider='zipvoice',
                    owner_voice_dir=str(tmp_path / 'owner_voices'),
                    output_dir=str(tmp_path / 'outputs'),
                )
            )
            fake_engine = FakeZipVoiceEngine()
            provider._engine = fake_engine
            provider._load_engine = lambda: fake_engine

            provider.synthesize_text('Thu giong profile')
            self.assertEqual(fake_engine.calls[0]['prompt_wav'], str(prompt_wav))
            self.assertEqual(fake_engine.calls[0]['prompt_text'], 'Xin chao Uyen')

    def test_zipvoice_requires_prompt_source(self):
        provider = ZipVoiceTTS(LumiConfig(tts_provider='zipvoice'))
        with self.assertRaises(MissingDependencyError):
            provider._resolve_prompt_wav()


if __name__ == '__main__':
    unittest.main()
