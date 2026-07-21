"""Shared types and defaults for Task Radar (Python side)."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ReplyMode = Literal["off", "draft", "auto"]
AutoEnvironment = Literal["test", "live"]
ItemStatus = Literal["new", "opened", "replied", "ignored"]
ItemSource = Literal["telegram", "web"]
TelegramSearchMode = Literal["public_posts", "public_groups", "my_sources"]

DEFAULT_REPLY_TEMPLATE = (
    "Здравствуйте. Увидел ваш свежий пост по задаче. "
    "Могу посмотреть и взять в работу. Пришлите исходники и пример результата "
    "— быстро скажу по сроку и цене."
)

DEFAULT_KEYWORDS = [
    "нужен дизайнер",
    "ищу дизайнера",
    "кто сделает карточки товара",
    "нужна инфографика",
    "нужно оформить карточки",
    "ищу монтажера",
    "нужен монтаж ролика",
    "нужен таргетолог",
    "кто настроит рекламу",
    "нужен лендинг",
    "кто сделает сайт",
    "нужна презентация",
    "нужно оформить сообщество",
    "нужен AI ролик",
    "нужно сделать видео",
]

DEFAULT_EXCLUDE_KEYWORDS = [
    "предлагаю услуги",
    "обучение",
    "курс",
    "резюме",
    "ищу работу",
    "вакансия в штат",
]

DEFAULT_WEB_DOMAINS = [
    "kwork.ru",
    "freelance.ru",
    "fl.ru",
    "youdo.com",
    "avito.ru",
]


class TaskRadarSettings(TypedDict, total=False):
    keywords: list[str]
    excludeKeywords: list[str]
    maxAgeMinutes: int
    telegramEnabled: bool
    telegramPublicPostsEnabled: bool
    telegramPublicGroupsEnabled: bool
    telegramMySourcesEnabled: bool
    telegramSources: list[dict[str, Any]]
    allowPaidStarsSearch: bool
    webEnabled: bool
    replyMode: ReplyMode
    replyTemplate: str
    autoEnvironment: AutoEnvironment
    maxAutoPerHour: int
    maxAutoPerDay: int
    webDomains: list[str]
    autoLiveConfirmed: bool
    autoDisabledReason: str | None


def default_settings() -> dict[str, Any]:
    return {
        "keywords": list(DEFAULT_KEYWORDS),
        "excludeKeywords": list(DEFAULT_EXCLUDE_KEYWORDS),
        "maxAgeMinutes": 180,
        "telegramEnabled": True,
        "telegramPublicPostsEnabled": True,
        "telegramPublicGroupsEnabled": False,
        "telegramMySourcesEnabled": False,
        "telegramSources": [],
        "allowPaidStarsSearch": False,
        "webEnabled": True,
        "replyMode": "draft",
        "replyTemplate": DEFAULT_REPLY_TEMPLATE,
        "autoEnvironment": "test",
        "maxAutoPerHour": 5,
        "maxAutoPerDay": 20,
        "webDomains": list(DEFAULT_WEB_DOMAINS),
        "autoLiveConfirmed": False,
        "autoDisabledReason": None,
    }
