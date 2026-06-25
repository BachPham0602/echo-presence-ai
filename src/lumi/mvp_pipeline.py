from __future__ import annotations

from pathlib import Path
import inspect
import re

from lumi.config import LumiConfig
from lumi.models import MvpPipelineResult
from lumi.providers.asr import PhoWhisperASR
import time
from datetime import datetime
from lumi.providers.llm import QwenLocalResponseGenerator, TemplateChatGenerator
from lumi.providers.tts import NoAudioTTS, VieNeuTTS
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


class LumiMvpPipeline:
    """MVP model-first: text/audio input -> LLM text response -> TTS audio.

    Các hook turn_detector, addressee_detector, speaker_verifier, emotion_classifier
    được giữ trong constructor để sau này tích hợp, nhưng hiện tại không chạy.
    """

    def __init__(
        self,
        config: LumiConfig | None = None,
        asr=None,
        response_generator=None,
        tts=None,
        turn_detector=None,
        addressee_detector=None,
        speaker_verifier=None,
        emotion_classifier=None,
    ):
        self.config = config or LumiConfig.from_env()
        self.config.apply_cuda_visible_devices()
        self.history: list[dict[str, str]] = [
            {"role": "assistant", "content": "Xin chào, tôi là Lumi. Bạn cần tôi giúp gì không?"}
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
        from lumi.providers.speaker import RealSpeakerVerifier
        self.speaker_verifier = speaker_verifier or RealSpeakerVerifier(
            owner_voice_dir=self.config.owner_voice_path,
            speaker_model=self.config.speaker_model,
        )
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
        print(f"[DEBUG] Thời gian sinh câu trả lời LLM: {t1 - t0:.2f}s")
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
            yield {"status": "empty"}
            return

        combined_text = " ".join(self.voice_buffer)
        
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
            tts_lock = threading.Lock()
            
            # Helper to synthesize and yield
            def synthesize_and_yield(text_chunk):
                text_chunk = self._guard_response_chunk_for_tts(
                    combined_text, text_chunk, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun
                )
                if not text_chunk.strip():
                    return None
                try:
                    import torch
                    with tts_lock:
                        torch.cuda.empty_cache()
                        tts_res = self.tts.synthesize_text(text_chunk)
                    if getattr(tts_res, 'audio_path', None) and Path(tts_res.audio_path).exists():
                        with open(tts_res.audio_path, "rb") as f:
                            b64_audio = base64.b64encode(f.read()).decode('utf-8')
                        return {"text_chunk": text_chunk, "audio_base64": b64_audio}
                except Exception as e:
                    print(f"[ERROR] TTS Failed for chunk: {e}")
                return {"text_chunk": text_chunk}
    
            for token in self.response_generator.generate_stream(
                prompt_text, 
                history=self.history,
                bot_pronoun=bot_pronoun, 
                user_pronoun=user_pronoun,
                interrupt_event=self.interrupt_event,
                pause_lock=tts_lock,
                max_new_tokens=self.config.llm_voice_max_new_tokens,
            ):
                if self.interrupt_event.is_set():
                    print("[DEBUG] Bị ngắt lời khi đang sinh phản hồi!")
                    break
                    
                buffer += token
                full_response += token
                # Tách câu đơn giản để trả về audio sớm hơn (không dùng dấu phẩy để tránh câu bị đứt đoạn)
                if any(p in buffer for p in [".", "?", "!", "\n"]):
                    # Cắt ở dấu ngắt câu cuối cùng
                    last_punct_idx = max(buffer.rfind(p) for p in [".", "?", "!", "\n"])
                    sentence = buffer[:last_punct_idx+1]
                    buffer = buffer[last_punct_idx+1:]
                    
                    chunk_data = synthesize_and_yield(sentence)
                    if chunk_data:
                        spoken_response += chunk_data.get("text_chunk", "")
                        yield chunk_data
    
            if buffer.strip() and not self.interrupt_event.is_set():
                chunk_data = synthesize_and_yield(buffer)
                if chunk_data:
                    spoken_response += chunk_data.get("text_chunk", "")
                    yield chunk_data
                    
            remembered_response = spoken_response.strip() or full_response.strip()
            if remembered_response:
                self._remember(combined_text, remembered_response)
            
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
        print("\n[DEBUG] Bắt đầu xử lý Voice Chat...")
        speaker_info = None
        
        import concurrent.futures
        
        def run_sv():
            # Tạm tắt Speaker Verifier theo yêu cầu để tăng tốc độ phản hồi
            return None

        def run_asr():
            t0 = time.time()
            transcript = self.asr.transcribe_file(audio_path)
            t1 = time.time()
            print(f"[DEBUG] Thời gian giải mã ASR: {t1 - t0:.2f}s")
            return transcript

        print("[DEBUG] Đang chạy song song Speaker Verifier và ASR...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_sv = executor.submit(run_sv)
            future_asr = executor.submit(run_asr)
            
            speaker_decision = future_sv.result()
            transcript = future_asr.result()

        if speaker_decision:
            speaker_info = speaker_decision.reason
            if not speaker_decision.verified:
                reason = f"Không phải chủ nhân. {speaker_decision.reason}"
                print(f"[DEBUG] Bỏ qua: Không phải chủ nhân.")
                self._write_input_sidecars(
                    audio_path,
                    "",
                    channel="voice",
                    status="ignored",
                    reason=reason,
                    owner_name=owner_name,
                    speaker_info=speaker_info,
                )
                return {"status": "ignored", "reason": reason}

        self._write_input_sidecars(
            audio_path,
            transcript,
            channel="voice",
            status="transcribed",
            owner_name=owner_name,
            speaker_info=speaker_info,
        )
        print(f"[DEBUG] Kết quả ASR: '{transcript}'")
        # Loại bỏ các ảo giác thông dụng của Whisper nếu ở trong môi trường ồn
        for h in VOICE_ASR_HALLUCINATIONS:
            if h.lower() in transcript.lower():
                reason = f"Nhiễu ảo giác ASR: {transcript}"
                print(f"[DEBUG] Bỏ qua vì dính ASR ảo giác: {transcript}")
                self._write_input_sidecars(
                    audio_path,
                    transcript,
                    channel="voice",
                    status="ignored",
                    reason=reason,
                    owner_name=owner_name,
                    speaker_info=speaker_info,
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
        print(f"\n[DEBUG] Pipeline Voice xử lý Text: '{clean_text}'")
        if self._looks_like_voice_noise(clean_text):
            print("[DEBUG] Bỏ qua voice transcript vì giống tiếng đệm/nhiễu.")
            return {"status": "ignored", "input_text": clean_text, "reason": "Transcript giống tiếng đệm hoặc nhiễu."}

        if self._looks_like_assistant_echo(clean_text):
            print("[DEBUG] Bỏ qua voice transcript vì giống echo câu trả lời của Lumi.")
            return {"status": "ignored", "input_text": clean_text, "reason": "Có vẻ là tiếng phản hồi của Lumi bị micro thu lại."}

        addressee_decision = self.voice_addressee_detector.detect(clean_text, self.history)
        if not addressee_decision.addressed and addressee_decision.confidence > 0.8:
            print(f"[DEBUG] Không nói chuyện với Lumi: {addressee_decision.reason}")
            return {"status": "ignored", "input_text": clean_text, "reason": addressee_decision.reason}

        self.voice_buffer.append(clean_text)
        combined_text = " ".join(self.voice_buffer)
        wait_ms = 2500
        reason = "Voice input buffered; waiting for speech idle timeout before one combined response."

        if self.turn_detector:
            print("[DEBUG] Kiểm tra Turn-taking để tính thời gian chờ voice...")
            segment = TranscriptSegment(text=combined_text)
            t0 = time.time()
            turn_decision = self.turn_detector.decide(segment, speech_gap_seconds=1.0)
            t1 = time.time()
            print(f"[DEBUG] Thời gian Turn-taking LLM: {t1 - t0:.2f}s")
            reason = turn_decision.reason
            if turn_decision.is_complete:
                # Voice chat must debounce across short pauses so multiple spoken
                # sentences become one LLM/TTS turn instead of overlapping answers.
                wait_ms = max(2200, turn_decision.wait_ms)
                print("[DEBUG] Voice đã có ý hoàn chỉnh, nhưng vẫn buffer để chờ câu tiếp theo.")
            else:
                wait_ms = max(2500, turn_decision.wait_ms)
                print(f"[DEBUG] Người dùng có thể chưa nói xong: {turn_decision.reason}")

        return {
            "status": "buffered",
            "input_text": clean_text,
            "buffered_text": combined_text,
            "reason": reason,
            "wait_ms": wait_ms,
        }

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
        response_text = self._generate_response(
            prompt_text,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            max_new_tokens=max_new_tokens,
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
        response_text = self._trim_to_one_question(response_text)
        reason = self._response_retry_reason(user_text, response_text)
        if reason:
            print(f"[DEBUG] Guard stream chunk fallback: {reason}. chunk='{response_text}'")
            return self._fallback_response(user_text, bot_pronoun=bot_pronoun, user_pronoun=user_pronoun)
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
        return None

    def _strict_regeneration_prompt(self, user_text: str, bad_response: str, user_pronoun: str | None = None) -> str:
        up = user_pronoun or self.config.user_pronoun
        return (
            f"{user_text}\n\n"
            "(Lưu ý hệ thống: Câu trả lời trước bị loại vì lặp câu hỏi, hỏi chuyện cũ, "
            f"hoặc hỏi rỗng: '{bad_response}'. Hãy trả lời lại chỉ dựa trên câu hiện tại của {up}. "
            "Trả lời trước, tối đa 1 câu hỏi liên quan trực tiếp nếu thật cần. "
            f"Không hỏi '{up} muốn nói gì tiếp?' và không nhắc chuyện cũ nếu câu hiện tại có yêu cầu mới.)"
        )

    def _fallback_response(
        self,
        user_text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
    ) -> str:
        bp = bot_pronoun or self.config.bot_pronoun
        up = user_pronoun or self.config.user_pronoun
        normalized = _normalize(user_text)
        if any(term in normalized for term in HEALTH_TERMS):
            return (
                f"Trời ơi, {up} thử nghỉ một chút, uống nước ấm và tránh ánh sáng mạnh nhé. "
                f"Nếu triệu chứng nặng hoặc kéo dài, {up} nên nhờ người hỗ trợ hoặc đi khám."
            )
        if any(term in normalized for term in FOOD_TERMS):
            return f"{bp} chốt một lựa chọn đơn giản nhé: {up} ăn món nhẹ, dễ tiêu trước rồi tính tiếp sau."
        return f"{bp} nghe rồi. {bp} sẽ bám vào điều {up} vừa nói và trả lời ngắn gọn hơn."

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

    def _generate_response(
        self,
        text: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
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
        return generate(text, self.history, **kwargs)

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
                "speaker_model": self.config.speaker_model,
            },
        )

    def _remember(self, user_text: str, response_text: str) -> None:
        self.history.append({"role": "user", "content": user_text})
        self.history.append({"role": "assistant", "content": response_text})

    def clear_history(self) -> None:
        self.history.clear()
        self.history.append({"role": "assistant", "content": "Xin chào, tôi là Lumi. Bạn cần tôi giúp gì không?"})
        self.user_buffer.clear()
        self.voice_buffer.clear()


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
    if config.tts_provider == "vieneu":
        return VieNeuTTS(config)
    if config.tts_provider in {"edgetts", "edge-tts"}:
        from lumi.providers.tts import EdgeTTS
        return EdgeTTS(config)
    if config.tts_provider in {"none", "silent", "no-audio"}:
        return NoAudioTTS()
    raise ValueError(f"TTS provider chưa hỗ trợ: {config.tts_provider}")
