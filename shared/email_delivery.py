from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _parse_env_file(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        return {}

    result: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


class EmailDeliveryError(RuntimeError):
    pass


@dataclass(slots=True)
class EmailDeliveryResult:
    provider: str
    status: str
    external_id: str | None
    detail: str | None = None


@dataclass(slots=True)
class BrevoConfig:
    api_key: str
    sender_email: str
    sender_name: str
    reply_to_email: str | None = None
    reply_to_name: str | None = None


def load_email_config(root_dir: Path) -> dict[str, str]:
    return _parse_env_file(root_dir / ".env")


def get_email_provider_status(root_dir: Path) -> dict[str, str]:
    env = load_email_config(root_dir)
    provider = env.get("EMAIL_PROVIDER", "").strip().lower()
    if provider != "brevo":
        return {
            "provider": provider or "none",
            "mode": "simulation",
            "detail": "Set EMAIL_PROVIDER=brevo to enable real sending.",
        }

    required = {
        "BREVO_API_KEY": env.get("BREVO_API_KEY", "").strip(),
        "BREVO_SENDER_EMAIL": env.get("BREVO_SENDER_EMAIL", "").strip(),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        return {
            "provider": "brevo",
            "mode": "simulation",
            "detail": f"Missing env: {', '.join(missing)}",
        }

    return {
        "provider": "brevo",
        "mode": "live",
        "detail": env.get("BREVO_SENDER_EMAIL", "").strip(),
    }


def get_brevo_config(root_dir: Path) -> BrevoConfig | None:
    env = load_email_config(root_dir)
    provider = env.get("EMAIL_PROVIDER", "").strip().lower()
    if provider != "brevo":
        return None

    api_key = env.get("BREVO_API_KEY", "").strip()
    sender_email = env.get("BREVO_SENDER_EMAIL", "").strip()
    if not api_key or not sender_email:
        return None

    return BrevoConfig(
        api_key=api_key,
        sender_email=sender_email,
        sender_name=env.get("BREVO_SENDER_NAME", "Rakshit & Co. Johuree").strip() or "Rakshit & Co. Johuree",
        reply_to_email=env.get("BREVO_REPLY_TO_EMAIL", "").strip() or None,
        reply_to_name=env.get("BREVO_REPLY_TO_NAME", "").strip() or None,
    )


def send_transactional_email(
    root_dir: Path,
    *,
    recipient_email: str,
    recipient_name: str,
    subject: str,
    html_content: str,
    text_content: str | None = None,
) -> EmailDeliveryResult:
    config = get_brevo_config(root_dir)
    if not config:
        return EmailDeliveryResult(
            provider="simulation",
            status="simulated",
            external_id=None,
            detail="Brevo is not configured yet.",
        )

    body: dict[str, Any] = {
        "sender": {
            "email": config.sender_email,
            "name": config.sender_name,
        },
        "to": [
            {
                "email": recipient_email,
                "name": recipient_name,
            }
        ],
        "subject": subject,
        "htmlContent": html_content,
    }
    if text_content:
        body["textContent"] = text_content
    if config.reply_to_email:
        body["replyTo"] = {
            "email": config.reply_to_email,
            "name": config.reply_to_name or config.sender_name,
        }

    request = Request(
        "https://api.brevo.com/v3/smtp/email",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": config.api_key,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise EmailDeliveryError(f"Brevo HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise EmailDeliveryError(f"Brevo connection failed: {exc.reason}") from exc

    return EmailDeliveryResult(
        provider="brevo",
        status="sent",
        external_id=payload.get("messageId"),
        detail=None,
    )
