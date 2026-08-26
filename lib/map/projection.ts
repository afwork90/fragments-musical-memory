// PCA to a handful of components, by power iteration with deflation.
//
// Hand-rolled rather than pulled from a library because it is short, it must be
// exactly deterministic, and a linear basis is the whole reason PCA was chosen
// over UMAP: `umap-js` has no transform, so every corpus change means a re-fit and
// a Procrustes alignment to stop the map rotating. A basis is a mean and some
// vectors, and a new asset projects through it unchanged.

export type ProjectionBasis = {
  /** The corpus centroid. Subtracted before projecting. */
  mean: number[];
  /** Unit-length, orthogonal, descending by eigenvalue. */
  components: number[][];
  eigenvalues: number[];
  /** Trace of the covariance matrix: the total variance available to explain. */
  totalVariance: number;
};

const ITERATIONS = 200;
const TOLERANCE = 1e-10;

function covariance(rows: number[][], mean: number[]): number[][] {
  const width = mean.length;
  const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const left = row[i] - mean[i];
      for (let j = i; j < width; j++) {
        matrix[i][j] += left * (row[j] - mean[j]);
      }
    }
  }
  const divisor = Math.max(1, rows.length - 1);
  for (let i = 0; i < width; i++) {
    for (let j = i; j < width; j++) {
      matrix[i][j] /= divisor;
      matrix[j][i] = matrix[i][j];
    }
  }
  return matrix;
}

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

/**
 * Forces the largest-magnitude loading positive.
 *
 * An eigenvector's sign is arbitrary, so without this the map can mirror itself
 * between runs for no reason at all — which throws away the stability that
 * motivated choosing PCA in the first place.
 */
function fixSign(vector: number[]): number[] {
  let dominant = 0;
  for (const value of vector) {
    if (Math.abs(value) > Math.abs(dominant)) dominant = value;
  }
  return dominant < 0 ? vector.map((value) => -value) : vector;
}

export function fitProjection(rows: number[][], componentCount = 4): ProjectionBasis {
  const width = rows[0]?.length ?? 0;
  if (width === 0) {
    return { mean: [], components: [], eigenvalues: [], totalVariance: 0 };
  }

  const mean = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + row[column], 0) / rows.length);

  const matrix = covariance(rows, mean);
  const totalVariance = matrix.reduce((sum, row, index) => sum + row[index], 0);

  const components: number[][] = [];
  const eigenvalues: number[] = [];

  for (let index = 0; index < Math.min(componentCount, width); index++) {
    // A fixed deterministic start, not a random one. The 1/(i+1) ramp is only
    // there so the vector is not parallel to an axis, which would stall.
    let vector = Array.from({ length: width }, (_, i) => 1 / (i + 1));
    let eigenvalue = 0;

    for (let step = 0; step < ITERATIONS; step++) {
      let next = multiply(matrix, vector);

      // Deflate against the components already found, which keeps them orthogonal
      // without ever forming the deflated matrix.
      for (const found of components) {
        const overlap = next.reduce((sum, value, i) => sum + value * found[i], 0);
        next = next.map((value, i) => value - overlap * found[i]);
      }

      const norm = Math.hypot(...next);
      if (norm < TOLERANCE) {
        // No variance left in this direction. A constant corpus reaches this on
        // the first component, which is why callers must tolerate fewer
        // components than they asked for.
        eigenvalue = 0;
        break;
      }

      next = next.map((value) => value / norm);
      const converged = Math.abs(norm - eigenvalue) < TOLERANCE;
      vector = next;
      eigenvalue = norm;
      if (converged) break;
    }

    if (eigenvalue === 0) break;
    components.push(fixSign(vector));
    eigenvalues.push(eigenvalue);
  }

  return { mean, components, eigenvalues, totalVariance };
}

/**
 * A row's position on the first two components.
 *
 * A basis with fewer than two components is normal — it happens when the corpus
 * has one asset, or none — and the missing axis reads 0 rather than NaN.
 */
export function projectOne(row: number[], basis: ProjectionBasis): { x: number; y: number } {
  const along = (component: number[] | undefined) => component
    ? component.reduce((sum, value, index) => sum + value * (row[index] - basis.mean[index]), 0)
    : 0;
  return { x: along(basis.components[0]), y: along(basis.components[1]) };
}

export function projectAll(rows: number[][], basis: ProjectionBasis): { x: number; y: number }[] {
  return rows.map((row) => projectOne(row, basis));
}

/** One ratio per component found. Sums to less than 1 unless every component was kept. */
export function explainedVariance(basis: ProjectionBasis): number[] {
  if (basis.totalVariance === 0) return basis.eigenvalues.map(() => 0);
  return basis.eigenvalues.map((value) => value / basis.totalVariance);
}

/** Which measurements drive an axis, strongest first. Used for the axis captions. */
export function topLoadings(
  basis: ProjectionBasis,
  dimensions: string[],
  component: number,
  count: number,
): { name: string; weight: number }[] {
  const loadings = basis.components[component];
  if (!loadings) return [];
  return loadings
    .map((weight, index) => ({ name: dimensions[index] ?? `dimension ${index}`, weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count);
}
