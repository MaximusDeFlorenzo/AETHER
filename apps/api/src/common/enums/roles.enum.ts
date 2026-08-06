// AETHER's four roles reflect a risk-intelligence workflow (docs/DATABASE_SCHEMA.md
// §1), not ORION's command-center response roles — same single-role-per-user
// model and RolesGuard/@Roles() enforcement pattern.
export enum RoleName {
  ADMIN = 'admin',
  AGENCY_OPERATOR = 'agency_operator',
  ANALYST = 'analyst',
  FIELD_REPORTER = 'field_reporter',
}
