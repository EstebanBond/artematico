"""Image processing utilities for evaluation."""

import io

from PIL import Image, ImageOps


def resize_for_anthropic(image_bytes: bytes, max_long_edge: int) -> tuple[bytes, str]:
    """
    Resize image for Anthropic and re-encode as JPEG.

    Args:
        image_bytes: Raw image data
        max_long_edge: Maximum length for the longest edge

    Returns:
        Tuple of (jpeg_bytes, media_type)
    """
    # Open image from bytes
    img = Image.open(io.BytesIO(image_bytes))

    # Fix EXIF orientation
    img = ImageOps.exif_transpose(img)

    # Convert to RGB
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Resize if needed
    width, height = img.size
    if max(width, height) > max_long_edge:
        # Calculate new dimensions maintaining aspect ratio
        if width > height:
            new_width = max_long_edge
            new_height = int(height * (max_long_edge / width))
        else:
            new_height = max_long_edge
            new_width = int(width * (max_long_edge / height))

        # Use LANCZOS for downsampling (handle both Pillow versions)
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS

        img = img.resize((new_width, new_height), resample)

    # Re-encode as JPEG
    jpeg_buffer = io.BytesIO()
    img.save(jpeg_buffer, format="JPEG", quality=85)
    img.close()  # Explicitly close to free memory

    jpeg_bytes = jpeg_buffer.getvalue()
    return jpeg_bytes, "image/jpeg"


def validate_upload(content_type: str, size_bytes: int) -> None:
    """
    Validate image upload.

    Args:
        content_type: MIME type of the image
        size_bytes: Size of the image in bytes

    Raises:
        ValueError: If validation fails
    """
    allowed_types = {"image/jpeg", "image/png", "image/webp"}
    if content_type not in allowed_types:
        raise ValueError(
            f"Invalid content type: {content_type}. Allowed: {allowed_types}"
        )

    max_size = 12 * 1024 * 1024  # 12 MB
    if size_bytes > max_size:
        raise ValueError(f"Image too large: {size_bytes} bytes (max {max_size})")
