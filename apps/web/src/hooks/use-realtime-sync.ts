'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { playAlertSound } from '@/lib/alert-sound';
import { isHighSeverityHazardEvent } from '@/lib/hazard-severity';
import { getNamespaceSocket } from '@/lib/websocket';
import { HAZARD_TYPE_LABELS } from '@/lib/labels';
import { useHazardAlertStore } from '@/stores/hazard-alert-store';
import type { DecisionRecommendation, HazardEvent, HazardRelationship, Notification } from '@/types/domain';

/** Connects the three WebSocket namespaces and turns their pushes into React
 * Query invalidations (+ toasts for the notification stream) — same bridge
 * ORION's use-realtime-sync.ts established, generalized to AETHER's
 * multi-hazard event names (docs/ARCHITECTURE.md §2.1). Mounted once at shell
 * level. Public broadcast feed: connects whether or not the visitor is
 * logged in, matching the public risk-map/hazards read endpoints (an access
 * token, if present, is still sent for the per-user-targeted half of the
 * notifications stream). */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const hazardEventsSocket = getNamespaceSocket('/ws/hazard-events');
    const dashboardSocket = getNamespaceSocket('/ws/dashboard');
    const notificationsSocket = getNamespaceSocket('/ws/notifications');

    const handleHazardEventCreated = (hazardEvent: HazardEvent) => {
      void queryClient.invalidateQueries({ queryKey: ['hazard-events'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      const severe = isHighSeverityHazardEvent(hazardEvent);
      if (severe) {
        useHazardAlertStore.getState().pushAlert(hazardEvent);
      }
      toast[severe ? 'warning' : 'info'](
        `New ${HAZARD_TYPE_LABELS[hazardEvent.hazardType].toLowerCase()} detected`,
        {
          description: hazardEvent.locationLabel ?? undefined,
          action: {
            label: 'View details',
            onClick: () => router.push(`/hazards/${hazardEvent.id}`),
          },
        },
      );
    };

    const handleDecisionRecommendationCreated = (recommendation: DecisionRecommendation) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['risk-assessments'] });
      void queryClient.invalidateQueries({ queryKey: ['decision-recommendations'] });
      if (recommendation.priorityLevel === 'critical' || recommendation.priorityLevel === 'high') {
        playAlertSound();
        toast.warning('New high-priority decision recommendation', {
          description: recommendation.summaryText,
        });
      }
    };

    const handleHazardRelationshipDetected = (relationship: HazardRelationship) => {
      void queryClient.invalidateQueries({ queryKey: ['hazard-events'] });
      void queryClient.invalidateQueries({ queryKey: ['decision-recommendations'] });
      if (isHighSeverityHazardEvent(relationship.relatedHazardEvent)) {
        useHazardAlertStore.getState().pushAlert(relationship.relatedHazardEvent);
      }
      toast.info('Cascading hazard relationship detected', {
        description: relationship.detail,
        action: {
          label: 'View details',
          onClick: () => router.push(`/hazards/${relationship.relatedHazardEvent.id}`),
        },
      });
    };

    const handleNotificationCreated = (notification: Notification) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast(notification.title, { description: notification.body ?? undefined });
    };

    hazardEventsSocket.on('hazard_event.created', handleHazardEventCreated);
    hazardEventsSocket.on('hazard_relationship.detected', handleHazardRelationshipDetected);
    dashboardSocket.on('decision_recommendation.created', handleDecisionRecommendationCreated);
    notificationsSocket.on('notification.created', handleNotificationCreated);

    hazardEventsSocket.connect();
    dashboardSocket.connect();
    notificationsSocket.connect();

    return () => {
      hazardEventsSocket.off('hazard_event.created', handleHazardEventCreated);
      hazardEventsSocket.off('hazard_relationship.detected', handleHazardRelationshipDetected);
      dashboardSocket.off('decision_recommendation.created', handleDecisionRecommendationCreated);
      notificationsSocket.off('notification.created', handleNotificationCreated);
      hazardEventsSocket.disconnect();
      dashboardSocket.disconnect();
      notificationsSocket.disconnect();
    };
  }, [queryClient, router]);
}
