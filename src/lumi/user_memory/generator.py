from __future__ import annotations

import inspect
from typing import Any, Callable

from lumi.latency_log import ModelTimer
from lumi.prompts import RESPONSE_SYSTEM_PROMPT
from lumi.providers.llm import QwenLocalResponseGenerator, TemplateChatGenerator


class PreferenceInjectingGenerator:
    """Wraps a response generator and appends learned preference hints to the system prompt."""

    def __init__(self, inner: Any, addon_provider: Callable[[], str]):
        self._inner = inner
        self._addon_provider = addon_provider

    def generate(
        self,
        user_text: str,
        history: list[dict[str, str]],
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        addon = self._addon_provider()
        if addon and isinstance(self._inner, QwenLocalResponseGenerator):
            return self._generate_qwen(
                self._inner,
                user_text,
                history,
                addon,
                bot_pronoun=bot_pronoun,
                user_pronoun=user_pronoun,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
            )
        return self._inner.generate(
            user_text,
            history,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
        )

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
        addon = self._addon_provider()
        if addon and isinstance(self._inner, QwenLocalResponseGenerator):
            return self._generate_qwen_stream(
                self._inner,
                user_text,
                history,
                addon,
                bot_pronoun=bot_pronoun,
                user_pronoun=user_pronoun,
                interrupt_event=interrupt_event,
                pause_lock=pause_lock,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
            )
        return self._inner.generate_stream(
            user_text,
            history,
            bot_pronoun=bot_pronoun,
            user_pronoun=user_pronoun,
            interrupt_event=interrupt_event,
            pause_lock=pause_lock,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
        )

    def generate_classification(self, prompt: str) -> str:
        return self._inner.generate_classification(prompt)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    @staticmethod
    def _build_system_prompt(
        config,
        bot_pronoun: str | None,
        user_pronoun: str | None,
        addon: str,
    ) -> str:
        bp = bot_pronoun or config.bot_pronoun
        up = user_pronoun or config.user_pronoun

        forbidden_bot = ["tôi", "mình", "tớ", "chúng tôi"]
        forbidden_bot = [w for w in forbidden_bot if w.lower() != bp.lower()]

        forbidden_user = ["bạn", "các bạn", "mọi người"]
        forbidden_user = [w for w in forbidden_user if w.lower() != up.lower()]

        forbidden_all = forbidden_bot + forbidden_user
        forbidden_rule = f"- TUYỆT ĐỐI KHÔNG dùng các từ: {', '.join(forbidden_all)}" if forbidden_all else ""

        system_prompt = RESPONSE_SYSTEM_PROMPT.format(
            bot_pronoun=bp,
            user_pronoun=up,
            forbidden_pronouns_rule=forbidden_rule,
        )
        if addon:
            system_prompt = f"{system_prompt}\n\n{addon}"
        return system_prompt

    def _generate_qwen(
        self,
        inner: QwenLocalResponseGenerator,
        user_text: str,
        history: list[dict[str, str]],
        addon: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        tokenizer, model = inner._load_model()
        system_prompt = self._build_system_prompt(inner.config, bot_pronoun, user_pronoun, addon)
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-8:])
        messages.append({"role": "user", "content": user_text})

        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        model_inputs = tokenizer([prompt], return_tensors="pt").to(model.device)
        with ModelTimer(f"llm/{inner.config.llm_model}", method="generate", detail=user_text[:80]):
            try:
                generation_kwargs = inner._generation_kwargs(model_inputs, max_new_tokens, temperature)
                generated_ids = model.generate(**generation_kwargs)
                generated_ids = generated_ids[0][len(model_inputs.input_ids[0]) :]
                return tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
            finally:
                if "model_inputs" in locals():
                    del model_inputs
                if "generated_ids" in locals():
                    del generated_ids
                import torch

                torch.cuda.empty_cache()

    def _generate_qwen_stream(
        self,
        inner: QwenLocalResponseGenerator,
        user_text: str,
        history: list[dict[str, str]],
        addon: str,
        bot_pronoun: str | None = None,
        user_pronoun: str | None = None,
        interrupt_event=None,
        pause_lock=None,
        max_new_tokens: int | None = None,
        temperature: float | None = None,
    ):
        tokenizer, model = inner._load_model()
        system_prompt = self._build_system_prompt(inner.config, bot_pronoun, user_pronoun, addon)
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(history[-8:])
        messages.append({"role": "user", "content": user_text})

        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        model_inputs = tokenizer([prompt], return_tensors="pt").to(model.device)

        from transformers import StoppingCriteria, StoppingCriteriaList, TextIteratorStreamer
        import queue
        import threading

        class InterruptCriteria(StoppingCriteria):
            def __init__(self, event, lock):
                self.event = event
                self.lock = lock

            def __call__(self, input_ids, scores, **kwargs):
                if self.lock:
                    with self.lock:
                        pass
                return self.event is not None and self.event.is_set()

        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        stopping_criteria = StoppingCriteriaList([InterruptCriteria(interrupt_event, pause_lock)])

        generation_kwargs = inner._generation_kwargs(model_inputs, max_new_tokens, temperature)
        generation_kwargs.update(
            streamer=streamer,
            stopping_criteria=stopping_criteria,
        )

        def run_generation():
            model.generate(**generation_kwargs)

        thread = threading.Thread(target=run_generation)
        thread.start()

        with ModelTimer(f"llm/{inner.config.llm_model}", method="generate_stream", detail=user_text[:80]):
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
                if "model_inputs" in locals():
                    del model_inputs
                import torch

                torch.cuda.empty_cache()


def wrap_response_generator(inner: Any, addon_provider: Callable[[], str]) -> Any:
    if isinstance(inner, PreferenceInjectingGenerator):
        return inner
    if isinstance(inner, (QwenLocalResponseGenerator, TemplateChatGenerator)):
        return PreferenceInjectingGenerator(inner, addon_provider)
    generate = getattr(inner, "generate", None)
    if not callable(generate):
        return inner
    return PreferenceInjectingGenerator(inner, addon_provider)
