"""Fine dead-fuel moisture and its damping effect on spread rate.

- `equilibrium_moisture_content_pct` — Simard (1968) EMC regression, the
  one used by the US NFDRS (Cohen & Deeming 1985, GTR PSW-82, eq. for
  EMC). Inputs are air temperature and relative humidity only; it is an
  *equilibrium* value (fuels in shade lag it by hours) and was fitted on
  temperate wood, not tropical litter or peat — documented assumption.
- `moisture_damping` — Rothermel (1972) moisture damping coefficient,
  eta_M = 1 - 2.59 r + 5.11 r^2 - 3.52 r^3, r = Mf / Mx.

`MOISTURE_OF_EXTINCTION` (Mx) is fuel-model specific (0.12-0.40 across
Scott & Burgan 2005's 40 models). No Indonesian fuel map exists in AETHER,
so a single mid-range value is assumed for every fire and surfaced in the
response's `assumptions`.
"""

from app.ml.hazard_prediction.common import clamp

MOISTURE_OF_EXTINCTION = 0.25
# The "10% rule" spread rate (spread.py) was derived for dry conditions —
# the damping factor is expressed relative to a dry reference so that
# reference conditions reproduce the rule unchanged.
DRY_REFERENCE_MOISTURE = 0.06


def equilibrium_moisture_content_pct(temperature_c: float, relative_humidity_pct: float) -> float:
    t_f = temperature_c * 9.0 / 5.0 + 32.0
    h = clamp(relative_humidity_pct, 0.0, 100.0)
    if h < 10:
        emc = 0.03229 + 0.281073 * h - 0.000578 * h * t_f
    elif h < 50:
        emc = 2.22749 + 0.160107 * h - 0.01478 * t_f
    else:
        emc = 21.0606 + 0.005565 * h**2 - 0.00035 * h * t_f - 0.483199 * h
    return max(0.0, emc)


def moisture_damping(fuel_moisture_fraction: float) -> float:
    r = clamp(fuel_moisture_fraction / MOISTURE_OF_EXTINCTION, 0.0, 1.0)
    if r >= 1.0:
        return 0.0  # at/above moisture of extinction: no sustained flaming spread
    return clamp(1.0 - 2.59 * r + 5.11 * r**2 - 3.52 * r**3, 0.0, 1.0)


def relative_moisture_factor(fuel_moisture_fraction: float) -> float:
    """0-1 multiplier on the dry-reference spread rate."""
    return clamp(
        moisture_damping(fuel_moisture_fraction) / moisture_damping(DRY_REFERENCE_MOISTURE),
        0.0,
        1.0,
    )
