"""Private temporary image storage for durable analysis work.

The local implementation exists for preview/test workers only. It has no public
URL method; production object storage must preserve that owner-mediated access
boundary through a separately configured S3-compatible implementation.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from app.core.config import settings


class PrivateImageStorage(Protocol):
    def put(self, *, owner_id: str, purpose: str, content: bytes, suffix: str = ".jpg") -> str: ...

    def read(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def signed_read_url(self, key: str, *, expires_in_seconds: int) -> str: ...


class LocalPrivateImageStorage:
    """A non-public, path-safe store for local development and test workers."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    def put(self, *, owner_id: str, purpose: str, content: bytes, suffix: str = ".jpg") -> str:
        if not content:
            raise ValueError("Cannot store an empty image.")
        if not suffix.startswith(".") or len(suffix) > 8:
            raise ValueError("Image suffix is invalid.")
        key = f"{purpose}/{owner_id}/{uuid4()}{suffix}"
        destination = self.path_for(key)
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = destination.with_suffix(f"{destination.suffix}.tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        return key

    def read(self, key: str) -> bytes:
        return self.path_for(key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            self.path_for(key).unlink()
        except FileNotFoundError:
            return

    def signed_read_url(self, key: str, *, expires_in_seconds: int) -> str:
        # A local private root cannot issue a network URL. Callers must use a
        # separately owner-authorized API path in preview rather than exposing
        # a filesystem path as a pseudo-signed URL.
        self.path_for(key)
        raise RuntimeError("Local private storage does not expose read URLs.")

    def path_for(self, key: str) -> Path:
        if not key or key.startswith("/") or "\\" in key:
            raise ValueError("Storage key is invalid.")
        path = (self.root / key).resolve()
        if path == self.root or self.root not in path.parents:
            raise ValueError("Storage key escapes the private storage root.")
        return path


class S3PrivateImageStorage:
    """Private S3-compatible storage with expiring owner-authorized reads."""

    def __init__(
        self,
        *,
        bucket: str,
        client: Any,
        prefix: str,
        encryption_key_id: str | None,
        compatibility: str = "aws",
    ) -> None:
        self.bucket = bucket
        self.client = client
        self.prefix = prefix.strip("/")
        self.encryption_key_id = encryption_key_id
        self.compatibility = compatibility

    def put(self, *, owner_id: str, purpose: str, content: bytes, suffix: str = ".jpg") -> str:
        if not content:
            raise ValueError("Cannot store an empty image.")
        if not suffix.startswith(".") or len(suffix) > 8:
            raise ValueError("Image suffix is invalid.")
        key = "/".join(part for part in (self.prefix, purpose, owner_id, f"{uuid4()}{suffix}") if part)
        arguments: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": key,
            "Body": content,
            "ContentType": "image/jpeg",
        }
        if self.compatibility == "aws":
            arguments["ServerSideEncryption"] = "aws:kms" if self.encryption_key_id else "AES256"
            if self.encryption_key_id:
                arguments["SSEKMSKeyId"] = self.encryption_key_id
        self.client.put_object(**arguments)
        return key

    def read(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=self.validate_key(key))
        return response["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self.validate_key(key))

    def signed_read_url(self, key: str, *, expires_in_seconds: int) -> str:
        if not 1 <= expires_in_seconds <= 900:
            raise ValueError("Signed image access must expire within 15 minutes.")
        return str(
            self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": self.validate_key(key)},
                ExpiresIn=expires_in_seconds,
                HttpMethod="GET",
            )
        )

    def validate_key(self, key: str) -> str:
        if not key or key.startswith("/") or "\\" in key or ".." in key.split("/"):
            raise ValueError("Storage key is invalid.")
        if self.prefix and not key.startswith(f"{self.prefix}/"):
            raise ValueError("Storage key is outside the configured private prefix.")
        return key


def build_private_image_storage() -> PrivateImageStorage:
    if settings.image_storage_backend == "local":
        return LocalPrivateImageStorage(Path(settings.image_storage_local_root))
    try:
        import boto3
    except ModuleNotFoundError as exc:  # pragma: no cover - packaging guard
        raise RuntimeError("S3 image storage requires the boto3 dependency.") from exc

    return S3PrivateImageStorage(
        bucket=settings.image_storage_s3_bucket or "",
        prefix=settings.image_storage_s3_prefix,
        encryption_key_id=settings.image_storage_s3_kms_key_id,
        compatibility=settings.image_storage_s3_compatibility,
        client=boto3.client(
            "s3",
            region_name=settings.image_storage_s3_region,
            endpoint_url=settings.image_storage_s3_endpoint_url,
            aws_access_key_id=settings.image_storage_s3_access_key_id,
            aws_secret_access_key=settings.image_storage_s3_secret_access_key,
        ),
    )
