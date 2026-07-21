from pathlib import Path

import pytest

from app.storage.private_images import LocalPrivateImageStorage, S3PrivateImageStorage


def test_local_private_storage_writes_reads_and_deletes_without_public_urls(tmp_path: Path) -> None:
    storage = LocalPrivateImageStorage(tmp_path)

    key = storage.put(owner_id="user-1", purpose="analysis-job", content=b"normalized-jpeg")

    assert key.startswith("analysis-job/user-1/")
    assert storage.read(key) == b"normalized-jpeg"
    assert storage.path_for(key).stat().st_mode & 0o777 == 0o600

    storage.delete(key)
    storage.delete(key)
    with pytest.raises(FileNotFoundError):
        storage.read(key)


@pytest.mark.parametrize("key", ["../outside.jpg", "/absolute.jpg", "folder\\outside.jpg", ""])
def test_local_private_storage_rejects_path_escape_attempts(tmp_path: Path, key: str) -> None:
    storage = LocalPrivateImageStorage(tmp_path)
    with pytest.raises(ValueError):
        storage.path_for(key)


def test_s3_private_storage_encrypts_writes_and_issues_only_short_lived_urls() -> None:
    client = FakeS3Client()
    storage = S3PrivateImageStorage(bucket="private-images", client=client, prefix="living", encryption_key_id="kms-key")

    key = storage.put(owner_id="user-1", purpose="analysis-job", content=b"normalized-jpeg")

    assert client.put_calls[0]["Bucket"] == "private-images"
    assert client.put_calls[0]["ServerSideEncryption"] == "aws:kms"
    assert client.put_calls[0]["SSEKMSKeyId"] == "kms-key"
    assert storage.signed_read_url(key, expires_in_seconds=300) == "https://private.example/signed"
    assert client.presign_calls[0]["ExpiresIn"] == 300
    with pytest.raises(ValueError):
        storage.signed_read_url(key, expires_in_seconds=901)
    with pytest.raises(ValueError):
        storage.read("other-user/image.jpg")


def test_cloudflare_r2_storage_uses_its_default_encryption_without_aws_sse_headers() -> None:
    client = FakeS3Client()
    storage = S3PrivateImageStorage(
        bucket="private-images",
        client=client,
        prefix="living",
        encryption_key_id=None,
        compatibility="cloudflare_r2",
    )

    storage.put(owner_id="user-1", purpose="analysis-job", content=b"normalized-jpeg")

    assert "ServerSideEncryption" not in client.put_calls[0]
    assert "SSEKMSKeyId" not in client.put_calls[0]


class FakeS3Client:
    def __init__(self) -> None:
        self.put_calls: list[dict[str, object]] = []
        self.presign_calls: list[dict[str, object]] = []

    def put_object(self, **kwargs: object) -> None:
        self.put_calls.append(kwargs)

    def get_object(self, **_kwargs: object) -> dict[str, object]:
        return {"Body": FakeBody()}

    def delete_object(self, **_kwargs: object) -> None:
        return None

    def generate_presigned_url(self, _operation: str, **kwargs: object) -> str:
        self.presign_calls.append(kwargs)
        return "https://private.example/signed"


class FakeBody:
    def read(self) -> bytes:
        return b"normalized-jpeg"
