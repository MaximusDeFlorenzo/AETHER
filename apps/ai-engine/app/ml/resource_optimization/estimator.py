"""Resource estimator — ported from AI-ORION's `app/ml/resource_estimator.py`
(itself following the same convention as `personnel_estimator.py`): a
documented base ratio, an exposure-level multiplier, a minimum floor where
relevant, `math.ceil` rounding, non-negative integer output. Transparent
rule-based v0 baseline — there is no labeled outcome dataset for any of these
resource categories yet, so nothing here is a trained model.

Only rename vs. ORION: `DamageLevel` (minor/moderate/severe/catastrophic) is
replaced by AETHER's hazard-agnostic `ExposureLevel`
(low/moderate/high/severe) so this module serves every hazard type, not just
earthquake. Hospital figures remain the one category partially grounded in
real data — `apps/api` resolves real nearby hospitals and passes their bed
counts + distance in as `nearby_hospitals`, same as ORION. Ambulance/vehicle
"available" figures have no equivalent real fleet telemetry, so they stay
heuristic proxies, not live dispatch data.
"""

import math

from app.schemas.common import ExposureLevel
from app.schemas.resource import (
    AmbulanceEstimate,
    HospitalEstimate,
    HospitalInput,
    RecommendedHospital,
    VehicleEstimate,
    VolunteerEstimate,
)

EXPOSURE_LEVEL_MULTIPLIER: dict[ExposureLevel, float] = {
    "low": 1.0,
    "moderate": 1.4,
    "high": 2.0,
    "severe": 2.8,
}

# Hospital
HOSPITALIZATION_RATE = 0.02  # share of affected population needing inpatient care
AVG_BEDS_PER_HOSPITAL_NEEDED = 100  # used only to convert beds-needed -> facility count
TOP_N_RECOMMENDED_HOSPITALS = 5

# Ambulance — no real fleet telemetry exists, so "available" is itself a
# heuristic proxy off the real nearby-hospital count, not live dispatch data.
AFFECTED_PER_AMBULANCE = 500
AMBULANCES_PER_NEARBY_HOSPITAL = 2
MINIMUM_AMBULANCES = 1

# Vehicles
AFFECTED_PER_RESCUE_VEHICLE = 300
AFFECTED_PER_LOGISTICS_TRUCK = 1000
# Heavy equipment (excavators/cranes) is only warranted once structural
# collapse/burial becomes likely — zero at low/moderate exposure, scaling
# sharply past that, unlike the general-purpose multiplier used elsewhere.
HEAVY_EQUIPMENT_PER_1000_AFFECTED: dict[ExposureLevel, float] = {
    "low": 0.0,
    "moderate": 0.5,
    "high": 2.0,
    "severe": 4.0,
}
EXCAVATOR_SHARE_OF_HEAVY_EQUIPMENT = 0.6  # remainder is other heavy plant

# Volunteers
AFFECTED_PER_VOLUNTEER = 200
MINIMUM_VOLUNTEERS = 10
VOLUNTEER_SPLIT = {"medical": 0.3, "logistics": 0.4, "sar": 0.3}

# Evacuation shelters
DISPLACEMENT_RATE = 0.15  # share of affected population assumed displaced
PEOPLE_PER_SHELTER = 500

# Logistics aid
AID_KG_PER_AFFECTED_PER_DAY = 5.0


def estimate_hospital_requirement(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
    nearby_hospitals: list[HospitalInput],
) -> HospitalEstimate:
    if estimated_affected_population <= 0:
        return HospitalEstimate(
            hospitals_needed=0,
            recommended_hospitals=[],
            available_capacity_beds=0,
            estimated_overflow_beds=0,
        )

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    beds_needed = math.ceil(
        estimated_affected_population * HOSPITALIZATION_RATE * multiplier
    )
    hospitals_needed = math.ceil(beds_needed / AVG_BEDS_PER_HOSPITAL_NEEDED)

    sorted_hospitals = sorted(nearby_hospitals, key=lambda h: h.distance_km)
    recommended = [
        RecommendedHospital(
            code=h.code, name=h.name, distance_km=h.distance_km, total_beds=h.total_beds
        )
        for h in sorted_hospitals[:TOP_N_RECOMMENDED_HOSPITALS]
    ]
    available_capacity_beds = sum(h.total_beds for h in nearby_hospitals)
    estimated_overflow_beds = max(0, beds_needed - available_capacity_beds)

    return HospitalEstimate(
        hospitals_needed=hospitals_needed,
        recommended_hospitals=recommended,
        available_capacity_beds=available_capacity_beds,
        estimated_overflow_beds=estimated_overflow_beds,
    )


def estimate_ambulance_requirement(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
    nearby_hospital_count: int,
) -> AmbulanceEstimate:
    if estimated_affected_population <= 0:
        return AmbulanceEstimate(required=0, available=0, additional_needed=0)

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    required = max(
        MINIMUM_AMBULANCES,
        math.ceil(
            (estimated_affected_population / AFFECTED_PER_AMBULANCE) * multiplier
        ),
    )
    available = nearby_hospital_count * AMBULANCES_PER_NEARBY_HOSPITAL
    additional_needed = max(0, required - available)

    return AmbulanceEstimate(
        required=required, available=available, additional_needed=additional_needed
    )


def estimate_vehicle_requirement(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
) -> VehicleEstimate:
    if estimated_affected_population <= 0:
        return VehicleEstimate(
            rescue_vehicles=0, logistics_trucks=0, excavators=0, heavy_equipment=0
        )

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    rescue_vehicles = math.ceil(
        (estimated_affected_population / AFFECTED_PER_RESCUE_VEHICLE) * multiplier
    )
    logistics_trucks = math.ceil(
        (estimated_affected_population / AFFECTED_PER_LOGISTICS_TRUCK) * multiplier
    )

    heavy_equipment_total = math.ceil(
        (estimated_affected_population / 1000)
        * HEAVY_EQUIPMENT_PER_1000_AFFECTED[exposure_level]
    )
    excavators = round(heavy_equipment_total * EXCAVATOR_SHARE_OF_HEAVY_EQUIPMENT)
    heavy_equipment = heavy_equipment_total - excavators

    return VehicleEstimate(
        rescue_vehicles=rescue_vehicles,
        logistics_trucks=logistics_trucks,
        excavators=excavators,
        heavy_equipment=heavy_equipment,
    )


def estimate_volunteer_requirement(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
) -> VolunteerEstimate:
    if estimated_affected_population <= 0:
        return VolunteerEstimate(total=0, medical=0, logistics=0, sar=0)

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    total = max(
        MINIMUM_VOLUNTEERS,
        math.ceil(
            (estimated_affected_population / AFFECTED_PER_VOLUNTEER) * multiplier
        ),
    )
    medical = round(total * VOLUNTEER_SPLIT["medical"])
    logistics = round(total * VOLUNTEER_SPLIT["logistics"])
    sar = total - medical - logistics  # remainder, avoids rounding drift

    return VolunteerEstimate(total=total, medical=medical, logistics=logistics, sar=sar)


def estimate_evacuation_shelters(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
) -> int:
    if estimated_affected_population <= 0:
        return 0

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    displaced = estimated_affected_population * DISPLACEMENT_RATE * multiplier
    return math.ceil(displaced / PEOPLE_PER_SHELTER)


def estimate_logistics_aid_tons(
    estimated_affected_population: int,
    exposure_level: ExposureLevel,
) -> float:
    if estimated_affected_population <= 0:
        return 0.0

    multiplier = EXPOSURE_LEVEL_MULTIPLIER[exposure_level]
    kg = estimated_affected_population * AID_KG_PER_AFFECTED_PER_DAY * multiplier
    return round(kg / 1000, 2)
