import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Applied explicitly per-controller/method (not globally) — per
// docs/API_SPEC.md's auth guard posture table, several read endpoints
// (GET /hazard-events, GET /spatial/overlay, GET /sustainability-metrics,
// /health) carry no guard at all.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
