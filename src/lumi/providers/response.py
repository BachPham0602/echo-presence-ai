from __future__ import annotations

from lumi.config import LumiConfig
from lumi.models import EmotionDecision, LumiResponse, SpeakerDecision
from lumi.providers.addressee import _normalize


class EmpatheticResponseGenerator:
    def __init__(self, config: LumiConfig):
        self.config = config

    def generate(
        self,
        text: str,
        emotion: EmotionDecision,
        speaker: SpeakerDecision,
        history: list[dict[str, str]],
    ) -> LumiResponse:
        normalized = _normalize(text)
        if _looks_like_crisis(normalized):
            return LumiResponse(
                text=(
                    "Mình đang ở đây với bạn. Nếu lúc này bạn có ý định làm hại bản thân, "
                    "hãy gọi ngay người thân hoặc đường dây khẩn cấp tại nơi bạn ở. "
                    "Bạn có thể đặt điện thoại xuống một chút và nói với mình: bạn đang ở đâu?"
                ),
                intent="safety",
            )

        templates = {
            "cô_đơn": (
                "Nghe như tối nay căn nhà hơi vắng với bạn. Mình ở đây với bạn một lúc nhé. "
                "Điều gì làm cảm giác cô đơn rõ nhất lúc này?"
            ),
            "buồn": (
                "Mình nghe thấy có một nỗi buồn trong câu vừa rồi. Không cần phải vui lên ngay đâu. "
                "Bạn muốn kể tiếp một chút không?"
            ),
            "mệt": (
                "Hôm nay có vẻ bạn đã gánh khá nhiều rồi. Mình sẽ nói nhẹ thôi. "
                "Bạn muốn nghỉ yên lặng, hay muốn mình ngồi nghe bạn nói thêm?"
            ),
            "căng_thẳng": (
                "Nghe có vẻ mọi thứ đang ép bạn khá sát. Mình ở đây, mình nghe bạn. "
                "Mình có thể cùng bạn gỡ nhẹ từng việc một không?"
            ),
            "vui": (
                "Nghe thích quá. Mình vui theo bạn đấy. "
                "Kể mình nghe khoảnh khắc đó xảy ra như thế nào với."
            ),
            "bình_yên": (
                "Nghe nhẹ nhàng hơn một chút rồi. Mình thích khoảnh khắc này. "
                "Mình sẽ giữ nhịp chậm với bạn nhé."
            ),
            "trung_tính": (
                "Mình nghe rồi. Mình đang ở đây với bạn. "
                "Bạn muốn mình chỉ lắng nghe, hay nói chuyện thêm một chút?"
            ),
        }
        return LumiResponse(text=templates.get(emotion.label, templates["trung_tính"]), intent="comfort")


def _looks_like_crisis(normalized: str) -> bool:
    crisis_phrases = (
        "tu tu",
        "khong muon song",
        "lam hai ban than",
        "chet di",
        "ket thuc moi thu",
    )
    return any(phrase in normalized for phrase in crisis_phrases)
