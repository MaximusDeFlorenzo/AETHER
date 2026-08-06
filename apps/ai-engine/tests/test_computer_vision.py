import base64
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.ml.computer_vision import fire, flood, infra_damage, smoke
from app.ml.computer_vision.common import InvalidImageError, decode_image


def _solid_image(rgb: tuple[int, int, int], size: int = 64) -> np.ndarray:
    array = np.full((size, size, 3), rgb, dtype=np.uint8)
    return np.asarray(array, dtype=np.float64)


def _image_with_patch(
    background_rgb: tuple[int, int, int],
    patch_rgb: tuple[int, int, int],
    size: int = 64,
    patch_size: int = 24,
) -> np.ndarray:
    array = np.full((size, size, 3), background_rgb, dtype=np.uint8)
    start = (size - patch_size) // 2
    array[start : start + patch_size, start : start + patch_size] = patch_rgb
    return np.asarray(array, dtype=np.float64)


def _to_base64_png(array: np.ndarray) -> str:
    image = Image.fromarray(array.astype(np.uint8))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_decode_image_rejects_invalid_base64():
    with pytest.raises(InvalidImageError):
        decode_image("not-valid-base64!!!")


def test_decode_image_rejects_non_image_bytes():
    garbage = base64.b64encode(b"this is not an image").decode("ascii")
    with pytest.raises(InvalidImageError):
        decode_image(garbage)


def test_decode_image_returns_rgb_array_matching_dimensions():
    payload = _to_base64_png(_solid_image((10, 20, 30)))
    image = decode_image(payload)
    assert image.shape == (64, 64, 3)


def test_fire_detector_fires_on_flame_colored_patch():
    image = _image_with_patch(background_rgb=(20, 30, 40), patch_rgb=(230, 120, 20))
    detections = fire.detect(image)
    assert len(detections) == 1
    assert detections[0].detection_type == "fire"
    assert 0 < detections[0].confidence_score <= 1


def test_fire_detector_does_not_fire_on_a_plain_red_object():
    # Pure red (no green) shouldn't read as flame-colored.
    image = _solid_image((200, 5, 5))
    assert fire.detect(image) == []


def test_fire_detector_ignores_a_neutral_scene():
    image = _solid_image((100, 100, 100))
    assert fire.detect(image) == []


def test_smoke_detector_fires_on_gray_plume_colored_patch():
    image = _image_with_patch(background_rgb=(30, 120, 30), patch_rgb=(150, 150, 150))
    detections = smoke.detect(image)
    assert len(detections) == 1
    assert detections[0].detection_type == "smoke"


def test_smoke_detector_does_not_fire_on_saturated_sky_blue():
    image = _solid_image((60, 140, 230))
    assert smoke.detect(image) == []


def test_flood_detector_fires_on_muddy_water_patch():
    image = _image_with_patch(background_rgb=(40, 90, 40), patch_rgb=(140, 110, 70))
    detections = flood.detect(image)
    assert len(detections) == 1
    assert detections[0].detection_type == "flood"


def test_flood_detector_fires_on_blue_water_patch():
    image = _image_with_patch(background_rgb=(90, 70, 40), patch_rgb=(30, 60, 180))
    detections = flood.detect(image)
    assert len(detections) == 1
    assert detections[0].detection_type == "flood"


def test_flood_detector_ignores_green_foliage():
    image = _solid_image((40, 130, 40))
    assert flood.detect(image) == []


def test_infra_damage_detector_ignores_a_flat_uniform_surface():
    image = _solid_image((120, 120, 120))
    assert infra_damage.detect(image) == []


def test_infra_damage_detector_confidence_is_capped_well_below_color_detectors():
    rng = np.random.default_rng(42)
    noisy = rng.integers(0, 255, size=(64, 64, 3), dtype=np.uint8)
    image = np.asarray(noisy, dtype=np.float64)
    detections = infra_damage.detect(image)
    for detection in detections:
        assert detection.confidence_score <= 0.5
