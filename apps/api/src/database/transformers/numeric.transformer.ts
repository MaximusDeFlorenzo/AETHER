import { ValueTransformer } from 'typeorm';

/**
 * node-postgres/TypeORM return `numeric` and `bigint` columns as strings by
 * default (to avoid silent precision loss on values bigger than JS can
 * represent exactly). None of our numeric/bigint columns approach that range
 * — risk scores, magnitudes, population counts — so we transform them back
 * to real JS numbers here, once, rather than requiring every API consumer to
 * know to parse strings.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};
