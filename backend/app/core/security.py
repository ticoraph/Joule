import firebase_admin
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth

from app.core.config import settings

# On Cloud Run, Application Default Credentials resolve to the runtime
# service account automatically — no service-account key needed, since the
# GCP project is also the Firebase project.
_firebase_app = firebase_admin.initialize_app(options={"projectId": settings.FIREBASE_PROJECT_ID})

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user_email(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if settings.DISABLE_AUTH:
        return (settings.allowed_emails_list or ["dev@local"])[0]

    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing Authorization header")

    try:
        decoded = auth.verify_id_token(credentials.credentials, app=_firebase_app)
    except Exception as e:
        print(f"Firebase token verification error: {e}", flush=True)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    email = (decoded.get("email") or "").lower()
    print(f"User email: {email}, Verified: {decoded.get('email_verified')}", flush=True)
    print(f"Allowed emails: {settings.allowed_emails_list}", flush=True)
    if not decoded.get("email_verified", False) or email not in settings.allowed_emails_list:
        print("FORBIDDEN: User not allowed or email not verified", flush=True)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorized")

    return email
