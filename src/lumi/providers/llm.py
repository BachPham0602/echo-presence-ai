from __future__ import annotations

import threading

from lumi.config import LumiConfig
from lumi.errors import MissingDependencyError
from lumi.latency_log import ModelTimer
from lumi.prompts import RESPONSE_SYSTEM_PROMPT


class QwenLocalResponseGenerator:
    """Sinh phản hồi bằng Qwen2.5 local qua Transformers."""

    def __init__(self, config: LumiConfig):
        self.config = config
        self._tokenizer = None
        self._model = None
        self._lock = threading.RLock()

    def generate(
        self,
        user_text: str,
        history: list[dict[str, str]],
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        tokenizer, model = self._load_model()
        
        bp = bot_pronoun or self.config.bot_pronoun
        up = user_pronoun or self.config.user_pronoun
        
        forbidden_bot = ["tôi", "mình", "tớ", "chúng tôi"]
        forbidden_bot = [w for w in forbidden_bot if w.lower() != bp.lower()]
        
        forbidden_user = ["bạn", "các bạn", "mọi người"]
        forbidden_user = [w for w in forbidden_user if w.lower() != up.lower()]
        
        forbidden_all = forbidden_bot + forbidden_user
        forbidden_rule = f"- TUYỆT ĐỐI KHÔNG dùng các từ: {', '.join(forbidden_all)}" if forbidden_all else ""
        
        system_prompt = RESPONSE_SYSTEM_PROMPT.format(
            bot_pronoun=bp,
            user_pronoun=up,
            forbidden_pronouns_rule=forbidden_rule
        )
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-8:])
        messages.append({"role": "user", "content": user_text})

        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        model_inputs = tokenizer([prompt], return_tensors="pt").to(model.device)
        with ModelTimer(f"llm/{self.config.llm_model}", method="generate", detail=user_text[:80]):
            try:
                generation_kwargs = self._generation_kwargs(model_inputs, max_new_tokens, temperature)
                generated_ids = model.generate(**generation_kwargs)
                generated_ids = generated_ids[0][len(model_inputs.input_ids[0]) :]
                result = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
                return result
            finally:
                # Giải phóng VRAM để nhường chỗ cho llama-cpp-python (Vieneu TTS)
                # Thực hiện trong finally để đảm bảo dù có lỗi OOM cũng dọn sạch.
                if 'model_inputs' in locals():
                    del model_inputs
                if 'generated_ids' in locals():
                    del generated_ids
                import torch
                torch.cuda.empty_cache()

    def generate_stream(
        self,
        user_text: str,
        history: list[dict[str, str]],
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        interrupt_event=None,
        pause_lock=None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ):
        tokenizer, model = self._load_model()
        
        bp = bot_pronoun or self.config.bot_pronoun
        up = user_pronoun or self.config.user_pronoun
        
        forbidden_bot = ["tôi", "mình", "tớ", "chúng tôi"]
        forbidden_bot = [w for w in forbidden_bot if w.lower() != bp.lower()]
        
        forbidden_user = ["bạn", "các bạn", "mọi người"]
        forbidden_user = [w for w in forbidden_user if w.lower() != up.lower()]
        
        forbidden_all = forbidden_bot + forbidden_user
        forbidden_rule = f"- TUYỆT ĐỐI KHÔNG dùng các từ: {', '.join(forbidden_all)}" if forbidden_all else ""
        
        system_prompt = RESPONSE_SYSTEM_PROMPT.format(
            bot_pronoun=bp,
            user_pronoun=up,
            forbidden_pronouns_rule=forbidden_rule
        )
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-8:])
        messages.append({"role": "user", "content": user_text})

        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        model_inputs = tokenizer([prompt], return_tensors="pt").to(model.device)
        
        from transformers import TextIteratorStreamer, StoppingCriteria, StoppingCriteriaList
        import threading
        import queue
        
        class InterruptCriteria(StoppingCriteria):
            def __init__(self, event, lock):
                self.event = event
                self.lock = lock
            def __call__(self, input_ids, scores, **kwargs):
                if self.lock:
                    with self.lock:
                        pass # Block if TTS is running
                return self.event is not None and self.event.is_set()

        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        stopping_criteria = StoppingCriteriaList([InterruptCriteria(interrupt_event, pause_lock)])
        
        generation_kwargs = self._generation_kwargs(model_inputs, max_new_tokens, temperature)
        generation_kwargs.update(
            streamer=streamer,
            stopping_criteria=stopping_criteria,
        )
        
        def run_generation():
            model.generate(**generation_kwargs)
        
        thread = threading.Thread(target=run_generation)
        thread.start()

        with ModelTimer(f"llm/{self.config.llm_model}", method="generate_stream", detail=user_text[:80]):
            try:
                while True:
                    try:
                        text = streamer.text_queue.get(timeout=0.1)
                        if text == streamer.stop_signal:
                            break
                        yield text
                    except queue.Empty:
                        if interrupt_event and interrupt_event.is_set():
                            break
            finally:
                thread.join()
                if 'model_inputs' in locals():
                    del model_inputs
                import torch
                torch.cuda.empty_cache()

    def _generation_kwargs(self, model_inputs, max_new_tokens: int | None, temperature: float | None) -> dict:
        effective_temperature = self.config.llm_temperature if temperature is None else temperature
        kwargs = dict(
            **model_inputs,
            max_new_tokens=max_new_tokens or self.config.llm_max_new_tokens,
            do_sample=effective_temperature > 0,
            repetition_penalty=self.config.llm_repetition_penalty,
            no_repeat_ngram_size=self.config.llm_no_repeat_ngram_size,
        )
        if effective_temperature > 0:
            kwargs["temperature"] = effective_temperature
        if getattr(self._tokenizer, "eos_token_id", None) is not None:
            kwargs["pad_token_id"] = self._tokenizer.eos_token_id
        return kwargs

    def generate_classification(self, prompt: str) -> str:
        tokenizer, model = self._load_model()
        messages = [
            {"role": "system", "content": "Bạn là mô hình phân loại. Chỉ trả lời một từ duy nhất theo yêu cầu."},
            {"role": "user", "content": prompt}
        ]
        chat_prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        model_inputs = tokenizer([chat_prompt], return_tensors="pt").to(model.device)
        with ModelTimer(f"llm/{self.config.llm_model}", method="generate_classification", detail=prompt[:80]):
            try:
                generated_ids = model.generate(
                    **model_inputs,
                    max_new_tokens=10,
                    do_sample=False,
                    temperature=0.0,
                )
                generated_ids = generated_ids[0][len(model_inputs.input_ids[0]) :]
                result = tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
                return result
            finally:
                if 'model_inputs' in locals():
                    del model_inputs
                if 'generated_ids' in locals():
                    del generated_ids
                import torch
                torch.cuda.empty_cache()

    def _load_model(self):
        if self._tokenizer is not None and self._model is not None:
            return self._tokenizer, self._model
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as exc:
            raise MissingDependencyError(
                "QwenLocalResponseGenerator cần transformers/torch/accelerate. Cài bằng: pip install -e '.[llm]'"
            ) from exc

        self._tokenizer = AutoTokenizer.from_pretrained(self.config.llm_model)
        self._model = AutoModelForCausalLM.from_pretrained(
            self.config.llm_model,
            torch_dtype="auto",
            device_map="auto",
        )
        return self._tokenizer, self._model


def _lock_qwen_method(method):
    def wrapped(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapped


def _lock_qwen_stream_method(method):
    def wrapped(self, *args, **kwargs):
        def generator():
            with self._lock:
                yield from method(self, *args, **kwargs)

        return generator()

    return wrapped


QwenLocalResponseGenerator.generate = _lock_qwen_method(QwenLocalResponseGenerator.generate)
QwenLocalResponseGenerator.generate_classification = _lock_qwen_method(
    QwenLocalResponseGenerator.generate_classification
)
QwenLocalResponseGenerator.generate_stream = _lock_qwen_stream_method(
    QwenLocalResponseGenerator.generate_stream
)


class TemplateChatGenerator:
    """Provider nhẹ để test orchestration khi chưa tải LLM."""

    def generate(
        self,
        user_text: str,
        history: list[dict[str, str]],
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        with ModelTimer("llm/template", method="generate", detail=user_text[:80]):
            return (
                "Mình nghe bạn nói: "
                f"{user_text}. Mình đang ở đây với bạn, và mình sẽ trả lời nhẹ nhàng từng chút một."
            )

    def generate_classification(self, prompt: str) -> str:
        return "có"
