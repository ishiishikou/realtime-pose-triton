from typing import Any

import numpy as np


def extract_points(output: Any) -> list[dict[str, float]]:
    array = np.asarray(output)
    if array.ndim == 3:
        array = array[0]
    if array.ndim != 2 or array.shape[1] < 2:
        return []

    points: list[dict[str, float]] = []
    for row in array:
        score = float(row[2]) if row.shape[0] >= 3 else 1.0
        points.append({'x': float(row[0]), 'y': float(row[1]), 'score': score})
    return points
