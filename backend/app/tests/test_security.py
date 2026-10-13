from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core import security
from app.core.config import settings


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_missing_credentials_raises_401():
    with pytest.raises(HTTPException) as exc:
        security.get_current_user_email(credentials=None)
    assert exc.value.status_code == 401


def test_invalid_token_raises_401():
    with patch.object(security.auth, "verify_id_token", side_effect=ValueError("bad token")):
        with pytest.raises(HTTPException) as exc:
            security.get_current_user_email(credentials=_creds("bad-token"))
    assert exc.value.status_code == 401


def test_email_not_allowed_raises_403():
    decoded = {"email": "stranger@example.com", "email_verified": True}
    with patch.object(security.auth, "verify_id_token", return_value=decoded):
        with pytest.raises(HTTPException) as exc:
            security.get_current_user_email(credentials=_creds("good-token"))
    assert exc.value.status_code == 403


def test_allowed_email_returns_email():
    allowed_email = settings.allowed_emails_list[0] if settings.allowed_emails_list else "you@example.com"
    settings.ALLOWED_EMAILS = f'["{allowed_email}"]'
    decoded = {"email": allowed_email, "email_verified": True}
    with patch.object(security.auth, "verify_id_token", return_value=decoded):
        result = security.get_current_user_email(credentials=_creds("good-token"))
    assert result == allowed_email
