import { RoleName } from '../../common/enums/roles.enum';
import { GroundReportStatus as S } from '../ground-report.enums';
import { checkTransition, isReviewer } from './transitions';

describe('checkTransition', () => {
  it('lets an analyst triage but not decide', () => {
    expect(
      checkTransition({
        from: S.SUBMITTED,
        to: S.UNDER_REVIEW,
        role: RoleName.ANALYST,
      }),
    ).toEqual({ ok: true, reopen: false });
    expect(
      checkTransition({
        from: S.UNDER_REVIEW,
        to: S.VERIFIED,
        role: RoleName.ANALYST,
      }),
    ).toEqual({ ok: false, code: 'forbidden' });
  });

  it('never lets a field reporter move a report', () => {
    for (const to of Object.values(S)) {
      const result = checkTransition({
        from: S.UNDER_REVIEW,
        to,
        role: RoleName.FIELD_REPORTER,
        reason: 'x',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('requires review before a decision', () => {
    expect(
      checkTransition({
        from: S.SUBMITTED,
        to: S.VERIFIED,
        role: RoleName.ADMIN,
      }),
    ).toEqual({ ok: false, code: 'invalid_transition' });
    expect(
      checkTransition({
        from: S.SUBMITTED,
        to: S.REJECTED,
        role: RoleName.ADMIN,
        reason: 'spam',
      }),
    ).toEqual({ ok: false, code: 'invalid_transition' });
  });

  it('requires a reason to reject, mark unverifiable, ask for evidence or corroborate', () => {
    for (const to of [
      S.REJECTED,
      S.UNVERIFIABLE,
      S.NEEDS_MORE_EVIDENCE,
      S.CORROBORATED,
    ]) {
      expect(
        checkTransition({
          from: S.UNDER_REVIEW,
          to,
          role: RoleName.ADMIN,
          reason: '  ',
        }),
      ).toEqual({ ok: false, code: 'reason_required' });
      expect(
        checkTransition({
          from: S.UNDER_REVIEW,
          to,
          role: RoleName.ADMIN,
          reason: 'why',
        }).ok,
      ).toBe(true);
    }
  });

  it('allows verifying from corroborated', () => {
    expect(
      checkTransition({
        from: S.CORROBORATED,
        to: S.VERIFIED,
        role: RoleName.AGENCY_OPERATOR,
      }),
    ).toEqual({ ok: true, reopen: false });
  });

  it('reopens decided reports only for operators/admins, with a reason', () => {
    for (const from of [S.VERIFIED, S.REJECTED, S.UNVERIFIABLE]) {
      expect(
        checkTransition({
          from,
          to: S.UNDER_REVIEW,
          role: RoleName.ADMIN,
          reason: 'new info',
        }),
      ).toEqual({ ok: true, reopen: true });
      expect(
        checkTransition({ from, to: S.UNDER_REVIEW, role: RoleName.ADMIN }),
      ).toEqual({ ok: false, code: 'reason_required' });
      expect(
        checkTransition({
          from,
          to: S.UNDER_REVIEW,
          role: RoleName.ANALYST,
          reason: 'x',
        }),
      ).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  it('rejects moves between decided states and back to submitted', () => {
    expect(
      checkTransition({
        from: S.VERIFIED,
        to: S.REJECTED,
        role: RoleName.ADMIN,
        reason: 'x',
      }),
    ).toEqual({ ok: false, code: 'invalid_transition' });
    expect(
      checkTransition({
        from: S.UNDER_REVIEW,
        to: S.SUBMITTED,
        role: RoleName.ADMIN,
      }),
    ).toEqual({ ok: false, code: 'invalid_transition' });
  });

  it('treats only analysts, operators and admins as reviewers', () => {
    expect(isReviewer(RoleName.FIELD_REPORTER)).toBe(false);
    expect(isReviewer(RoleName.ANALYST)).toBe(true);
  });
});
