import unittest
from pathlib import Path

from lumi.providers.asr import MicrophoneRecorder


class FakeStreamingRecorder(MicrophoneRecorder):
    def __init__(self):
        super().__init__(output_dir="outputs")
        self.calls = 0

    def record(self, seconds):
        self.calls += 1
        return Path(f"chunk_{self.calls}_{seconds}.wav")


class StreamingRecorderTest(unittest.TestCase):
    def test_stream_chunks_respects_max_chunks(self):
        recorder = FakeStreamingRecorder()

        chunks = list(recorder.stream_chunks(chunk_seconds=2.5, max_chunks=3))

        self.assertEqual(len(chunks), 3)
        self.assertEqual(chunks[0], Path("chunk_1_2.5.wav"))
        self.assertEqual(chunks[-1], Path("chunk_3_2.5.wav"))


if __name__ == "__main__":
    unittest.main()
