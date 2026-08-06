// Mirrors apps/ai-engine's app/schemas/computer_vision.py exactly. Wire
// format is camelCase on both sides, same convention as risk-engine.types.ts.

import { CvDetectionType } from '../common/enums/domain.enum';

export interface DetectCvBoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface DetectCvDetectionResult {
  detectionType: CvDetectionType;
  boundingBoxes: DetectCvBoundingBox[];
  confidenceScore: number;
}

export interface DetectCvRequest {
  imageBase64: string;
  categories?: CvDetectionType[];
}

export interface DetectCvResponse {
  detections: DetectCvDetectionResult[];
  modelVersion: string;
}
