from __future__ import annotations

from pathlib import Path
import inspect
import re

from lumi.config import LumiConfig
from lumi.models import MvpPipelineResult
from lumi.latency_log import LatencyTimer
from lumi.providers.asr import PhoWhisperASR
import time
from datetime import datetime
from lumi.providers.llm import QwenLocalResponseGenerator, TemplateChatGenerator
from lumi.providers.tts import create_tts_provider
from lumi.providers.turn_taking import HeuristicTurnTakingDetector, LlmTurnTakingDetector
from lumi.providers.addressee import HeuristicAddresseeDetector, LlmAddresseeDetector
from lumi.providers.addressee import _normalize
from lumi.models import TranscriptSegment
from lumi.output_metadata import write_audio_sidecars
import threading
import base64


VOICE_ASR_HALLUCINATIONS = (
    "Cảm ơn các bạn đã theo dõi",
    "Xin chào các bạn",
    "Subscribe",
    "VietSub",
    "Cảm ơn các bạn",
    "đầy thủ học",
    "nhẹ nhàng",
    "nói thật ghi nhớ",
    "nhiều trường hợp sau khi thi đấu",
    "những vấn đề chung",
    "thay thế chất lượng",
    "tăng trưởng rất nhanh",
    "đây là một trong những",
)

VOICE_FILLER_TOKENS = {
    "a",
    "ah",
    "alo",
    "e",
    "h",
    "ha",
    "hm",
    "hmm",
    "o",
    "oh",
    "u",
    "uh",
    "um",
    "n",
    "sự",
    "nha"
}

RECENT_QUESTION_LOOKBACK = 6
EMPTY_FOLLOWUP_PATTERNS = (
    "muon noi gi tiep",
    "muon noi them gi",
    "muon noi gi nua",
    "noi gi tiep",
    "can lumi nghe gi tiep",
)
QUESTION_LAST_TOKENS = {"khong", "chua", "ha", "a", "sao"}
QUESTION_LAST_PHRASES = {"the nao", "duoc khong"}
HEALTH_TERMS = ("dau", "nhuc", "met", "sot", "ho", "kho tho", "kho chiu", "uong thuoc", "benh")
FOOD_TERMS = ("an", "mon", "doi", "goi y", "chot", "tuy", "gi cung duoc")
MEDICATION_TERMS = ("panadol", "paracetamol", "acetaminophen", "thuoc giam dau", "uong thuoc", "uong mot vien", "mot vien roi", "vien roi")
GAMBLING_TERMS = ("ca do", "danh de", "lo de", "so de", "co bac", "casino", "keo bong", "slot")
UNSAFE_INGESTION_TERMS = ("an cut", "an cuc", "an phan", "uong nuoc tieu")
CRISIS_TERMS = ("muon tu tu", "tu sat", "muon chet", "khong muon song", "lam hai ban than", "chet di", "ket thuc moi thu")
DISTRESS_TERMS = ("tram cam", "tuyet vong", "khong on", "muon bien mat")
SADNESS_TERMS = ("buon", "co don", "muon khoc", "chan nan")
GREETING_TERMS = ("xin chao", "hello", "hi", "chao lumi", "lumi oi")
PERSONA_ROLE_TERMS = ("me cua toi", "me cua minh", "me ha", "ba cua toi", "nguoi yeu cua toi")
STOP_RESPONSE_TERMS = (
    (("dung noi", "dung noi lai", "dung noi nua", "dung noi lai di", "dung noi nua di"), "Lumi dừng nói"),
    (("dung tra loi", "dung tra loi nua", "thoi tra loi", "thoi tra loi nua"), "Lumi dừng trả lời"),
    (("ngung noi", "ngung noi di", "ngung lai", "ngung lai di"), "Lumi ngưng nói"),
    (("im lang", "im lang di", "im di", "giu im lang"), "Lumi im lặng"),
    (("thoi noi", "thoi noi nua", "thoi dung noi", "noi it thoi"), "Lumi dừng nói"),
    (("dung lai", "dung di", "dung thoi", "thoi dung", "stop", "cancel", "huy"), "Lumi dừng lại"),
)
# Một từ — chỉ khớp khi cả câu đúng một từ đó (tránh nhầm tên riêng "Huy").
STOP_SINGLE_WORD_TERMS = frozenset({"stop", "cancel", "huy"})
CONTEXT_FOLLOWUP_TERMS = (
    "roi",
    "vay",
    "the",
    "luc nay",
    "hoi nay",
    "vua noi",
    "thuoc do",
    "vien do",
    "cai do",
    "chuyen do",
)
SHORT_FOLLOWUP_TOKENS = {"co", "khong", "chua", "roi", "dung", "uh", "u", "vang", "ok"}
CJK_TEXT_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]")


class LumiMvpPipeline:
    """MVP model-first: text/audio input -> LLM text response -> TTS audio.

    Các hook turn_detector, addressee_detector, emotion_classifier
    được giữ trong constructor để sau này tích hợp, nhưng hiện tại không chạy hết.
    """

    def __init__(
        self,
        config: LumiConfig | None = None,
        asr=None,
        response_generator=None,
        tts=None,
        turn_detector=None,
        addressee_detector=None,
        emotion_classifier=None,
    ):
        self.config = config or LumiConfig.from_env()
        self.config.apply_cuda_visible_devices()
        self.history: list[dict[str, str]] = [
            {"role": "assistant", "content": "Xin chào, Lumi đây. Bạn cần Lumi giúp gì không?"}
        ]
        self.user_buffer: list[str] = []
        self.voice_buffer: list[str] = []
        self.interrupt_event = threading.Event()
        self.generation_lock = threading.Lock()
        self._latest_request_time = 0.0
        self.asr = asr or _build_asr(self.config)
        self.response_generator = response_generator or _build_response_generator(self.config)
        self.tts = tts or _build_tts(self.config)

        self.turn_detector = turn_detector or HeuristicTurnTakingDetector()
        self.addressee_detector = addressee_detector or LlmAddresseeDetector(self.response_generator)
        self.voice_addressee_detector = HeuristicAddresseeDetector()
        self.emotion_classifier = emotion_classifier

    def handle_text(self, text: str, bot_pronoun: str | None = None, user_pronoun: str | None = None) -> MvpPipelineResult:
        # Legacy method (synchronous)
        t_start = time.time()
        clean_text = text.strip()
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] [TEXT IN] Nhận được: '{clean_text}'")
        
        t_llm_start = time.time()
        response_text = self._generate_guarded_response(
            clean_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, channel="text"
        )
        t_llm_end = time.time()
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [LLM OUT] Phản hồi ({t_llm_end - t_llm_start:.2f}s): '{response_text}'")
        
        t_tts_start = time.time()
        tts_result = self.tts.synthesize_text(response_text)
        t_tts_end = time.time()
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [TTS OUT] Tạo audio ({t_tts_end - t_tts_start:.2f}s)")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [TOTAL] Tổng thời gian: {t_tts_end - t_start:.2f}s")
        
        self._remember(clean_text, response_text)
        result = MvpPipelineResult(
            input_text=clean_text,
            response_text=response_text,
            audio_path=tts_result.audio_path,
            tts_engine=tts_result.engine,
        )
        self._write_response_sidecars(result, channel="text")
        return result

    # TEXT CHAT GUARDRAIL:
    # Text chat is intentionally separate from voice chat. When changing voice
    # chat, do not add ASR, speaker verification, interrupt, streaming, or
    # voice turn-taking logic here. handle_chat only buffers typed text; the
    # frontend idle timer calls /api/flush, and flush_chat then enters the
    # shared LLM + TTS path.
    def handle_chat(self, text: str, bot_pronoun: str | None = None, user_pronoun: str | None = None) -> MvpPipelineResult | dict:
        clean_text = text.strip()
        print(f"\n[DEBUG] Pipeline Chat xử lý Text: '{clean_text}'")
        if not clean_text:
            return {"status": "buffered", "buffered_text": " ".join(self.user_buffer), "reason": "Empty"}

        stop_response = self._stop_response_for_intent(clean_text)
        if stop_response:
            self._apply_stop_intent()
            tts_result = self.tts.synthesize_text(stop_response)
            self._remember(clean_text, stop_response)
            result = MvpPipelineResult(
                input_text=clean_text,
                response_text=stop_response,
                audio_path=tts_result.audio_path,
                tts_engine=tts_result.engine,
            )
            self._write_response_sidecars(result, channel="chat")
            return result

        self.user_buffer.append(clean_text)
        combined_text = " ".join(self.user_buffer)
        print("[DEBUG] Text chat đã được buffer, chờ frontend idle timer flush.")
        return {
            "status": "buffered",
            "buffered_text": combined_text,
            "reason": "Waiting for text input idle timeout.",
        }

    def flush_chat(self, bot_pronoun: str | None = None, user_pronoun: str | None = None) -> MvpPipelineResult | dict:
        if not self.user_buffer:
            return {"status": "empty"}
        
        combined_text = " ".join(self.user_buffer)
        self.user_buffer.clear()
        
        print("[DEBUG] Đang sinh câu trả lời (LLM)...")
        t0 = time.time()
        response_text = self._generate_guarded_response(
            combined_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun, channel="chat"
        )
        t1 = time.time()
        print(f"[DEBUG] Thời gian sinh câu trả lời LLM: {t1 - t0:.2f}")
        print(f"[DEBUG] LLM Trả lời: '{response_text}'")
        
        tts_result = self.tts.synthesize_text(response_text)
        self._remember(combined_text, response_text)
        result = MvpPipelineResult(
            input_text=combined_text,
            response_text=response_text,
            audio_path=tts_result.audio_path,
            tts_engine=tts_result.engine,
        )
        self._write_response_sidecars(result, channel="chat")
        return result

    def flush_voice_chat(self, bot_pronoun: str | None = None, user_pronoun: str | None = None, is_timeout: bool = False) -> MvpPipelineResult | dict:
        if not self.voice_buffer:
            print("[WARN] flush_voice_chat: voice_buffer RỖNG")
            return {"status": "empty"}

        combined_text = " ".join(self.voice_buffer)
        
        if is_timeout:
            prompt_text = combined_text + "\n(Lưu ý từ hệ thống: Người dùng có thể đang nói dở câu hoặc ASR bắt nhầm nhiễu. Nếu câu vô nghĩa hoặc chưa rõ ý, hãy hỏi lại ngắn gọn. Nếu đã rõ ý, hãy trả lời bình thường.)"
        else:
            prompt_text = combined_text

        self.voice_buffer.clear()

        print("[DEBUG] Đang sinh câu trả lời Voice Chat (LLM)...")
        t0 = time.time()
        response_text = self._generate_guarded_response(
            prompt_text,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            channel="voice",
            user_text_for_guard=combined_text,
            max_new_tokens=self.config.llm_voice_max_new_tokens,
        )
        t1 = time.time()
        print(f"[DEBUG] Thời gian sinh câu trả lời Voice Chat LLM: {t1 - t0:.2f}s")
        print(f"[DEBUG] LLM Trả lời Voice Chat: '{response_text}'")

        tts_result = self.tts.synthesize_text(response_text)
        self._remember(combined_text, response_text)
        result = MvpPipelineResult(
            input_text=combined_text,
            response_text=response_text,
            audio_path=tts_result.audio_path,
            tts_engine=tts_result.engine,
        )
        self._write_response_sidecars(result, channel="voice")
        return result

    def flush_voice_chat_stream(self, bot_pronoun: str | None = None, user_pronoun: str | None = None, is_timeout: bool = False):
        if not self.voice_buffer:
            print("[WARN] voice_stream: voice_buffer RỖNG — client gọi flush nhưng không có text")
            yield {"status": "empty"}
            return

        combined_text = " ".join(self.voice_buffer)
        timer = LatencyTimer("voice_stream")
        
        if is_timeout:
            prompt_text = combined_text + "\n(Lưu ý từ hệ thống: Người dùng có thể đang nói dở câu hoặc ASR bắt nhầm nhiễu. Nếu câu vô nghĩa hoặc chưa rõ ý, hãy hỏi lại ngắn gọn. Nếu đã rõ ý, hãy trả lời bình thường.)"
        else:
            prompt_text = combined_text

        self.voice_buffer.clear()
        
        request_time = time.time()
        self._latest_request_time = request_time
        
        # Bắn tín hiệu ngắt ngay lập tức cho bất kỳ luồng nào đang chạy
        self.interrupt_event.set()
        
        # Đợi lấy lock (tức là đợi luồng cũ dừng hẳn). Nếu trong lúc đợi có request mới hơn nhảy vào, ta tự hủy.
        while not self.generation_lock.acquire(timeout=0.2):
            if self._latest_request_time != request_time:
                print("[DEBUG] Request cũ bị hủy vì có request mới hơn.")
                yield {"status": "interrupted"}
                return
            print("[DEBUG] Vẫn đang đợi luồng LLM cũ dừng lại...")
        timer.mark("generation_lock_wait")
            
        try:
            # Double check sau khi có lock
            if self._latest_request_time != request_time:
                yield {"status": "interrupted"}
                return
                
            self.interrupt_event.clear()
            print("[DEBUG] Đang sinh câu trả lời Voice Chat Stream (LLM)...")
            
            buffer = ""
            full_response = ""
            spoken_response = ""
            last_spoken_chunk = ""
            tts_lock = threading.Lock()
            first_token_logged = False
            first_tts_logged = False
            tts_chunk_count = 0
            tts_total_ms = 0.0
            
            # Helper to synthesize and yield
            def synthesize_and_yield(text_chunk):
                nonlocal last_spoken_chunk, first_tts_logged, tts_chunk_count, tts_total_ms
                text_chunk = self._guard_response_chunk_for_tts(
                    combined_text, text_chunk, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun
                )
                normalized_chunk = self._normalized_match_text(text_chunk)
                if normalized_chunk and normalized_chunk == self._normalized_match_text(last_spoken_chunk):
                    print(f"[DEBUG] Skip duplicated stream chunk after guard: '{text_chunk}'")
                    return None
                if not text_chunk.strip():
                    return None
                last_spoken_chunk = text_chunk
                try:
                    tts_t0 = time.perf_counter()
                    with tts_lock:
                        tts_res = self.tts.synthesize_text(text_chunk)
                    tts_ms = (time.perf_counter() - tts_t0) * 1000.0
                    tts_chunk_count += 1
                    tts_total_ms += tts_ms
                    if not first_tts_logged:
                        timer.mark("first_tts")
                        first_tts_logged = True
                        print(f"[LATENCY] voice_stream first_tts={tts_ms:.0f}ms chunk='{text_chunk[:40]}'")
                    if getattr(tts_res, 'audio_path', None) and Path(tts_res.audio_path).exists():
                        audio_path = Path(tts_res.audio_path)
                        with open(audio_path, "rb") as f:
                            b64_audio = base64.b64encode(f.read()).decode('utf-8')
                        return {
                            "text_chunk": text_chunk,
                            "audio_base64": b64_audio,
                            "audio_mime": _audio_mime_for_path(audio_path),
                        }
                except Exception as e:
                    print(f"[ERROR] TTS Failed for chunk: {e}")
                return {"text_chunk": text_chunk}

            stop_response = self._stop_response_for_intent(combined_text)
            if stop_response:
                self._apply_stop_intent()
                self._remember(combined_text, stop_response)
                timer.log({"input": combined_text[:80], "stopped": True})
                yield {"status": "stopped", "text_chunk": stop_response}
                yield {"status": "done"}
                return

            direct_response = self._direct_response_for_current_turn(
                combined_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun
            )
            if direct_response:
                chunk_data = synthesize_and_yield(direct_response)
                if chunk_data:
                    yield chunk_data
                self._remember(combined_text, direct_response)
                timer.log(
                    {
                        "input": combined_text[:80],
                        "direct_response": True,
                        "tts_chunks": tts_chunk_count,
                        "tts_total_ms": round(tts_total_ms, 1),
                    }
                )
                yield {"status": "done"}
                return
    
            llm_t0 = time.perf_counter()
            for token in self.response_generator.generate_stream(
                prompt_text, 
                history=self._history_for_turn(combined_text),
                bot_pronoun=bot_pronoun, 
                user_pronoun=user_pronoun,
                interrupt_event=self.interrupt_event,
                pause_lock=tts_lock,
                max_new_tokens=self.config.llm_voice_max_new_tokens,
            ):
                if not first_token_logged:
                    timer.mark("llm_first_token")
                    first_token_logged = True
                    print(f"[LATENCY] voice_stream llm_first_token={(time.perf_counter() - llm_t0) * 1000:.0f}ms")

                if self.interrupt_event.is_set():
                    print("[DEBUG] Bị ngắt lời khi đang sinh phản hồi!")
                    break
                    
                buffer += token
                full_response += token
                # Tách câu đơn giản để trả về audio sớm hơn (không dùng dấu phẩy để tránh câu bị đứt đoạn)
                if any(p in buffer for p in [".", "?", "!", "\n"]):
                    # Cắt ở dấu ngắt câu cuối cùng
                    last_punct_idx = max(buffer.rfind(p) for p in [".", "?", "!", "\n"])
                    sentence = buffer[:last_punct_idx+1].strip()
                    buffer = buffer[last_punct_idx+1:].lstrip()
                    
                    chunk_data = synthesize_and_yield(sentence)
                    if chunk_data:
                        spoken_response += chunk_data.get("text_chunk", "")
                        yield chunk_data
    
            timer.mark("llm_generation")
            if buffer.strip() and not self.interrupt_event.is_set():
                chunk_data = synthesize_and_yield(buffer)
                if chunk_data:
                    spoken_response += chunk_data.get("text_chunk", "")
                    yield chunk_data
                    
            remembered_response = spoken_response.strip() or full_response.strip()
            if remembered_response:
                self._remember(combined_text, remembered_response)
                print(f"[LLM OUT] Voice stream đầy đủ: '{remembered_response}'")
            
            timer.log(
                {
                    "input": combined_text[:80],
                    "tts_chunks": tts_chunk_count,
                    "tts_total_ms": round(tts_total_ms, 1),
                    "interrupted": self.interrupt_event.is_set(),
                    "bottleneck_hint": _latency_bottleneck_hint(timer, tts_total_ms),
                }
            )
            if self.interrupt_event.is_set():
                yield {"status": "interrupted"}
            else:
                yield {"status": "done"}
        finally:
            self.generation_lock.release()

    def handle_audio_file(self, audio_path: str | Path, bot_pronoun: str | None = None, user_pronoun: str | None = None) -> MvpPipelineResult:
        # Legacy method (synchronous, no buffering)
        transcript = self.asr.transcribe_file(audio_path)
        self._write_input_sidecars(audio_path, transcript, channel="audio", status="transcribed")
        result = self.handle_text(transcript, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        final_result = MvpPipelineResult(
            input_text=result.input_text,
            response_text=result.response_text,
            audio_path=result.audio_path,
            tts_engine=result.tts_engine,
            input_audio_path=str(audio_path),
        )
        self._write_response_sidecars(final_result, channel="audio")
        return final_result

    def handle_voice_chat(
        self,
        audio_path: str | Path,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        owner_name: str | None = None,
    ) -> MvpPipelineResult | dict:
        print("\n[DEBUG] Bắt đầu xử lý Voice Chat (PhoWhisper)...")
        t0 = time.perf_counter()
        transcript = self.asr.transcribe_file(audio_path)
        asr_ms = (time.perf_counter() - t0) * 1000.0
        print(f"[LATENCY] pho_whisper_asr={asr_ms:.0f}ms transcript='{transcript[:80]}'")

        self._write_input_sidecars(
            audio_path,
            transcript,
            channel="voice",
            status="transcribed",
            owner_name=owner_name,
        )
        print(f"[DEBUG] Kết quả ASR: '{transcript}'")
        if self._is_whisper_hallucination(transcript):
            reason = f"Nhiễu ảo giác ASR: {transcript}"
            print(f"[DEBUG] Bỏ qua vì dính ASR ảo giác: {transcript}")
            self._write_input_sidecars(
                audio_path,
                transcript,
                channel="voice",
                status="ignored",
                reason=reason,
                owner_name=owner_name,
            )
            return {"status": "ignored", "input_text": transcript, "reason": reason}

        print("[DEBUG] Chuyển kết quả ASR sang pipeline Voice Chat...")
        voice_user_pronoun = user_pronoun or owner_name
        result = self.handle_voice_transcript(transcript, bot_pronoun=bot_pronoun, user_pronoun=voice_user_pronoun)

        if isinstance(result, dict):
            result.setdefault("input_text", transcript)
            return result

        final_result = MvpPipelineResult(
            input_text=result.input_text,
            response_text=result.response_text,
            audio_path=result.audio_path,
            tts_engine=result.tts_engine,
            input_audio_path=str(audio_path),
        )
        self._write_response_sidecars(final_result, channel="voice")
        return final_result

    def handle_voice_transcript(
        self,
        text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
    ) -> MvpPipelineResult | dict:
        clean_text = text.strip()
        timer = LatencyTimer("voice_transcript")
        print(f"\n[DEBUG] Pipeline Voice xử lý Text: '{clean_text}'")
        if self._looks_like_voice_noise(clean_text):
            print("[DEBUG] Bỏ qua voice transcript vì giống tiếng đệm/nhiễu.")
            return {"status": "ignored", "input_text": clean_text, "reason": "Transcript giống tiếng đệm hoặc nhiễu."}

        if self._looks_like_assistant_echo(clean_text):
            print("[DEBUG] Bỏ qua voice transcript vì giống echo câu trả lời của Lumi.")
            return {"status": "ignored", "input_text": clean_text, "reason": "Có vẻ là tiếng phản hồi của Lumi bị micro thu lại."}

        if self._is_whisper_hallucination(clean_text) and self.voice_buffer:
            print(f"[DEBUG] Bỏ qua ASR ảo giác, giữ buffer user: '{clean_text[:80]}'")
            return {
                "status": "ignored",
                "input_text": clean_text,
                "reason": "Ảo giác PhoWhisper — không ghi đè câu Web Speech đang chờ.",
            }

        stop_response = self._stop_response_for_intent(clean_text)
        if stop_response:
            self._apply_stop_intent()
            self._remember(clean_text, stop_response)
            tts_result = self.tts.synthesize_text(stop_response)
            print(f"[LATENCY] voice_stop TTS text='{clean_text}'")
            return {
                "status": "stopped",
                "input_text": clean_text,
                "response_text": stop_response,
                "audio_path": str(tts_result.audio_path),
                "tts_engine": tts_result.engine,
            }

        addressee_decision = self.voice_addressee_detector.detect(clean_text, self.history)
        if not addressee_decision.addressed and addressee_decision.confidence > 0.85:
            print(f"[DEBUG] Không nói chuyện với Lumi: {addressee_decision.reason}")
            return {"status": "ignored", "input_text": clean_text, "reason": addressee_decision.reason}

        self.voice_buffer.append(clean_text)
        combined_text = " ".join(self.voice_buffer)
        wait_ms = 1700
        reason = "Voice input buffered; waiting for speech idle timeout before one combined response."
        is_complete = False

        if self.turn_detector:
            print("[DEBUG] Kiểm tra Turn-taking để tính thời gian chờ voice...")
            segment = TranscriptSegment(text=combined_text)
            turn_decision = self.turn_detector.decide(segment, speech_gap_seconds=1.0)
            timer.mark("turn_taking")
            reason = turn_decision.reason
            is_complete = turn_decision.is_complete
            if turn_decision.is_complete:
                # Complete voice turns should flush almost immediately; the
                # frontend still keeps a tiny debounce for trailing ASR fragments.
                wait_ms = min(max(120, turn_decision.wait_ms), 250)
                print(f"[DEBUG] Voice đã có ý hoàn chỉnh, flush nhanh sau {wait_ms}ms.")
            else:
                wait_ms = max(1400, turn_decision.wait_ms)
                print(f"[DEBUG] Người dùng có thể chưa nói xong: {turn_decision.reason}")

        timer.log(
            {
                "stt_source": "web_speech",
                "input": clean_text[:80],
                "wait_ms": wait_ms,
                "is_complete": is_complete,
            }
        )

        return {
            "status": "buffered",
            "input_text": clean_text,
            "buffered_text": combined_text,
            "reason": reason,
            "wait_ms": wait_ms,
            "is_complete": is_complete,
        }

    def _is_whisper_hallucination(self, text: str) -> bool:
        lowered = text.lower()
        normalized = self._normalized_match_text(text)
        if any(h.lower() in lowered for h in VOICE_ASR_HALLUCINATIONS):
            return True
        if "thay the" in normalized and "chat luong" in normalized:
            return True
        if "tang truong" in normalized and len(normalized.split()) >= 5:
            return True
        if lowered.startswith("day la mot trong nhung"):
            return True
        return False

    def _looks_like_garbled_transcript(self, text: str) -> bool:
        """Heuristic: Web Speech đôi khi lặp từ/cụm vô nghĩa — không nên kích hoạt safety template."""
        normalized = self._normalized_match_text(text)
        tokens = normalized.split()
        if len(tokens) < 6:
            return False

        unique_ratio = len(set(tokens)) / len(tokens)
        if unique_ratio < 0.5:
            return True

        if len(tokens) >= 8:
            bigrams = [" ".join(tokens[i : i + 2]) for i in range(len(tokens) - 1)]
            counts: dict[str, int] = {}
            for bigram in bigrams:
                counts[bigram] = counts.get(bigram, 0) + 1
            if counts and max(counts.values()) >= 3:
                return True

        return False

    def _looks_like_voice_noise(self, text: str) -> bool:
        normalized = _normalize(text)
        if not normalized:
            return True

        tokens = normalized.split()
        if len(tokens) <= 2 and all(token in VOICE_FILLER_TOKENS for token in tokens):
            return True

        return False

    def _looks_like_assistant_echo(self, text: str) -> bool:
        normalized = _normalize(text)
        if len(normalized.split()) < 4:
            return False

        last_assistant_text = ""
        for item in reversed(self.history):
            if item.get("role") == "assistant":
                last_assistant_text = item.get("content", "")
                break

        if not last_assistant_text:
            return False

        normalized_last = _normalize(last_assistant_text)
        if not normalized_last:
            return False

        if normalized in normalized_last or normalized_last in normalized:
            return True

        current_tokens = set(normalized.split())
        assistant_tokens = set(normalized_last.split())
        if not current_tokens or not assistant_tokens:
            return False

        overlap = len(current_tokens & assistant_tokens) / len(current_tokens)
        return overlap >= 0.68

    def _generate_guarded_response(
        self,
        prompt_text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        channel: str = "chat",
        user_text_for_guard: str | None = None,
        max_new_tokens: int | None = None,
    ) -> str:
        user_text = user_text_for_guard or prompt_text
        direct_response = self._direct_response_for_current_turn(
            user_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun
        )
        if direct_response:
            return direct_response

        response_text = self._generate_response(
            prompt_text,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            max_new_tokens=max_new_tokens,
            history_override=self._history_for_turn(user_text),
        )
        response_text = self._trim_to_one_question(response_text)
        reason = self._response_retry_reason(user_text, response_text)
        if not reason:
            return response_text

        print(f"[DEBUG] Guard response retry ({channel}): {reason}. response='{response_text}'")
        retry_prompt = self._strict_regeneration_prompt(user_text, response_text, user_pronoun=user_pronoun)
        retry_text = self._generate_response(
            retry_prompt,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            max_new_tokens=max_new_tokens,
            temperature=min(self.config.llm_temperature, 0.3),
            history_override=[],
        )
        retry_text = self._trim_to_one_question(retry_text)
        if not self._response_retry_reason(user_text, retry_text):
            return retry_text

        fallback = self._fallback_response(user_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
        print(f"[DEBUG] Guard response fallback ({channel}): '{fallback}'")
        return fallback

    def _guard_response_chunk_for_tts(
        self,
        user_text: str,
        response_text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
    ) -> str:
        """Light guard for individual stream chunks.

        Unlike ``_response_retry_reason`` (designed for full responses), this
        only blocks truly harmful content.  ``question_before_answer`` is NOT
        checked here because in streaming the answer may arrive in the *next*
        chunk.  Blocked chunks are silently skipped (empty string) rather than
        replaced with a keyword fallback, so the remaining good chunks still
        reach the user.
        """
        response_text = self._trim_to_one_question(response_text)
        if not response_text.strip():
            return ""
        if self._contains_non_vietnamese_script(response_text):
            print(f"[DEBUG] Guard stream chunk skip (non_vietnamese_script): '{response_text[:80]}'")
            return ""
        if self._contains_persona_violation(response_text):
            print(f"[DEBUG] Guard stream chunk skip (persona_violation): '{response_text[:80]}'")
            return ""
        if self._leaks_internal_prompt(response_text):
            print(f"[DEBUG] Guard stream chunk skip (internal_prompt_leak): '{response_text[:80]}'")
            return ""
        return response_text

    def _response_retry_reason(self, user_text: str, response_text: str) -> str | None:
        if not response_text.strip():
            return "empty_response"
        if self._is_empty_followup_question(response_text):
            return "empty_followup_question"
        if self._looks_like_repeated_recent_question(response_text):
            return "repeated_recent_question"
        if self._starts_with_question_without_answer(response_text):
            return "question_before_answer"
        if self._contains_non_vietnamese_script(response_text):
            return "non_vietnamese_script"
        if self._contains_persona_violation(response_text):
            return "persona_violation"
        if self._leaks_internal_prompt(response_text):
            return "internal_prompt_leak"
        return None

    def _strict_regeneration_prompt(self, user_text: str, bad_response: str, user_pronoun: str | None = None) -> str:
        up = user_pronoun or self.config.user_pronoun
        return (
            f"{user_text}\n\n"
            "(Lưu ý hệ thống: Câu trả lời trước bị loại vì lặp câu hỏi, hỏi chuyện cũ, "
            f"hoặc hỏi rỗng: '{bad_response}'. Hãy trả lời lại chỉ dựa trên câu hiện tại của {up}. "
            "Trả lời trước, tối đa 1 câu hỏi liên quan trực tiếp nếu thật cần. "
            f"Không hỏi '{up} muốn nói gì tiếp?' và không nhắc chuyện cũ nếu câu hiện tại có yêu cầu mới. "
            "Bắt buộc chỉ dùng tiếng Việt có dấu, không dùng chữ Trung Quốc/Nhật/Hàn.)"
        )

    def _fallback_response(
        self,
        user_text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
    ) -> str:
        bp = bot_pronoun or self.config.bot_pronoun
        up = user_pronoun or self.config.user_pronoun
        normalized = self._normalized_match_text(user_text)

        direct_response = self._direct_response_for_current_turn(
            user_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun
        )
        if direct_response:
            return direct_response

        if self._contains_any_term(normalized, SADNESS_TERMS):
            return f"{bp} nghe {up} đang buồn. {bp} ở đây với {up}; {up} cứ thở chậm lại một chút trước nhé."
        if self._contains_any_term(normalized, HEALTH_TERMS):
            return (
                f"Trời ơi, {up} thử nghỉ một chút, uống nước ấm và tránh ánh sáng mạnh nhé. "
                f"Nếu triệu chứng nặng hoặc kéo dài, {up} nên nhờ người hỗ trợ hoặc đi khám."
            )
        if self._contains_any_term(normalized, FOOD_TERMS):
            return f"{bp} chốt một lựa chọn đơn giản nhé: {up} ăn món nhẹ, dễ tiêu trước rồi tính tiếp sau."
        if self._contains_any_term(normalized, GREETING_TERMS):
            return f"{bp} đây. {up} muốn kể gì cho {bp} nghe không?"
        return f"{bp} nghe {up} rồi, nhưng đoạn này {bp} sợ hiểu nhầm. {up} nói lại ngắn hơn một chút nhé."

    def _direct_response_for_current_turn(
        self,
        user_text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
    ) -> str | None:
        bp = bot_pronoun or self.config.bot_pronoun
        up = user_pronoun or self.config.user_pronoun
        normalized = self._normalized_match_text(user_text)

        if not normalized:
            return None

        if self._looks_like_garbled_transcript(user_text):
            print(f"[DEBUG] Bỏ qua direct response (ASR có vẻ lỗi/nhiễu): '{user_text[:100]}'")
            return None

        stop_response = self._stop_response_for_normalized_text(normalized)
        if stop_response:
            self._apply_stop_intent()
            return stop_response

        if self._contains_any_term(normalized, CRISIS_TERMS):
            return (
                f"{bp} rất lo cho {up}. Nếu lúc này {up} có ý định làm hại bản thân, "
                f"hãy gọi ngay người thân ở gần hoặc số khẩn cấp tại nơi {up} đang ở. "
                f"{bp} sẽ ở đây với {up}; trước mắt hãy đặt bản thân ở nơi an toàn và gọi một người thật ngay nhé."
            )

        if self._contains_any_term(normalized, DISTRESS_TERMS):
            return (
                f"{bp} nghe là {up} đang rất nặng lòng. {up} không cần phải tự chịu một mình; "
                f"hãy nhắn hoặc gọi một người thân ngay lúc này nếu cảm giác đó mạnh lên. "
                f"{up} có đang nghĩ đến việc làm đau bản thân không?"
            )

        if self._contains_any_term(normalized, UNSAFE_INGESTION_TERMS):
            return (
                f"Không nên, {up}. Việc đó có nguy cơ nhiễm khuẩn, ký sinh trùng hoặc ngộ độc. "
                f"Nếu {up} lỡ ăn phải, hãy súc miệng, uống nước sạch và liên hệ bác sĩ hoặc dược sĩ nếu thấy khó chịu."
            )

        if self._contains_any_term(normalized, GAMBLING_TERMS):
            if self._contains_any_term(normalized, ("danh de", "lo de", "so de")):
                return (
                    f"{bp} không giúp chọn số đánh đề hay cá cược đâu. "
                    f"Mấy việc đó rất dễ mất tiền và cuốn {up} đi xa hơn dự định."
                )
            return (
                f"{bp} không cổ vũ làm app cờ bạc hoặc cá độ. "
                f"Nếu {up} muốn làm sản phẩm, {bp} có thể giúp chuyển ý tưởng sang trò chơi giải trí không tiền thật hoặc công cụ quản lý tài chính lành mạnh hơn."
            )

        if self._contains_any_term(normalized, MEDICATION_TERMS):
            return (
                f"{bp} chưa thể khẳng định {up} có nên uống Panadol không. Nếu đó là paracetamol, "
                f"{up} hãy dùng đúng liều trên hộp, tránh uống thêm thuốc khác cũng chứa paracetamol, "
                f"và hỏi bác sĩ hoặc dược sĩ nếu có bệnh gan, uống rượu nhiều, dị ứng, đang dùng thuốc khác, hoặc đau nặng/kéo dài."
            )

        action = self._detect_action_intent(normalized)
        if action == "water":
            return f"{bp} nghe rồi. {bp} đã ghi nhận yêu cầu lấy nước cho {up}."
        if action == "wake":
            return f"{bp} nghe rồi. {bp} đã ghi nhận yêu cầu gọi {up} dậy."
        if action == "follow":
            return f"{bp} nghe rồi. {bp} đã ghi nhận yêu cầu đi theo {up}."
        if action == "stop":
            return f"{bp} dừng lại ngay."

        if self._contains_any_term(normalized, PERSONA_ROLE_TERMS):
            return f"Không, {up}. {bp} là robot bạn đồng hành hỗ trợ {up}, không tự nhận là mẹ hay người thân của {up}."

        if self._asks_lumi_age(normalized):
            return f"{bp} không có tuổi như con người. {bp} là robot bạn đồng hành đang được phát triển để hỗ trợ trò chuyện hằng ngày."

        if self._is_simple_greeting(normalized):
            return f"{bp} đây. {up} muốn kể gì cho {bp} nghe không?"

        return None

    def _stop_response_for_intent(self, text: str) -> str | None:
        return self._stop_response_for_normalized_text(self._normalized_match_text(text))

    def _stop_response_for_normalized_text(self, normalized: str) -> str | None:
        tokens = normalized.split()
        for terms, response in STOP_RESPONSE_TERMS:
            for term in terms:
                normalized_term = self._normalized_match_text(term)
                if not normalized_term:
                    continue
                if normalized_term in STOP_SINGLE_WORD_TERMS:
                    if tokens == [normalized_term]:
                        return response
                elif self._contains_term(normalized, term):
                    return response
        return None

    def _apply_stop_intent(self) -> None:
        self.interrupt_event.set()
        self.user_buffer.clear()
        self.voice_buffer.clear()

    def _detect_action_intent(self, normalized: str) -> str | None:
        if re.search(r"\b(lay|mang|dua)\b.{0,30}\b(nuoc|ly nuoc|coc nuoc)\b", normalized):
            return "water"
        if self._contains_any_term(normalized, ("goi toi day", "goi minh day", "danh thuc toi", "danh thuc minh")):
            return "wake"
        if self._contains_any_term(normalized, ("di theo toi", "di theo minh", "theo toi", "theo minh")):
            return "follow"
        if self._contains_any_term(normalized, ("dung lai", "dung di", "dung thoi", "thoi dung")):
            return "stop"
        return None

    def _asks_lumi_age(self, normalized: str) -> bool:
        return "lumi" in normalized and self._contains_any_term(
            normalized, ("bao nhieu tuoi", "may tuoi", "tuoi cua lumi")
        )

    def _is_simple_greeting(self, normalized: str) -> bool:
        tokens = normalized.split()
        return len(tokens) <= 4 and self._contains_any_term(normalized, GREETING_TERMS)

    def _history_for_turn(self, user_text: str) -> list[dict[str, str]]:
        """Always return recent history so Lumi remembers conversation context.

        Trước đây dùng heuristic phức tạp (followup terms, short tokens) để quyết
        định có gửi history không. Điều đó khiến Lumi "quên" context trong đa số
        lượt hội thoại. Nay luôn gửi 8 messages gần nhất (4 lượt user+assistant)
        để đảm bảo Mượt mà và Tự nhiên theo tiêu chí đánh giá.
        """
        return self.history[-8:]

    def _normalized_match_text(self, text: str) -> str:
        normalized = _normalize(text)
        normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
        return re.sub(r"\s+", " ", normalized).strip()

    def _contains_any_term(self, normalized: str, terms: tuple[str, ...]) -> bool:
        return any(self._contains_term(normalized, term) for term in terms)

    def _contains_term(self, normalized: str, term: str) -> bool:
        normalized_term = self._normalized_match_text(term)
        if not normalized_term:
            return False
        return re.search(rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])", normalized) is not None

    def _trim_to_one_question(self, text: str) -> str:
        parts = self._split_sentences(text)
        if not parts:
            return text.strip()
        kept: list[str] = []
        question_seen = False
        for part in parts:
            if self._is_question_sentence(part):
                if question_seen:
                    continue
                question_seen = True
            kept.append(part.strip())
        return " ".join(part for part in kept if part).strip()

    def _is_empty_followup_question(self, text: str) -> bool:
        normalized = _normalize(text)
        if len(normalized.split()) > 14:
            return False
        return any(pattern in normalized for pattern in EMPTY_FOLLOWUP_PATTERNS)

    def _starts_with_question_without_answer(self, text: str) -> bool:
        parts = self._split_sentences(text)
        if not parts:
            return False
        for idx, part in enumerate(parts):
            if not part.strip():
                continue
            if self._is_question_sentence(part):
                return idx == 0 or not any(not self._is_question_sentence(prev) for prev in parts[:idx])
            return False
        return False

    def _looks_like_repeated_recent_question(self, text: str) -> bool:
        candidates = [part for part in self._split_sentences(text) if self._is_question_sentence(part)]
        if not candidates and self._is_question_sentence(text):
            candidates = [text]
        if not candidates:
            return False

        recent_questions = self._recent_assistant_questions()
        for candidate in candidates:
            normalized_candidate = _normalize(candidate)
            for recent in recent_questions:
                normalized_recent = _normalize(recent)
                if self._token_similarity(normalized_candidate, normalized_recent) >= 0.78:
                    return True
                if len(normalized_candidate.split()) >= 5 and normalized_candidate in normalized_recent:
                    return True
                if len(normalized_recent.split()) >= 5 and normalized_recent in normalized_candidate:
                    return True
        return False

    def _recent_assistant_questions(self) -> list[str]:
        questions: list[str] = []
        assistant_seen = 0
        for item in reversed(self.history):
            if item.get("role") != "assistant":
                continue
            assistant_seen += 1
            for part in self._split_sentences(item.get("content", "")):
                if self._is_question_sentence(part):
                    questions.append(part)
            if assistant_seen >= RECENT_QUESTION_LOOKBACK:
                break
        return questions

    def _split_sentences(self, text: str) -> list[str]:
        return [
            match.group(0).strip()
            for match in re.finditer(r"[^.!?\n]+[.!?]?", text)
            if match.group(0).strip()
        ]

    def _is_question_sentence(self, text: str) -> bool:
        normalized = re.sub(r"[^a-z0-9\s]", "", _normalize(text)).strip()
        if not normalized:
            return False
        if "?" in text:
            return True
        tokens = normalized.split()
        if not tokens:
            return False
        last_token = tokens[-1]
        last_phrase = " ".join(tokens[-2:]) if len(tokens) >= 2 else last_token
        return last_token in QUESTION_LAST_TOKENS or last_phrase in QUESTION_LAST_PHRASES

    def _token_similarity(self, first: str, second: str) -> float:
        first_tokens = set(first.split())
        second_tokens = set(second.split())
        if not first_tokens or not second_tokens:
            return 0.0
        return len(first_tokens & second_tokens) / max(1, min(len(first_tokens), len(second_tokens)))

    def _contains_non_vietnamese_script(self, text: str) -> bool:
        return CJK_TEXT_RE.search(text) is not None

    def _contains_persona_violation(self, text: str) -> bool:
        normalized = self._normalized_match_text(text)
        violation_terms = (
            "con trai ngoan",
            "con gai ngoan",
            "me chieu",
            "me day",
            "me la",
            "bo la",
            "ba la",
            "nguoi yeu cua",
            "chong cua",
            "vo cua",
        )
        return self._contains_any_term(normalized, violation_terms)

    def _leaks_internal_prompt(self, text: str) -> bool:
        normalized = self._normalized_match_text(text)
        leak_terms = (
            "quy tac so",
            "luu y he thong",
            "system prompt",
            "theo prompt",
            "yeu cau he thong",
            "noi bo",
        )
        return self._contains_any_term(normalized, leak_terms)

    def _generate_response(
        self,
        text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
        history_override: list[dict[str, str]] | None = None,
    ) -> str:
        generate = self.response_generator.generate
        kwargs = {"bot_pronoun": bot_pronoun, "user_pronoun": user_pronoun}
        try:
            params = inspect.signature(generate).parameters
            accepts_kwargs = any(param.kind == inspect.Parameter.VAR_KEYWORD for param in params.values())
            if accepts_kwargs or "max_new_tokens" in params:
                kwargs["max_new_tokens"] = max_new_tokens
            if accepts_kwargs or "temperature" in params:
                kwargs["temperature"] = temperature
        except (TypeError, ValueError):
            pass
        history = self._history_for_turn(text) if history_override is None else history_override
        return generate(text, history, **kwargs)

    def _write_response_sidecars(self, result: MvpPipelineResult, channel: str) -> None:
        write_audio_sidecars(
            result.audio_path,
            result.response_text,
            {
                "audio_role": "assistant_response",
                "channel": channel,
                "input_text": result.input_text,
                "response_text": result.response_text,
                "input_audio_path": result.input_audio_path,
                "tts_engine": result.tts_engine,
                "tts_provider": self.config.tts_provider,
                "tts_voice": self.config.tts_voice,
                "llm_provider": self.config.response_provider,
                "llm_model": self.config.llm_model,
            },
        )

    def _write_input_sidecars(
        self,
        audio_path: str | Path,
        transcript: str,
        channel: str,
        status: str,
        reason: str | None = None,
        owner_name: str | None = None,
        speaker_info: str | None = None,
    ) -> None:
        text = transcript.strip()
        if not text and reason:
            text = f"[Không có transcript]\n{reason}"
        write_audio_sidecars(
            audio_path,
            text,
            {
                "audio_role": "user_input",
                "channel": channel,
                "status": status,
                "input_text": transcript,
                "reason": reason,
                "owner_name": owner_name,
                "speaker_info": speaker_info,
                "asr_provider": self.config.asr_provider,
                "asr_model": self.config.asr_model,
            },
        )

    def _remember(self, user_text: str, response_text: str) -> None:
        self.history.append({"role": "user", "content": user_text})
        self.history.append({"role": "assistant", "content": response_text})
        # Giữ tối đa 20 messages (10 lượt) để RAM ổn định trong session dài.
        # Luôn giữ phần tử đầu (lời chào mở đầu của Lumi) không bị xóa.
        if len(self.history) > 20:
            self.history = self.history[:1] + self.history[-19:]

    def clear_history(self) -> None:
        self.history.clear()
        self.history.append({"role": "assistant", "content": "Xin chào, Lumi đây. Bạn cần Lumi giúp gì không?"})
        self.user_buffer.clear()
        self.voice_buffer.clear()


def _audio_mime_for_path(audio_path: Path) -> str:
    suffix = audio_path.suffix.lower()
    if suffix == ".mp3":
        return "audio/mpeg"
    if suffix == ".ogg":
        return "audio/ogg"
    return "audio/wav"


def _latency_bottleneck_hint(timer: LatencyTimer, tts_total_ms: float) -> str:
    stages = timer.stages
    llm_ms = stages.get("llm_generation", 0.0) + stages.get("llm_first_token", 0.0)
    lock_ms = stages.get("generation_lock_wait", 0.0)
    first_tts_ms = stages.get("first_tts", 0.0)
    if tts_total_ms > llm_ms and tts_total_ms > lock_ms:
        return "tts_chunked (TTS chunk đầu chậm hơn LLM)"
    if llm_ms > lock_ms and llm_ms > tts_total_ms:
        return "llm_generation (Qwen trên GPU — không phải mạng localhost)"
    if lock_ms > 500:
        return "generation_lock_wait (luồng cũ chưa dừng)"
    if first_tts_ms > 2000:
        return "first_tts_slow (TTS chunk đầu)"
    return "mixed_or_buffer_wait (xem frontend buffer_ms)"


def _build_asr(config: LumiConfig):
    if config.asr_provider == "phowhisper":
        return PhoWhisperASR(config)
    raise ValueError(f"ASR provider chưa hỗ trợ: {config.asr_provider}")


def _build_response_generator(config: LumiConfig):
    if config.response_provider == "qwen":
        return QwenLocalResponseGenerator(config)
    if config.response_provider == "template":
        return TemplateChatGenerator()
    raise ValueError(f"Response provider chưa hỗ trợ: {config.response_provider}")


def _build_tts(config: LumiConfig):
    return create_tts_provider(config)
